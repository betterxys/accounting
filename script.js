const APP_DB_NAME = 'couple_asset_tracker_db';
const APP_DB_VERSION = 1;
const APP_KV_STORE = 'key_value_store';
const APP_DATA_KEY = 'app_data';
const APP_SYNC_META_KEY = 'sync_meta';
const SUPABASE_SYNC_TABLE = 'asset_documents';
const FX_API_BASE_URL = 'https://api.frankfurter.app';
const FX_BASE_CURRENCY = 'CNY';
const STOCK_API_BASE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const BOUND_SUPABASE_CONFIG = Object.freeze({
    // 绑定配置模式：在部署前填入你的 Supabase 项目配置
    supabaseUrl: 'https://agkbbktmeyvjbbvswmja.supabase.co',
    supabasePublishableKey: 'sb_publishable_TkbD-BScRzpl6t_wtgLXNQ_ztUXfTvA'
});

class IndexedDBStorageAdapter {
    constructor() {
        this.dbPromise = null;
    }

    async open() {
        if (!window.indexedDB) {
            throw new Error('当前浏览器不支持 IndexedDB');
        }

        if (!this.dbPromise) {
            this.dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(APP_DB_NAME, APP_DB_VERSION);
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(APP_KV_STORE)) {
                        db.createObjectStore(APP_KV_STORE, { keyPath: 'key' });
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }

        return this.dbPromise;
    }

    async get(key) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(APP_KV_STORE, 'readonly');
            const store = tx.objectStore(APP_KV_STORE);
            const request = store.get(key);
            request.onsuccess = () => {
                resolve(request.result ? request.result.value : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async set(key, value) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(APP_KV_STORE, 'readwrite');
            const store = tx.objectStore(APP_KV_STORE);
            const request = store.put({ key, value });
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    async remove(key) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(APP_KV_STORE, 'readwrite');
            const store = tx.objectStore(APP_KV_STORE);
            const request = store.delete(key);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }
}

class SupabaseSyncService {
    constructor(app) {
        this.app = app;
        this.client = null;
        this.user = null;
        this.authSubscription = null;
        this.syncTimer = null;
        this.isSyncing = false;
        this.runtimeStatus = '未开始';
    }

    isConfigured() {
        return Boolean(
            BOUND_SUPABASE_CONFIG.supabaseUrl &&
            BOUND_SUPABASE_CONFIG.supabasePublishableKey
        );
    }

    async init() {
        if (!this.isConfigured()) {
            this.runtimeStatus = '未配置';
            this.app.updateSyncStatusDisplay();
            return;
        }

        this.ensureClient();
        await this.refreshUser();
        this.runtimeStatus = '已就绪';
        this.app.updateSyncStatusDisplay();
        this.bindAuthStateListener();
    }

    ensureClient() {
        if (this.client) return;

        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
            throw new Error('Supabase SDK 未加载，请检查网络后刷新页面');
        }

        this.client = window.supabase.createClient(
            BOUND_SUPABASE_CONFIG.supabaseUrl,
            BOUND_SUPABASE_CONFIG.supabasePublishableKey,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            }
        );
    }

    bindAuthStateListener() {
        if (!this.client || this.authSubscription) return;

        const { data } = this.client.auth.onAuthStateChange(async () => {
            await this.refreshUser();
            this.app.updateSyncStatusDisplay();
            this.app.renderSettings();
        });

        this.authSubscription = data ? data.subscription : null;
    }

    async refreshUser() {
        if (!this.client) {
            this.user = null;
            return null;
        }

        const { data, error } = await this.client.auth.getUser();
        if (error) {
            if (!String(error.message || '').includes('Auth session missing')) {
                console.warn('获取 Supabase 用户信息失败:', error.message);
            }
            this.user = null;
            return null;
        }

        this.user = data ? data.user : null;
        return this.user;
    }

    getAuthStatusText() {
        if (!this.isConfigured()) return '项目未绑定 Supabase 配置';
        if (!this.user) return '已配置，未登录';
        return `已登录：${this.user.email || this.user.id}`;
    }

    getRuntimeStatusText() {
        return this.runtimeStatus;
    }

    async sendMagicLink(email) {
        if (!email) {
            throw new Error('请先输入登录邮箱');
        }

        this.ensureClient();
        const { error } = await this.client.auth.signInWithOtp({
            email,
            options: {
                emailRedirectTo: window.location.href.split('#')[0]
            }
        });

        if (error) {
            throw new Error(error.message || '发送登录链接失败');
        }
    }

    async signOut() {
        if (!this.client) return;
        const { error } = await this.client.auth.signOut();
        if (error) {
            throw new Error(error.message || '退出登录失败');
        }
        this.user = null;
        this.runtimeStatus = '已退出登录';
    }

    scheduleAutoSync() {
        if (!this.app.data.settings.sync.autoSync) return;
        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => {
            this.syncNow('auto').catch(error => {
                console.warn('自动同步失败:', error.message);
            });
        }, 1200);
    }

    async fetchRemoteDocument(userId) {
        const { data, error } = await this.client
            .from(SUPABASE_SYNC_TABLE)
            .select('user_id, data, revision, updated_at')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) {
            throw new Error(this.getFriendlySyncError(error));
        }

        return data;
    }

    async insertRemoteDocument(userId, docData, revision) {
        const { data, error } = await this.client
            .from(SUPABASE_SYNC_TABLE)
            .insert({
                user_id: userId,
                data: docData,
                revision,
                updated_at: new Date().toISOString()
            })
            .select('revision, updated_at')
            .single();

        if (error) {
            throw new Error(this.getFriendlySyncError(error));
        }

        return data;
    }

    async tryUpdateRemoteDocument(userId, expectedRevision, nextRevision, docData) {
        const { data, error } = await this.client
            .from(SUPABASE_SYNC_TABLE)
            .update({
                data: docData,
                revision: nextRevision,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .eq('revision', expectedRevision)
            .select('revision, updated_at')
            .maybeSingle();

        if (error) {
            throw new Error(this.getFriendlySyncError(error));
        }

        return data;
    }

    getFriendlySyncError(error) {
        const message = error && error.message ? error.message : '未知错误';
        if (error && error.code === '42P01') {
            return `缺少数据表 ${SUPABASE_SYNC_TABLE}，请先按文档执行 SQL 初始化`;
        }
        if (error && error.code === 'PGRST116') {
            return '查询结果异常，请检查 Supabase 数据结构是否正确';
        }
        return message;
    }

    isLocalNewer(localTime, remoteTime) {
        if (!localTime) return false;
        if (!remoteTime) return true;
        return new Date(localTime).getTime() >= new Date(remoteTime).getTime();
    }

    async syncNow(trigger = 'manual') {
        if (this.isSyncing) {
            return { ok: false, message: '已有同步任务在进行中' };
        }

        if (!this.isConfigured()) {
            return { ok: false, message: '项目尚未绑定 Supabase 配置，请联系管理员部署配置' };
        }

        this.ensureClient();
        await this.refreshUser();
        if (!this.user) {
            return { ok: false, message: '请先完成 Supabase 登录' };
        }

        this.isSyncing = true;
        this.runtimeStatus = trigger === 'auto' ? '自动同步中...' : '同步中...';
        this.app.updateSyncStatusDisplay();

        try {
            const localMeta = this.app.syncMeta;
            const localData = this.app.getLocalDataSnapshot();
            const remoteDoc = await this.fetchRemoteDocument(this.user.id);

            if (!remoteDoc) {
                const firstRevision = Math.max(localMeta.localRevision || 0, 1);
                await this.insertRemoteDocument(this.user.id, localData, firstRevision);
                await this.app.markSynced(firstRevision);
                this.runtimeStatus = '同步成功（首次上传）';
                this.app.updateSyncStatusDisplay();
                return { ok: true, message: '首次同步成功，已上传到云端' };
            }

            const remoteRevision = Number(remoteDoc.revision) || 0;
            const localRevision = Number(localMeta.localRevision) || 0;

            if (localMeta.dirty && remoteRevision > localRevision) {
                const mergedData = this.app.mergeLocalWithRemote(localData, remoteDoc.data);
                const mergeRevision = remoteRevision + 1;
                const mergedResult = await this.tryUpdateRemoteDocument(
                    this.user.id,
                    remoteRevision,
                    mergeRevision,
                    mergedData
                );

                if (mergedResult) {
                    await this.app.applyMergedDataAfterSync(mergedData, mergeRevision, mergedResult.updated_at);
                    this.runtimeStatus = '同步成功（冲突已自动合并）';
                    this.app.updateSyncStatusDisplay();
                    return { ok: true, message: '检测到并发修改，已自动合并并同步' };
                }

                const latestRemote = await this.fetchRemoteDocument(this.user.id);
                if (latestRemote) {
                    await this.app.applyRemoteData(
                        latestRemote.data,
                        Number(latestRemote.revision) || remoteRevision,
                        latestRemote.updated_at
                    );
                }
                this.runtimeStatus = '同步冲突，已拉取云端版本';
                this.app.updateSyncStatusDisplay();
                return { ok: false, message: '同步冲突，已采用云端最新数据' };
            }

            if (remoteRevision > localRevision && !localMeta.dirty) {
                await this.app.applyRemoteData(remoteDoc.data, remoteRevision, remoteDoc.updated_at);
                this.runtimeStatus = '同步成功（已拉取云端数据）';
                this.app.updateSyncStatusDisplay();
                return { ok: true, message: '已拉取云端最新数据' };
            }

            if (localMeta.dirty || localRevision > remoteRevision || this.isLocalNewer(localMeta.lastModifiedAt, remoteDoc.updated_at)) {
                const nextRevision = Math.max(localRevision, remoteRevision + 1);
                const pushed = await this.tryUpdateRemoteDocument(
                    this.user.id,
                    remoteRevision,
                    nextRevision,
                    localData
                );

                if (pushed) {
                    await this.app.markSynced(nextRevision, pushed.updated_at);
                    this.runtimeStatus = '同步成功（已上传本地数据）';
                    this.app.updateSyncStatusDisplay();
                    return { ok: true, message: '本地数据已上传到云端' };
                }

                const latestRemote = await this.fetchRemoteDocument(this.user.id);
                if (latestRemote && this.isLocalNewer(localMeta.lastModifiedAt, latestRemote.updated_at)) {
                    const retryRevision = (Number(latestRemote.revision) || 0) + 1;
                    const retry = await this.tryUpdateRemoteDocument(
                        this.user.id,
                        Number(latestRemote.revision) || 0,
                        retryRevision,
                        localData
                    );
                    if (retry) {
                        await this.app.markSynced(retryRevision, retry.updated_at);
                        this.runtimeStatus = '同步成功（冲突重试后上传）';
                        this.app.updateSyncStatusDisplay();
                        return { ok: true, message: '并发冲突后重试上传成功' };
                    }
                }

                if (latestRemote) {
                    await this.app.applyRemoteData(
                        latestRemote.data,
                        Number(latestRemote.revision) || 0,
                        latestRemote.updated_at
                    );
                }
                this.runtimeStatus = '同步冲突，已采用云端版本';
                this.app.updateSyncStatusDisplay();
                return { ok: false, message: '同步冲突，已回退到云端版本' };
            }

            await this.app.markSynced(remoteRevision, remoteDoc.updated_at);
            this.runtimeStatus = '已是最新状态';
            this.app.updateSyncStatusDisplay();
            return { ok: true, message: '本地与云端数据已一致' };
        } finally {
            this.isSyncing = false;
            this.app.updateSyncStatusDisplay();
        }
    }
}

class CoupleAssetTracker {
    constructor() {
        this.storage = new IndexedDBStorageAdapter();
        this.syncService = new SupabaseSyncService(this);
        this.persistQueue = Promise.resolve();
        this.syncMeta = this.getDefaultSyncMeta();
        this.data = {
            monthlyRecords: [],
            accountTypes: this.getDefaultAccountTypes(),
            settings: {
                users: this.getDefaultUsers(),
                sync: this.getDefaultSyncSettings()
            }
        };
        this.fxRatesByDate = {};
        this.fxFetchPromises = new Map();
        this.stockQuotesByDate = {};
        this.stockFetchPromises = new Map();
        this.saveButtonBaseText = '💾 保存记录';
        this.platformCollapseState = {};
        this.charts = {};
        this.resizeTimer = null;
        this.init().catch(error => {
            console.error('应用初始化失败:', error);
            alert(`应用初始化失败：${error.message}`);
        });
    }

    async init() {
        await this.loadData();
        this.initEventListeners();
        this.renderAccountInputs();
        this.updateCurrentMonth();
        this.setFxStatus('idle', '汇率/股票：请选择记账日期后自动获取（日汇率与前一交易日收盘价）');
        this.setSaveButtonAvailability(false, '请选择记账日期');
        this.initCharts();
        this.updateOverview();
        this.renderSettings();
        await this.syncService.init();
        this.updateSyncStatusDisplay();
    }

    getDefaultAccountTypes() {
        return [
            { id: 'cmbc', platform: '招商银行', name: '活期存款', currency: 'CNY', ownerId: 'both', icon: '🏦', color: '#d32f2f', category: 'bank', allocationTag: 'flexible' },
            { id: 'icbc', platform: '中国银行', name: '活期存款', currency: 'CNY', ownerId: 'both', icon: '🏛️', color: '#1976d2', category: 'bank', allocationTag: 'flexible' },
            { id: 'ccb', platform: '建设银行', name: '活期存款', currency: 'CNY', ownerId: 'both', icon: '🏦', color: '#0d47a1', category: 'bank', allocationTag: 'flexible' },
            { id: 'wechat', platform: '微信', name: '零钱', currency: 'CNY', ownerId: 'both', icon: '💬', color: '#4caf50', category: 'payment', allocationTag: 'flexible' },
            { id: 'alipay', platform: '支付宝', name: '余额', currency: 'CNY', ownerId: 'both', icon: '💰', color: '#2196f3', category: 'payment', allocationTag: 'flexible' },
            { id: 'cash', platform: '现金', name: '现金', currency: 'CNY', ownerId: 'both', icon: '💵', color: '#ff9800', category: 'cash', allocationTag: 'flexible' }
        ];
    }

    normalizeCurrency(value) {
        const raw = String(value || '').trim().toUpperCase();
        if (!raw || raw === '¥' || raw === '元' || raw === 'RMB' || raw === 'CNY' || raw === '人民币') {
            return 'CNY';
        }
        if (raw.includes('USD') || raw.includes('US$') || raw === '$') return 'USD';
        if (raw.includes('HKD') || raw.includes('HK$')) return 'HKD';
        if (raw.includes('EUR') || raw.includes('€')) return 'EUR';
        if (raw.includes('GBP') || raw.includes('£')) return 'GBP';
        return raw;
    }

    getCurrencyLabel(currency) {
        const normalized = this.normalizeCurrency(currency);
        if (normalized === 'CNY') return '元';
        return normalized;
    }

    buildStockCodeMeta(market, code) {
        if (market === 'hk') {
            const normalizedCode = String(code || '').padStart(5, '0');
            return {
                market,
                marketLabel: '港股',
                code: normalizedCode,
                normalizedCode: `HK${normalizedCode}`,
                secid: `116.${normalizedCode}`,
                currency: 'HKD'
            };
        }
        if (market === 'sh') {
            const normalizedCode = String(code || '').padStart(6, '0');
            return {
                market,
                marketLabel: '沪市',
                code: normalizedCode,
                normalizedCode: `SH${normalizedCode}`,
                secid: `1.${normalizedCode}`,
                currency: 'CNY'
            };
        }
        if (market === 'sz') {
            const normalizedCode = String(code || '').padStart(6, '0');
            return {
                market,
                marketLabel: '深市',
                code: normalizedCode,
                normalizedCode: `SZ${normalizedCode}`,
                secid: `0.${normalizedCode}`,
                currency: 'CNY'
            };
        }
        return null;
    }

    parseStockCode(rawCode) {
        const value = String(rawCode || '').trim().toUpperCase().replace(/\s+/g, '');
        if (!value) return null;

        const secidMatch = value.match(/^(\d{1,3})\.(\d{4,6})$/);
        if (secidMatch) {
            const marketId = secidMatch[1];
            const code = secidMatch[2];
            if (marketId === '116') return this.buildStockCodeMeta('hk', code);
            if (marketId === '1') return this.buildStockCodeMeta('sh', code);
            if (marketId === '0') return this.buildStockCodeMeta('sz', code);
            return null;
        }

        const normalized = value.replace(/-/g, '.');
        const suffixMatch = normalized.match(/^(\d{4,6})\.([A-Z]{2})$/);
        if (suffixMatch) {
            const digits = suffixMatch[1];
            const suffix = suffixMatch[2];
            if (suffix === 'HK') return this.buildStockCodeMeta('hk', digits);
            if (suffix === 'SH') return this.buildStockCodeMeta('sh', digits);
            if (suffix === 'SZ') return this.buildStockCodeMeta('sz', digits);
            return null;
        }

        const dotMatch = normalized.match(/^([A-Z]{2})\.(\d{4,6})$/);
        if (dotMatch) {
            const prefix = dotMatch[1];
            const digits = dotMatch[2];
            if (prefix === 'HK') return this.buildStockCodeMeta('hk', digits);
            if (prefix === 'SH') return this.buildStockCodeMeta('sh', digits);
            if (prefix === 'SZ') return this.buildStockCodeMeta('sz', digits);
            return null;
        }

        const prefixedMatch = normalized.match(/^(HK|SH|SZ)(\d{4,6})$/);
        if (prefixedMatch) {
            const prefix = prefixedMatch[1];
            const digits = prefixedMatch[2];
            if (prefix === 'HK') return this.buildStockCodeMeta('hk', digits);
            if (prefix === 'SH') return this.buildStockCodeMeta('sh', digits);
            if (prefix === 'SZ') return this.buildStockCodeMeta('sz', digits);
        }

        if (/^\d{6}$/.test(normalized)) {
            if (normalized.startsWith('6') || normalized.startsWith('9')) {
                return this.buildStockCodeMeta('sh', normalized);
            }
            if (normalized.startsWith('0') || normalized.startsWith('3')) {
                return this.buildStockCodeMeta('sz', normalized);
            }
        }

        if (/^\d{4,5}$/.test(normalized)) {
            return this.buildStockCodeMeta('hk', normalized);
        }

        return null;
    }

    isStockAccount(account) {
        if (!account || typeof account !== 'object') return false;
        return account.category === 'stock' || Boolean(String(account.stockCode || '').trim());
    }

    getStockDisplayCode(account) {
        if (!account) return '';
        const parsed = this.parseStockCode(account.stockCode || account.stockSecid || '');
        if (parsed) return parsed.normalizedCode;
        return String(account.stockCode || '').trim().toUpperCase();
    }

    getOwnerLabel(ownerId) {
        if (ownerId === 'xiaoxiao') return '肖肖专用';
        if (ownerId === 'yunyun') return '运运专用';
        return '双方共用';
    }

    getAllocationTagOptions() {
        return [
            { value: 'flexible', label: '灵活取用', color: '#2e7d32' },
            { value: 'stable', label: '稳健投资', color: '#1565c0' },
            { value: 'aggressive', label: '激进投资', color: '#c62828' }
        ];
    }

    normalizeAllocationTag(value, category = 'other') {
        const raw = String(value || '').trim().toLowerCase();
        const options = this.getAllocationTagOptions();
        if (options.some(option => option.value === raw)) return raw;

        if (raw.includes('灵活') || raw.includes('活期') || raw.includes('现金')) return 'flexible';
        if (raw.includes('稳健') || raw.includes('保守') || raw.includes('低风险')) return 'stable';
        if (raw.includes('激进') || raw.includes('基金') || raw.includes('股票') || raw.includes('高风险')) return 'aggressive';

        if (category === 'cash' || category === 'payment') return 'flexible';
        if (category === 'investment') return 'stable';
        return 'flexible';
    }

    getAllocationTagLabel(tag) {
        const normalized = this.normalizeAllocationTag(tag);
        const match = this.getAllocationTagOptions().find(option => option.value === normalized);
        return match ? match.label : '灵活取用';
    }

    getAllocationTagColor(tag) {
        const normalized = this.normalizeAllocationTag(tag);
        const match = this.getAllocationTagOptions().find(option => option.value === normalized);
        return match ? match.color : '#2e7d32';
    }

    guessIconByPlatform(platform) {
        const text = String(platform || '');
        if (text.includes('支付宝')) return '💰';
        if (text.includes('微信')) return '💬';
        if (text.includes('汇') || text.includes('银行') || text.includes('行')) return '🏦';
        if (text.includes('现金')) return '💵';
        if (text.includes('基金') || text.includes('理财') || text.includes('股票')) return '📈';
        return '💼';
    }

    guessColorByPlatform(platform) {
        const text = String(platform || '');
        if (text.includes('招商')) return '#d32f2f';
        if (text.includes('支付宝')) return '#1677ff';
        if (text.includes('微信')) return '#1aad19';
        if (text.includes('汇')) return '#4b6cb7';
        if (text.includes('银行') || text.includes('行')) return '#1976d2';
        if (text.includes('基金') || text.includes('理财') || text.includes('股票')) return '#7b1fa2';
        return '#607d8b';
    }

    normalizeAccountType(rawAccount, fallbackIndex = 0) {
        const source = rawAccount && typeof rawAccount === 'object' ? rawAccount : {};
        const platform = String(source.platform || source.name || '未分类平台').trim() || '未分类平台';
        const name = String(source.name || '未命名资产').trim() || '未命名资产';
        const ownerId = source.ownerId === 'xiaoxiao' || source.ownerId === 'yunyun' ? source.ownerId : 'both';
        const baseCurrency = this.normalizeCurrency(source.currency);
        const rawCategory = source.category || 'other';
        const parsedStock = this.parseStockCode(source.stockCode || source.stockSecid || '');
        const isStock = rawCategory === 'stock' || Boolean(parsedStock) || Boolean(String(source.stockCode || '').trim());
        const currency = isStock && parsedStock
            ? parsedStock.currency
            : baseCurrency;
        const category = isStock ? 'stock' : rawCategory;
        const now = new Date().toISOString();

        return {
            id: source.id || `custom_${Date.now()}_${fallbackIndex}`,
            platform,
            name,
            ownerId,
            currency,
            icon: source.icon || (isStock ? '📈' : this.guessIconByPlatform(platform)),
            color: source.color || this.guessColorByPlatform(platform),
            category,
            allocationTag: this.normalizeAllocationTag(source.allocationTag, category),
            stockCode: isStock
                ? (parsedStock ? parsedStock.normalizedCode : String(source.stockCode || '').trim().toUpperCase())
                : '',
            stockSecid: isStock
                ? (parsedStock ? parsedStock.secid : String(source.stockSecid || '').trim())
                : '',
            stockMarket: isStock
                ? (parsedStock ? parsedStock.market : String(source.stockMarket || '').trim().toLowerCase())
                : '',
            createdAt: source.createdAt || now,
            updatedAt: source.updatedAt || source.createdAt || now
        };
    }

    getUserAccounts(userId) {
        return this.data.accountTypes.filter(account => {
            const ownerId = account.ownerId || 'both';
            return ownerId === 'both' || ownerId === userId;
        });
    }

    getPlatformGroupKey(userId, platform) {
        return `${userId}:${platform}`;
    }

    isPlatformCollapsed(userId, platform) {
        const key = this.getPlatformGroupKey(userId, platform);
        return Boolean(this.platformCollapseState[key]);
    }

    setPlatformCollapsed(userId, platform, collapsed) {
        const key = this.getPlatformGroupKey(userId, platform);
        this.platformCollapseState[key] = Boolean(collapsed);
    }

    groupAccountsByPlatform(accounts) {
        const platformMap = new Map();
        (accounts || []).forEach(account => {
            const platform = account.platform || '未分类平台';
            if (!platformMap.has(platform)) {
                platformMap.set(platform, {
                    platform,
                    icon: account.icon || '💼',
                    color: account.color || '#607d8b',
                    accounts: []
                });
            }
            platformMap.get(platform).accounts.push(account);
        });

        return Array.from(platformMap.values())
            .sort((a, b) => a.platform.localeCompare(b.platform, 'zh-CN'))
            .map(group => ({
                ...group,
                accounts: group.accounts
                    .slice()
                    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'))
            }));
    }

    getTrackedCurrencies() {
        const currencies = new Set([FX_BASE_CURRENCY]);
        this.data.accountTypes.forEach(account => {
            currencies.add(this.normalizeCurrency(account.currency));
        });
        return Array.from(currencies);
    }

    setFxStatus(state, message) {
        const statusElement = document.getElementById('recordFxStatus');
        if (!statusElement) return;
        statusElement.className = `fx-status ${state}`;
        statusElement.textContent = message;
    }

    setSaveButtonAvailability(canSave, reason = '') {
        const button = document.getElementById('saveRecordBtn');
        if (!button) return;
        button.disabled = !canSave;
        if (canSave) {
            button.textContent = this.saveButtonBaseText;
        } else {
            button.textContent = `⏳ ${reason || '汇率加载中'}`;
        }
    }

    getActiveRecordDate() {
        const input = document.getElementById('recordDate');
        return input ? input.value : '';
    }

    getFxSummaryText(rateEntry) {
        if (!rateEntry) return '汇率：请先选择记账日期';
        const quoteParts = Object.keys(rateEntry.rates || {})
            .filter(currency => currency !== FX_BASE_CURRENCY)
            .sort()
            .map(currency => {
                const rate = Number(rateEntry.rates[currency]);
                const effectiveDate = rateEntry.effectiveDates ? rateEntry.effectiveDates[currency] : '';
                return `${currency}/CNY=${rate.toFixed(4)}${effectiveDate ? `（${effectiveDate}）` : ''}`;
            });

        if (quoteParts.length === 0) {
            return '汇率：全部为人民币资产，无需换算';
        }
        return `汇率：${quoteParts.join('，')}`;
    }

    getRecordMarketSummaryText(rateEntry, stockEntry) {
        const fxText = this.getFxSummaryText(rateEntry);
        const quotes = Object.values((stockEntry && stockEntry.quotes) ? stockEntry.quotes : {})
            .filter(item => item && Number.isFinite(Number(item.previousClose)) && Number(item.previousClose) > 0)
            .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
        if (quotes.length === 0) return fxText;

        const stockText = quotes
            .slice(0, 3)
            .map(quote => {
                const name = quote.name || quote.code || '股票';
                const code = quote.code || '--';
                const price = this.formatStockPrice(quote.previousClose, quote.currency);
                const dateTip = quote.quoteDate ? `（${quote.quoteDate}）` : '';
                return `${name}(${code})昨收${price} ${quote.currency || 'CNY'}${dateTip}`;
            })
            .join('，');
        const moreTip = quotes.length > 3 ? ` 等${quotes.length}只` : '';
        return `${fxText}｜股票：${stockText}${moreTip}`;
    }

    formatStockPrice(price, currency = 'CNY') {
        const value = Number(price);
        if (!Number.isFinite(value)) return '--';
        const decimals = this.normalizeCurrency(currency) === 'HKD' ? 3 : 2;
        return value.toFixed(decimals);
    }

    getPreviousCalendarDate(dateString) {
        if (!dateString) return '';
        const parts = String(dateString).split('-').map(value => Number(value));
        if (parts.length !== 3 || parts.some(value => !Number.isInteger(value))) return '';
        const utcDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        if (Number.isNaN(utcDate.getTime())) return '';
        utcDate.setUTCDate(utcDate.getUTCDate() - 1);
        const year = utcDate.getUTCFullYear();
        const month = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(utcDate.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    toCompactDate(dateString) {
        return String(dateString || '').replace(/-/g, '');
    }

    async fetchStockPreviousClose(recordDate, account) {
        const parsedStock = this.parseStockCode(account.stockCode || account.stockSecid || '');
        if (!parsedStock) {
            throw new Error(`股票代码无效：${account.stockCode || '--'}`);
        }

        const previousDate = this.getPreviousCalendarDate(recordDate);
        if (!previousDate) {
            throw new Error('记账日期格式无效');
        }
        const endDate = this.toCompactDate(previousDate);
        const params = new URLSearchParams({
            secid: parsedStock.secid,
            klt: '101',
            fqt: '1',
            lmt: '1',
            end: endDate,
            iscca: '1',
            fields1: 'f1,f2,f3,f4,f5,f6',
            fields2: 'f51,f52,f53,f54,f55,f56,f57,f58'
        });
        const url = `${STOCK_API_BASE_URL}?${params.toString()}`;

        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                const response = await fetch(url, {
                    headers: {
                        Accept: 'application/json, text/plain, */*'
                    }
                });
                if (!response.ok) {
                    throw new Error(`行情接口异常（${response.status}）`);
                }

                const payload = await response.json();
                const data = payload && payload.data ? payload.data : null;
                const klines = data && Array.isArray(data.klines) ? data.klines : [];
                if (klines.length === 0) {
                    throw new Error('未返回可用K线数据');
                }

                const latestKline = String(klines[klines.length - 1] || '');
                const [quoteDate, openPrice, closePrice] = latestKline.split(',');
                const previousClose = Number(closePrice);
                if (!Number.isFinite(previousClose) || previousClose <= 0) {
                    throw new Error(`昨收价无效：${closePrice || '--'}`);
                }

                return {
                    accountId: account.id,
                    code: parsedStock.normalizedCode,
                    secid: parsedStock.secid,
                    market: parsedStock.market,
                    currency: parsedStock.currency,
                    name: String(data && data.name ? data.name : account.name || parsedStock.normalizedCode).trim(),
                    previousClose,
                    quoteDate: quoteDate || previousDate,
                    openPrice: Number(openPrice),
                    provider: 'eastmoney',
                    fetchedAt: new Date().toISOString()
                };
            } catch (error) {
                lastError = error;
                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 260 * attempt));
                }
            }
        }

        const reason = lastError && lastError.message ? lastError.message : '未知错误';
        throw new Error(`获取 ${account.name || parsedStock.normalizedCode} 昨收失败：${reason}`);
    }

    async ensureStockQuotesForDate(recordDate) {
        if (!recordDate) {
            return {
                requestedDate: '',
                provider: 'eastmoney',
                quotes: {},
                errors: {}
            };
        }

        if (!this.stockQuotesByDate[recordDate]) {
            this.stockQuotesByDate[recordDate] = {
                requestedDate: recordDate,
                provider: 'eastmoney',
                quotes: {},
                errors: {}
            };
        }

        const quoteEntry = this.stockQuotesByDate[recordDate];
        const stockAccounts = this.data.accountTypes.filter(account => this.isStockAccount(account));
        const activeAccountIds = new Set(stockAccounts.map(account => account.id));
        Object.keys(quoteEntry.quotes || {}).forEach(accountId => {
            if (!activeAccountIds.has(accountId)) delete quoteEntry.quotes[accountId];
        });
        Object.keys(quoteEntry.errors || {}).forEach(accountId => {
            if (!activeAccountIds.has(accountId)) delete quoteEntry.errors[accountId];
        });

        if (stockAccounts.length === 0) {
            return quoteEntry;
        }

        const pendingAccounts = stockAccounts.filter(account => {
            const cached = quoteEntry.quotes[account.id];
            const expectedCode = this.getStockDisplayCode(account);
            if (!cached) return true;
            return expectedCode && String(cached.code || '') !== expectedCode;
        });

        if (pendingAccounts.length === 0) {
            return quoteEntry;
        }

        const promiseKey = `${recordDate}:${pendingAccounts
            .map(account => `${account.id}:${this.getStockDisplayCode(account)}`)
            .sort()
            .join(',')}`;
        if (this.stockFetchPromises.has(promiseKey)) {
            return this.stockFetchPromises.get(promiseKey);
        }

        const task = Promise.allSettled(
            pendingAccounts.map(account => this.fetchStockPreviousClose(recordDate, account))
        )
            .then(results => {
                results.forEach((result, index) => {
                    const account = pendingAccounts[index];
                    if (!account) return;
                    if (result.status === 'fulfilled') {
                        quoteEntry.quotes[account.id] = result.value;
                        delete quoteEntry.errors[account.id];
                    } else {
                        delete quoteEntry.quotes[account.id];
                        quoteEntry.errors[account.id] = result.reason && result.reason.message
                            ? result.reason.message
                            : '股票行情获取失败';
                    }
                });
                return quoteEntry;
            })
            .finally(() => {
                this.stockFetchPromises.delete(promiseKey);
            });

        this.stockFetchPromises.set(promiseKey, task);
        return task;
    }

    async fetchDailyRate(date, fromCurrency) {
        const url = `${FX_API_BASE_URL}/${encodeURIComponent(date)}?from=${encodeURIComponent(fromCurrency)}&to=${FX_BASE_CURRENCY}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`${fromCurrency} 汇率接口异常（${response.status}）`);
        }
        const payload = await response.json();
        const rate = Number(payload && payload.rates ? payload.rates[FX_BASE_CURRENCY] : NaN);
        if (!Number.isFinite(rate) || rate <= 0) {
            throw new Error(`${fromCurrency} 无法获取可用汇率`);
        }
        return {
            rate,
            effectiveDate: payload && payload.date ? payload.date : date
        };
    }

    async ensureFxRatesForDate(recordDate) {
        if (!recordDate) {
            return {
                requestedDate: '',
                provider: 'frankfurter',
                baseCurrency: FX_BASE_CURRENCY,
                rates: { [FX_BASE_CURRENCY]: 1 },
                effectiveDates: {}
            };
        }

        if (!this.fxRatesByDate[recordDate]) {
            this.fxRatesByDate[recordDate] = {
                requestedDate: recordDate,
                provider: 'frankfurter',
                baseCurrency: FX_BASE_CURRENCY,
                rates: { [FX_BASE_CURRENCY]: 1 },
                effectiveDates: { [FX_BASE_CURRENCY]: recordDate }
            };
        }

        const rateEntry = this.fxRatesByDate[recordDate];
        const missingCurrencies = this.getTrackedCurrencies()
            .filter(currency => currency !== FX_BASE_CURRENCY)
            .filter(currency => !(currency in rateEntry.rates));

        if (missingCurrencies.length === 0) {
            return rateEntry;
        }

        const promiseKey = `${recordDate}:${missingCurrencies.slice().sort().join(',')}`;
        if (this.fxFetchPromises.has(promiseKey)) {
            return this.fxFetchPromises.get(promiseKey);
        }

        this.setFxStatus('loading', `汇率加载中：${missingCurrencies.join(', ')}`);
        const task = Promise.all(missingCurrencies.map(async currency => {
            const result = await this.fetchDailyRate(recordDate, currency);
            rateEntry.rates[currency] = result.rate;
            rateEntry.effectiveDates[currency] = result.effectiveDate;
        }))
            .then(() => {
                this.setFxStatus('ready', this.getFxSummaryText(rateEntry));
                return rateEntry;
            })
            .catch(error => {
                this.setFxStatus('error', `汇率获取失败：${error.message}`);
                throw error;
            })
            .finally(() => {
                this.fxFetchPromises.delete(promiseKey);
            });

        this.fxFetchPromises.set(promiseKey, task);
        return task;
    }

    collectConvertedTotals(recordDate) {
        const users = this.data.settings.users;
        const rateEntry = this.fxRatesByDate[recordDate] || {
            rates: { [FX_BASE_CURRENCY]: 1 },
            effectiveDates: { [FX_BASE_CURRENCY]: recordDate }
        };
        const stockEntry = this.stockQuotesByDate[recordDate] || {
            requestedDate: recordDate,
            provider: 'eastmoney',
            quotes: {},
            errors: {}
        };
        const balances = {};
        const totals = {};
        const platformTotals = {};
        const stockValuations = {};
        const missingCurrencies = new Set();
        const missingStockQuotes = new Set();
        let familyTotal = 0;

        users.forEach(user => {
            balances[user.id] = {};
            let userTotal = 0;
            platformTotals[user.id] = {};
            stockValuations[user.id] = {};

            this.getUserAccounts(user.id).forEach(account => {
                const input = document.querySelector(`[data-user="${user.id}"][data-account="${account.id}"]`);
                const amount = input ? (parseFloat(input.value) || 0) : 0;
                balances[user.id][account.id] = amount;

                if (this.isStockAccount(account)) {
                    const quote = stockEntry.quotes ? stockEntry.quotes[account.id] : null;
                    const previousClose = Number(quote && quote.previousClose);
                    if (!Number.isFinite(previousClose) || previousClose <= 0) {
                        missingStockQuotes.add(account.id);
                        return;
                    }

                    const stockCurrency = this.normalizeCurrency((quote && quote.currency) || account.currency || FX_BASE_CURRENCY);
                    const rate = stockCurrency === FX_BASE_CURRENCY ? 1 : rateEntry.rates[stockCurrency];
                    if (!Number.isFinite(rate) || rate <= 0) {
                        missingCurrencies.add(stockCurrency);
                        return;
                    }

                    const valueOriginal = amount * previousClose;
                    const converted = valueOriginal * rate;
                    userTotal += converted;
                    platformTotals[user.id][account.platform] = (platformTotals[user.id][account.platform] || 0) + converted;
                    stockValuations[user.id][account.id] = {
                        shares: amount,
                        previousClose,
                        quoteDate: quote.quoteDate || '',
                        code: quote.code || this.getStockDisplayCode(account),
                        name: quote.name || account.name || '',
                        currency: stockCurrency,
                        rateToCny: rate,
                        valueOriginal,
                        valueCny: converted
                    };
                    return;
                }

                const currency = this.normalizeCurrency(account.currency);
                const rate = currency === FX_BASE_CURRENCY ? 1 : rateEntry.rates[currency];
                if (!Number.isFinite(rate) || rate <= 0) {
                    missingCurrencies.add(currency);
                    return;
                }

                const converted = amount * rate;
                userTotal += converted;
                platformTotals[user.id][account.platform] = (platformTotals[user.id][account.platform] || 0) + converted;
            });

            totals[user.id] = userTotal;
            familyTotal += userTotal;
        });

        totals.combined = familyTotal;

        return {
            balances,
            totals,
            platformTotals,
            rateEntry,
            stockEntry,
            stockValuations,
            stockErrors: { ...(stockEntry.errors || {}) },
            missingCurrencies: Array.from(missingCurrencies),
            missingStockQuotes: Array.from(missingStockQuotes)
        };
    }

    getDefaultUsers() {
        return [
            { id: 'xiaoxiao', name: '肖肖', avatar: '👩', color: '#e91e63' },
            { id: 'yunyun', name: '运运', avatar: '👨', color: '#2196f3' }
        ];
    }

    getDefaultSyncSettings() {
        return {
            email: '',
            autoSync: false
        };
    }

    getDefaultSyncMeta() {
        return {
            localRevision: 0,
            lastModifiedAt: null,
            lastSyncedRevision: 0,
            lastSyncedAt: null,
            dirty: false
        };
    }

    mergeDataWithDefaults(rawData) {
        const defaults = {
            monthlyRecords: [],
            accountTypes: this.getDefaultAccountTypes(),
            settings: {
                users: this.getDefaultUsers(),
                sync: this.getDefaultSyncSettings()
            }
        };

        const source = rawData && typeof rawData === 'object' ? rawData : {};
        const sourceSettings = source.settings && typeof source.settings === 'object' ? source.settings : {};
        const sourceSync = sourceSettings.sync && typeof sourceSettings.sync === 'object' ? sourceSettings.sync : {};
        const sourceAccountTypes = Array.isArray(source.accountTypes) && source.accountTypes.length > 0
            ? source.accountTypes
            : defaults.accountTypes;

        const merged = {
            ...defaults,
            ...source,
            monthlyRecords: Array.isArray(source.monthlyRecords) ? source.monthlyRecords : defaults.monthlyRecords,
            accountTypes: sourceAccountTypes.map((account, index) => this.normalizeAccountType(account, index)),
            settings: {
                ...defaults.settings,
                ...sourceSettings,
                users: Array.isArray(sourceSettings.users) && sourceSettings.users.length > 0
                    ? sourceSettings.users
                    : defaults.settings.users,
                sync: {
                    ...defaults.settings.sync,
                    ...sourceSync
                }
            }
        };

        merged.monthlyRecords = merged.monthlyRecords
            .slice()
            .sort((a, b) => new Date(b.recordDate) - new Date(a.recordDate));

        return merged;
    }

    getLocalDataSnapshot() {
        return JSON.parse(JSON.stringify(this.data));
    }

    getUpdatedTimestamp(item) {
        if (!item) return 0;
        const stamp = item.updatedAt || item.createdAt;
        if (!stamp) return 0;
        const parsed = new Date(stamp).getTime();
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    mergeArrayById(localList, remoteList, key = 'id') {
        const localMap = new Map((localList || []).map(item => [item[key], item]));
        const remoteMap = new Map((remoteList || []).map(item => [item[key], item]));
        const allKeys = new Set([...localMap.keys(), ...remoteMap.keys()]);
        const merged = [];

        allKeys.forEach(id => {
            const localItem = localMap.get(id);
            const remoteItem = remoteMap.get(id);
            if (!localItem) {
                merged.push(remoteItem);
                return;
            }
            if (!remoteItem) {
                merged.push(localItem);
                return;
            }

            const localTime = this.getUpdatedTimestamp(localItem);
            const remoteTime = this.getUpdatedTimestamp(remoteItem);
            merged.push(localTime >= remoteTime ? localItem : remoteItem);
        });

        return merged;
    }

    mergeLocalWithRemote(localData, remoteData) {
        const localMerged = this.mergeDataWithDefaults(localData);
        const remoteMerged = this.mergeDataWithDefaults(remoteData);

        const mergedRecords = this.mergeArrayById(
            localMerged.monthlyRecords,
            remoteMerged.monthlyRecords
        ).sort((a, b) => new Date(b.recordDate) - new Date(a.recordDate));

        const mergedAccounts = this.mergeArrayById(
            localMerged.accountTypes,
            remoteMerged.accountTypes
        ).map((account, index) => this.normalizeAccountType(account, index));

        const localSyncSettings = localMerged.settings.sync || this.getDefaultSyncSettings();
        const remoteSyncSettings = remoteMerged.settings.sync || this.getDefaultSyncSettings();

        return {
            monthlyRecords: mergedRecords,
            accountTypes: mergedAccounts,
            settings: {
                ...remoteMerged.settings,
                ...localMerged.settings,
                users: localMerged.settings.users,
                sync: {
                    ...remoteSyncSettings,
                    ...localSyncSettings
                }
            }
        };
    }

    formatDateTime(value) {
        if (!value) return '--';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '--';
        return date.toLocaleString('zh-CN', { hour12: false });
    }

    updateSyncStatusDisplay() {
        const authElement = document.getElementById('syncAuthStatus');
        const stateElement = document.getElementById('syncStateStatus');
        const lastSyncedElement = document.getElementById('syncLastSynced');

        if (authElement) {
            authElement.textContent = this.syncService.getAuthStatusText();
        }
        if (stateElement) {
            const dirtyFlag = this.syncMeta.dirty ? '（有本地未同步改动）' : '';
            stateElement.textContent = `${this.syncService.getRuntimeStatusText()}${dirtyFlag}`;
        }
        if (lastSyncedElement) {
            lastSyncedElement.textContent = this.formatDateTime(this.syncMeta.lastSyncedAt);
        }
    }

    async markSynced(revision, syncedAt = null) {
        this.syncMeta.lastSyncedRevision = revision;
        this.syncMeta.lastSyncedAt = syncedAt || new Date().toISOString();
        this.syncMeta.localRevision = revision;
        this.syncMeta.dirty = false;
        await this.saveData({ markDirty: false, triggerAutoSync: false });
        this.updateSyncStatusDisplay();
    }

    async applyRemoteData(remoteData, revision, syncedAt) {
        const localAutoSync = Boolean(
            this.data &&
            this.data.settings &&
            this.data.settings.sync &&
            this.data.settings.sync.autoSync
        );
        this.data = this.mergeDataWithDefaults(remoteData);
        this.data.settings.sync = {
            ...this.getDefaultSyncSettings(),
            ...(this.data.settings.sync || {}),
            autoSync: localAutoSync
        };
        this.syncMeta.localRevision = revision;
        this.syncMeta.lastSyncedRevision = revision;
        this.syncMeta.lastSyncedAt = syncedAt || new Date().toISOString();
        this.syncMeta.lastModifiedAt = syncedAt || this.syncMeta.lastModifiedAt;
        this.syncMeta.dirty = false;
        await this.saveData({ markDirty: false, triggerAutoSync: false });
        this.renderAccountInputs();
        this.updateOverview();
        this.updateAnalysisCharts();
        this.renderSettings();
    }

    async applyMergedDataAfterSync(mergedData, revision, syncedAt) {
        const localAutoSync = Boolean(
            this.data &&
            this.data.settings &&
            this.data.settings.sync &&
            this.data.settings.sync.autoSync
        );
        this.data = this.mergeDataWithDefaults(mergedData);
        this.data.settings.sync = {
            ...this.getDefaultSyncSettings(),
            ...(this.data.settings.sync || {}),
            autoSync: localAutoSync
        };
        this.syncMeta.localRevision = revision;
        this.syncMeta.lastSyncedRevision = revision;
        this.syncMeta.lastSyncedAt = syncedAt || new Date().toISOString();
        this.syncMeta.lastModifiedAt = syncedAt || this.syncMeta.lastModifiedAt;
        this.syncMeta.dirty = false;
        await this.saveData({ markDirty: false, triggerAutoSync: false });
        this.renderAccountInputs();
        this.updateOverview();
        this.updateAnalysisCharts();
        this.renderSettings();
    }

    initEventListeners() {
        // 标签页切换
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // 新建记录按钮
        document.getElementById('newRecordBtn').addEventListener('click', () => {
            this.switchTab('record');
            this.initNewRecord();
        });

        // 保存记录
        document.getElementById('saveRecordBtn').addEventListener('click', () => this.saveRecord());

        // 记账日期变化时加载已有记录
        document.getElementById('recordDate').addEventListener('change', () => this.loadRecordByDate());

        // 时间范围选择
        document.getElementById('timeRange').addEventListener('change', () => this.updateAnalysisCharts());

        // 设置相关
        document.getElementById('addAccountTypeBtn').addEventListener('click', () => this.showAddAccountTypeModal());
        const batchImportBtn = document.getElementById('batchImportAccountTypeBtn');
        if (batchImportBtn) {
            batchImportBtn.addEventListener('click', () => this.showBatchImportAccountModal());
        }
        document.getElementById('exportDataBtn').addEventListener('click', () => this.exportData());
        document.getElementById('importDataBtn').addEventListener('click', () => this.importData());
        document.getElementById('clearDataBtn').addEventListener('click', () => this.clearData());
        document.getElementById('supabaseLoginBtn').addEventListener('click', () => this.sendSyncMagicLink());
        document.getElementById('supabaseLogoutBtn').addEventListener('click', () => this.logoutSync());
        document.getElementById('syncNowBtn').addEventListener('click', () => this.syncNow());

        const autoSyncToggle = document.getElementById('autoSyncToggle');
        if (autoSyncToggle) {
            autoSyncToggle.addEventListener('change', async (event) => {
                this.data.settings.sync.autoSync = Boolean(event.target.checked);
                await this.saveData({ markDirty: false, triggerAutoSync: false });
                this.updateSyncStatusDisplay();
            });
        }

        // 弹窗事件
        document.getElementById('closeModal').addEventListener('click', () => this.hideModal());
        document.getElementById('modalCancel').addEventListener('click', () => this.hideModal());

        // 小屏与横竖屏切换时，重新适配图表布局
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimer);
            this.resizeTimer = setTimeout(() => {
                const isMobile = this.isMobileView();
                if (this.charts.trend) {
                    this.charts.trend.options.plugins.legend.position = isMobile ? 'bottom' : 'top';
                    this.charts.trend.options.elements.point.radius = isMobile ? 3 : 4;
                    this.charts.trend.options.elements.point.hoverRadius = isMobile ? 5 : 6;
                    this.charts.trend.update('none');
                }

                if (document.getElementById('analysis').classList.contains('active')) {
                    this.updateAnalysisCharts();
                }
            }, 180);
        });
    }

    switchTab(tabName) {
        // 切换标签按钮状态
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // 切换内容显示
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tabName);
        });

        // 特殊处理
        if (tabName === 'analysis') {
            setTimeout(() => {
                this.initAnalysisCharts();
                this.updateAnalysisCharts();
            }, 200);
        } else if (tabName === 'record') {
            const recordDateInput = document.getElementById('recordDate');
            if (recordDateInput && !recordDateInput.value) {
                this.initNewRecord();
            } else {
                this.updateRecordTotals();
            }
        }
    }

    updateCurrentMonth() {
        const now = new Date();
        const monthStr = `${now.getFullYear()}年${now.getMonth() + 1}月`;
        document.getElementById('currentMonth').textContent = monthStr;
    }

    isMobileView() {
        return window.matchMedia('(max-width: 768px)').matches;
    }

    renderAccountInputs() {
        const users = this.data.settings.users;
        
        users.forEach(user => {
            const container = document.getElementById(`${user.id}Accounts`);
            container.innerHTML = '';
            const userAccounts = this.getUserAccounts(user.id);
            if (userAccounts.length === 0) {
                container.innerHTML = '<p class="empty-user-accounts">暂无资产明细，请到“设置 → 资产明细管理”添加。</p>';
                return;
            }
            const platformGroups = this.groupAccountsByPlatform(userAccounts);

            platformGroups.forEach(group => {
                const collapsed = this.isPlatformCollapsed(user.id, group.platform);
                const groupNode = document.createElement('div');
                groupNode.className = `platform-group${collapsed ? ' collapsed' : ''}`;
                groupNode.setAttribute('data-user', user.id);
                groupNode.setAttribute('data-platform', group.platform);
                groupNode.innerHTML = `
                    <button type="button" class="platform-group-header" data-user="${user.id}" data-platform="${group.platform}">
                        <span class="platform-group-left">
                            <span class="platform-group-icon">${group.icon}</span>
                            <span class="platform-group-name">${group.platform}</span>
                            <span class="platform-group-count">${group.accounts.length}项</span>
                        </span>
                        <span class="platform-group-right">
                            <span class="platform-group-total" data-user="${user.id}" data-platform="${group.platform}">¥0.00</span>
                            <span class="platform-group-toggle">▾</span>
                        </span>
                    </button>
                    <div class="platform-group-products"></div>
                `;

                const productsContainer = groupNode.querySelector('.platform-group-products');
                group.accounts.forEach(account => {
                    const isStock = this.isStockAccount(account);
                    const stockCode = this.getStockDisplayCode(account);
                    const inputStep = isStock ? '0.0001' : '0.01';
                    const inputPlaceholder = isStock ? '输入股数' : '0.00';
                    const currencyText = isStock
                        ? `股数 · ${this.getCurrencyLabel(account.currency)}`
                        : this.getCurrencyLabel(account.currency);
                    const stockCodeTag = isStock && stockCode
                        ? `<span class="account-stock-code-tag">${stockCode}</span>`
                        : '';
                    const stockQuoteInfo = isStock
                        ? `<div class="stock-quote-info loading" data-user="${user.id}" data-account="${account.id}">昨收价加载中...</div>`
                        : '';
                    const inputGroup = document.createElement('div');
                    inputGroup.className = 'account-input-group';
                    inputGroup.innerHTML = `
                        <span class="account-icon">${account.icon}</span>
                        <span class="account-label-wrap">
                            <span class="account-label">${account.name}</span>
                            ${stockCodeTag}
                        </span>
                        <span class="account-currency">${currencyText}</span>
                        <input 
                            type="number" 
                            step="${inputStep}" 
                            placeholder="${inputPlaceholder}"
                            class="form-input account-input"
                            data-user="${user.id}"
                            data-account="${account.id}"
                            data-input-kind="${isStock ? 'shares' : 'amount'}"
                        >
                        ${stockQuoteInfo}
                    `;
                    productsContainer.appendChild(inputGroup);
                });

                container.appendChild(groupNode);
            });
        });

        this.bindRecordPlatformToggleEvents();

        // 添加输入事件监听
        document.querySelectorAll('.account-input').forEach(input => {
            input.addEventListener('input', () => this.updateRecordTotals());
        });
    }

    bindRecordPlatformToggleEvents() {
        document.querySelectorAll('.platform-group-header').forEach(header => {
            header.addEventListener('click', () => {
                const userId = header.dataset.user;
                const platform = header.dataset.platform;
                const group = header.closest('.platform-group');
                if (!group || !userId || !platform) return;
                const collapsed = !group.classList.contains('collapsed');
                group.classList.toggle('collapsed', collapsed);
                this.setPlatformCollapsed(userId, platform, collapsed);
            });
        });
    }

    initNewRecord() {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('recordDate').value = today;
        this.saveButtonBaseText = '💾 保存记录';
        document.getElementById('saveRecordBtn').textContent = this.saveButtonBaseText;
        
        // 清空所有输入
        this.clearRecordInputs();
        this.updateRecordTotals();
    }

    clearRecordInputs() {
        document.querySelectorAll('.account-input').forEach(input => {
            input.value = '';
        });
    }

    loadRecordByDate() {
        const selectedDate = document.getElementById('recordDate').value;
        if (!selectedDate) {
            this.updateRecordTotals();
            return;
        }

        const date = new Date(selectedDate);
        const recordId = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        // 查找是否有对应日期的记录
        const existingRecord = this.data.monthlyRecords.find(r => r.id === recordId);
        
        if (existingRecord) {
            // 加载已有记录
            this.loadRecordData(existingRecord);
            this.showRecordStatus('编辑模式：正在修改' + existingRecord.year + '年' + existingRecord.month + '月的记录', 'edit');
            this.saveButtonBaseText = '💾 更新记录';
        } else {
            // 清空输入，准备新记录
            this.clearRecordInputs();
            this.showRecordStatus('新记录模式：将创建' + date.getFullYear() + '年' + (date.getMonth() + 1) + '月的记录', 'new');
            this.saveButtonBaseText = '💾 保存记录';
        }
        
        document.getElementById('saveRecordBtn').textContent = this.saveButtonBaseText;
        this.updateRecordTotals();
    }

    loadRecordData(record) {
        // 填充各账户的余额数据
        this.data.settings.users.forEach(user => {
            this.getUserAccounts(user.id).forEach(account => {
                const input = document.querySelector(`[data-user="${user.id}"][data-account="${account.id}"]`);
                if (input) {
                    const value = record.balances[user.id] && record.balances[user.id][account.id] !== undefined
                        ? record.balances[user.id][account.id]
                        : '';
                    input.value = value;
                }
            });
        });
    }

    showRecordStatus(message, type) {
        // 移除现有状态提示
        const existingStatus = document.querySelector('.record-status');
        if (existingStatus) {
            existingStatus.remove();
        }

        // 创建状态提示
        const statusDiv = document.createElement('div');
        statusDiv.className = `record-status ${type}-status`;
        statusDiv.innerHTML = `
            <div style="
                padding: 12px 20px; 
                margin: 15px 0; 
                border-radius: 8px; 
                text-align: center; 
                font-weight: 500;
                ${type === 'edit' ? 
                    'background: #fff3cd; border: 1px solid #ffeaa7; color: #856404;' : 
                    'background: #d4edda; border: 1px solid #c3e6cb; color: #155724;'
                }
            ">
                ${type === 'edit' ? '✏️' : '➕'} ${message}
            </div>
        `;
        
        // 插入到日期选择区域后面
        const recordDate = document.querySelector('.record-date');
        recordDate.parentNode.insertBefore(statusDiv, recordDate.nextSibling);
    }

    updateStockQuoteDisplays(summary) {
        const stockInfoElements = document.querySelectorAll('.stock-quote-info');
        if (!summary) {
            stockInfoElements.forEach(element => {
                element.className = 'stock-quote-info';
                element.textContent = '请选择记账日期后自动查询前一交易日收盘价';
            });
            return;
        }

        const accountMap = new Map(this.data.accountTypes.map(account => [account.id, account]));
        stockInfoElements.forEach(element => {
            const userId = element.dataset.user;
            const accountId = element.dataset.account;
            const account = accountMap.get(accountId);
            if (!account) {
                element.className = 'stock-quote-info error';
                element.textContent = '股票配置不存在，请删除后重新添加';
                return;
            }

            const quote = summary.stockEntry && summary.stockEntry.quotes
                ? summary.stockEntry.quotes[accountId]
                : null;
            const valuation = summary.stockValuations && summary.stockValuations[userId]
                ? summary.stockValuations[userId][accountId]
                : null;
            const shares = summary.balances && summary.balances[userId]
                ? Number(summary.balances[userId][accountId] || 0)
                : 0;
            const sharesText = shares.toLocaleString('zh-CN', { maximumFractionDigits: 4 });

            if (!quote || !Number.isFinite(Number(quote.previousClose)) || Number(quote.previousClose) <= 0) {
                const errorText = summary.stockErrors ? summary.stockErrors[accountId] : '';
                if (errorText) {
                    element.className = 'stock-quote-info error';
                    element.textContent = `昨收价获取失败：${errorText}`;
                } else {
                    element.className = 'stock-quote-info loading';
                    element.textContent = '昨收价加载中...';
                }
                return;
            }

            const quoteDate = quote.quoteDate || '--';
            const closePrice = this.formatStockPrice(quote.previousClose, quote.currency);
            if (!valuation) {
                element.className = 'stock-quote-info loading';
                element.textContent = `前收 ${quoteDate}：${closePrice} ${quote.currency}，${sharesText} 股（等待汇率折算）`;
                return;
            }

            element.className = 'stock-quote-info ready';
            element.textContent = `前收 ${quoteDate}：${closePrice} ${valuation.currency}，${sharesText} 股 ≈ ¥${valuation.valueCny.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
        });
    }

    async updateRecordTotals() {
        const recordDate = this.getActiveRecordDate();
        if (!recordDate) {
            this.setFxStatus('idle', '汇率/股票：请选择记账日期后自动获取（日汇率与前一交易日收盘价）');
            this.setSaveButtonAvailability(false, '请选择记账日期');
            this.updateStockQuoteDisplays(null);
            return;
        }

        try {
            await this.ensureFxRatesForDate(recordDate);
        } catch (error) {
            console.warn('汇率加载失败:', error.message);
        }
        await this.ensureStockQuotesForDate(recordDate);

        const summary = this.collectConvertedTotals(recordDate);
        this.updateStockQuoteDisplays(summary);
        if (summary.missingCurrencies.length > 0) {
            this.data.settings.users.forEach(user => {
                document.getElementById(`${user.id}RecordTotal`).textContent = '--';
            });
            document.querySelectorAll('.platform-group-total').forEach(element => {
                element.textContent = '--';
            });
            document.getElementById('familyRecordTotal').textContent = '--';
            this.setSaveButtonAvailability(false, '缺少汇率');
            this.setFxStatus('error', `汇率缺失：${summary.missingCurrencies.join(', ')}`);
            return;
        }
        if (summary.missingStockQuotes.length > 0) {
            const missingStockNames = summary.missingStockQuotes
                .map(accountId => {
                    const account = this.data.accountTypes.find(item => item.id === accountId);
                    if (!account) return accountId;
                    const code = this.getStockDisplayCode(account);
                    return `${account.name}${code ? `(${code})` : ''}`;
                });
            this.data.settings.users.forEach(user => {
                document.getElementById(`${user.id}RecordTotal`).textContent = '--';
            });
            document.querySelectorAll('.platform-group-total').forEach(element => {
                element.textContent = '--';
            });
            document.getElementById('familyRecordTotal').textContent = '--';
            this.setSaveButtonAvailability(false, '缺少昨收价');
            this.setFxStatus('error', `股票昨收缺失：${missingStockNames.join('、')}`);
            return;
        }

        this.data.settings.users.forEach(user => {
            const userTotal = summary.totals[user.id] || 0;
            document.getElementById(`${user.id}RecordTotal`).textContent = `¥${userTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
        });
        document.querySelectorAll('.platform-group-total').forEach(element => {
            const userId = element.dataset.user;
            const platform = element.dataset.platform;
            const value = summary.platformTotals[userId] && summary.platformTotals[userId][platform]
                ? summary.platformTotals[userId][platform]
                : 0;
            element.textContent = `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
        });
        document.getElementById('familyRecordTotal').textContent = `¥${summary.totals.combined.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
        this.setFxStatus('ready', this.getRecordMarketSummaryText(summary.rateEntry, summary.stockEntry));
        this.setSaveButtonAvailability(true);
    }

    async saveRecord() {
        const recordDate = document.getElementById('recordDate').value;
        if (!recordDate) {
            alert('请选择记账日期');
            return;
        }

        const date = new Date(recordDate);
        const recordId = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        try {
            await this.ensureFxRatesForDate(recordDate);
        } catch (error) {
            alert(`汇率获取失败：${error.message}`);
            return;
        }
        await this.ensureStockQuotesForDate(recordDate);

        const summary = this.collectConvertedTotals(recordDate);
        if (summary.missingCurrencies.length > 0) {
            alert(`缺少币种汇率：${summary.missingCurrencies.join(', ')}，请稍后重试`);
            return;
        }
        if (summary.missingStockQuotes.length > 0) {
            const missingStockNames = summary.missingStockQuotes
                .map(accountId => {
                    const account = this.data.accountTypes.find(item => item.id === accountId);
                    if (!account) return accountId;
                    const code = this.getStockDisplayCode(account);
                    return `${account.name}${code ? `(${code})` : ''}`;
                });
            alert(`缺少股票昨收价：${missingStockNames.join('、')}，请稍后重试`);
            return;
        }

        const balances = summary.balances;
        const totals = summary.totals;
        const stockQuotesSnapshot = {};
        Object.entries(summary.stockEntry && summary.stockEntry.quotes ? summary.stockEntry.quotes : {})
            .forEach(([accountId, quote]) => {
                stockQuotesSnapshot[accountId] = { ...quote };
            });
        const stockValuationsSnapshot = {};
        Object.entries(summary.stockValuations || {}).forEach(([userId, valuationMap]) => {
            stockValuationsSnapshot[userId] = {};
            Object.entries(valuationMap || {}).forEach(([accountId, valuation]) => {
                stockValuationsSnapshot[userId][accountId] = { ...valuation };
            });
        });

        // 计算相比上月变化
        const changes = this.calculateChanges(totals);

        // 创建记录
        const record = {
            id: recordId,
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            recordDate: recordDate,
            balances,
            totals,
            changes,
            fxSnapshot: {
                requestedDate: summary.rateEntry.requestedDate || recordDate,
                provider: summary.rateEntry.provider || 'frankfurter',
                baseCurrency: summary.rateEntry.baseCurrency || FX_BASE_CURRENCY,
                rates: { ...(summary.rateEntry.rates || {}) },
                effectiveDates: { ...(summary.rateEntry.effectiveDates || {}) }
            },
            stockSnapshot: {
                requestedDate: summary.stockEntry && summary.stockEntry.requestedDate
                    ? summary.stockEntry.requestedDate
                    : recordDate,
                provider: summary.stockEntry && summary.stockEntry.provider
                    ? summary.stockEntry.provider
                    : 'eastmoney',
                quotes: stockQuotesSnapshot,
                errors: { ...(summary.stockErrors || {}) },
                valuations: stockValuationsSnapshot
            },
            createdAt: new Date().toISOString()
        };

        // 保存或更新记录
        const existingIndex = this.data.monthlyRecords.findIndex(r => r.id === recordId);
        if (existingIndex >= 0) {
            // 更新现有记录，保留原创建时间
            record.createdAt = this.data.monthlyRecords[existingIndex].createdAt;
            record.updatedAt = new Date().toISOString();
            this.data.monthlyRecords[existingIndex] = record;
            console.log('📝 更新记录:', record);
        } else {
            // 新建记录
            record.updatedAt = record.createdAt;
            this.data.monthlyRecords.push(record);
            console.log('➕ 新建记录:', record);
        }

        // 按日期排序
        this.data.monthlyRecords.sort((a, b) => new Date(b.recordDate) - new Date(a.recordDate));

        this.saveData();
        this.updateOverview();
        this.updateAnalysisCharts();
        
        const isUpdate = existingIndex >= 0;
        alert(isUpdate ? '记录更新成功！' : '记账成功！');
        this.switchTab('overview');
    }

    calculateChanges(currentTotals) {
        const records = this.data.monthlyRecords.slice().sort((a, b) => new Date(b.recordDate) - new Date(a.recordDate));
        const lastRecord = records[0]; // 最近的记录（不包括当前要保存的）

        const changes = {};
        
        if (lastRecord) {
            this.data.settings.users.forEach(user => {
                changes[user.id] = currentTotals[user.id] - (lastRecord.totals[user.id] || 0);
            });
            changes.combined = currentTotals.combined - (lastRecord.totals.combined || 0);
        } else {
            // 第一次记录，变化为0
            this.data.settings.users.forEach(user => {
                changes[user.id] = 0;
            });
            changes.combined = 0;
        }

        return changes;
    }

    updateOverview() {
        const latestRecord = this.data.monthlyRecords[0];
        
        if (latestRecord) {
            // 更新总资产
            this.data.settings.users.forEach(user => {
                const total = latestRecord.totals[user.id] || 0;
                const change = latestRecord.changes[user.id] || 0;
                
                document.getElementById(`${user.id}Total`).textContent = 
                    `¥${total.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
                
                const changeElement = document.getElementById(`${user.id}Change`);
                this.updateChangeDisplay(changeElement, change);
            });

            // 更新家庭总资产
            const combinedTotal = latestRecord.totals.combined || 0;
            const combinedChange = latestRecord.changes.combined || 0;
            
            document.getElementById('combinedTotal').textContent = 
                `¥${combinedTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
            
            const combinedChangeElement = document.getElementById('combinedChange');
            this.updateChangeDisplay(combinedChangeElement, combinedChange);
        }

        // 更新最近记录列表
        this.updateRecentRecords();
        
        // 更新趋势图
        this.updateTrendChart();
    }

    updateChangeDisplay(element, change) {
        if (change > 0) {
            element.textContent = `+¥${change.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
            element.className = 'asset-change positive';
        } else if (change < 0) {
            element.textContent = `-¥${Math.abs(change).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
            element.className = 'asset-change negative';
        } else {
            element.textContent = '首次记录';
            element.className = 'asset-change neutral';
        }
    }

    updateRecentRecords() {
        const container = document.getElementById('recentRecordsList');
        const recentRecords = this.data.monthlyRecords.slice(0, 5);

        if (recentRecords.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">暂无记录，点击右上角"记账"开始</p>';
            return;
        }

        container.innerHTML = recentRecords.map(record => `
            <div class="record-item">
                <div class="record-info">
                    <div class="record-date">${record.year}年${record.month}月</div>
                    <div class="record-meta">${record.recordDate}</div>
                </div>
                <div class="record-actions">
                    <div class="record-amount">¥${record.totals.combined.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</div>
                    <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="app.editRecord('${record.id}')">
                        ✏️
                    </button>
                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 0.75rem;" onclick="app.deleteRecord('${record.id}')">
                        🗑️
                    </button>
                </div>
            </div>
        `).join('');
    }

    initCharts() {
        // 初始化概览页面的趋势图
        const ctx = document.getElementById('trendChart').getContext('2d');
        const isMobile = this.isMobileView();
        this.charts.trend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: '肖肖',
                        data: [],
                        borderColor: '#e91e63',
                        backgroundColor: 'rgba(233, 30, 99, 0.1)',
                        tension: 0.4
                    },
                    {
                        label: '运运',
                        data: [],
                        borderColor: '#2196f3',
                        backgroundColor: 'rgba(33, 150, 243, 0.1)',
                        tension: 0.4
                    },
                    {
                        label: '家庭总计',
                        data: [],
                        borderColor: '#ff9800',
                        backgroundColor: 'rgba(255, 152, 0, 0.1)',
                        tension: 0.4,
                        borderWidth: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: isMobile ? 'bottom' : 'top',
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '¥' + value.toLocaleString('zh-CN');
                            }
                        }
                    }
                },
                elements: {
                    point: {
                        radius: isMobile ? 3 : 4,
                        hoverRadius: isMobile ? 5 : 6
                    }
                }
            }
        });
    }

    updateTrendChart() {
        if (!this.charts.trend) {
            console.log('趋势图表未初始化');
            return;
        }

        const records = this.data.monthlyRecords
            .slice()
            .sort((a, b) => new Date(a.recordDate) - new Date(b.recordDate))
            .slice(-6); // 最近6个月

        console.log('概览页面趋势图数据:', records.length, '条记录');

        if (records.length === 0) {
            // 如果没有数据，显示空状态
            this.charts.trend.data.labels = ['暂无数据'];
            this.charts.trend.data.datasets[0].data = [0];
            this.charts.trend.data.datasets[1].data = [0];
            this.charts.trend.data.datasets[2].data = [0];
        } else {
            const labels = records.map(r => `${r.year}年${r.month}月`);
            const xiaoxiaoData = records.map(r => r.totals.xiaoxiao || 0);
            const yunyunData = records.map(r => r.totals.yunyun || 0);
            const combinedData = records.map(r => r.totals.combined || 0);

            this.charts.trend.data.labels = labels;
            this.charts.trend.data.datasets[0].data = xiaoxiaoData;
            this.charts.trend.data.datasets[1].data = yunyunData;
            this.charts.trend.data.datasets[2].data = combinedData;

            console.log('更新趋势图数据:', { labels, xiaoxiaoData, yunyunData, combinedData });
        }
        
        this.charts.trend.update();
    }

    initAnalysisCharts() {
        // 销毁已存在的图表，防止重复创建
        if (this.charts.assetTrend) this.charts.assetTrend.destroy();
        if (this.charts.distribution) this.charts.distribution.destroy();
        if (this.charts.change) this.charts.change.destroy();
        if (this.charts.comparison) this.charts.comparison.destroy();
    }

    updateAnalysisCharts() {
        const timeRange = parseInt(document.getElementById('timeRange').value);
        this.updateAssetTrendChart(timeRange);
        this.updateDistributionChart();
        this.updateChangeChart(timeRange);
        this.updateComparisonChart();
    }

    updateAssetTrendChart(months) {
        const ctx = document.getElementById('assetTrendChart').getContext('2d');
        const isMobile = this.isMobileView();
        
        if (this.charts.assetTrend) {
            this.charts.assetTrend.destroy();
        }

        const records = this.data.monthlyRecords
            .slice()
            .sort((a, b) => new Date(a.recordDate) - new Date(b.recordDate))
            .slice(-months);

        this.charts.assetTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: records.map(r => `${r.year}年${r.month}月`),
                datasets: [
                    {
                        label: '肖肖',
                        data: records.map(r => r.totals.xiaoxiao || 0),
                        borderColor: '#e91e63',
                        backgroundColor: 'rgba(233, 30, 99, 0.1)',
                        tension: 0.4
                    },
                    {
                        label: '运运',
                        data: records.map(r => r.totals.yunyun || 0),
                        borderColor: '#2196f3',
                        backgroundColor: 'rgba(33, 150, 243, 0.1)',
                        tension: 0.4
                    },
                    {
                        label: '家庭总计',
                        data: records.map(r => r.totals.combined || 0),
                        borderColor: '#ff9800',
                        backgroundColor: 'rgba(255, 152, 0, 0.1)',
                        tension: 0.4,
                        borderWidth: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: isMobile ? 'bottom' : 'top',
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '¥' + value.toLocaleString('zh-CN');
                            }
                        }
                    }
                }
            }
        });
    }

    updateDistributionChart() {
        const ctx = document.getElementById('distributionChart').getContext('2d');
        
        if (this.charts.distribution) {
            this.charts.distribution.destroy();
        }

        const latestRecord = this.data.monthlyRecords[0];
        if (!latestRecord) return;

        const tagOptions = this.getAllocationTagOptions();
        const totalsByTag = tagOptions.reduce((acc, option) => {
            acc[option.value] = 0;
            return acc;
        }, {});
        const latestRates = latestRecord.fxSnapshot && latestRecord.fxSnapshot.rates
            ? latestRecord.fxSnapshot.rates
            : { [FX_BASE_CURRENCY]: 1 };

        this.data.accountTypes.forEach(account => {
            let amountInCny = 0;
            if (this.isStockAccount(account)) {
                amountInCny = this.data.settings.users.reduce((sum, user) => {
                    const storedValuation = latestRecord.stockSnapshot
                        && latestRecord.stockSnapshot.valuations
                        && latestRecord.stockSnapshot.valuations[user.id]
                        ? latestRecord.stockSnapshot.valuations[user.id][account.id]
                        : null;
                    if (storedValuation && Number.isFinite(Number(storedValuation.valueCny))) {
                        return sum + Number(storedValuation.valueCny);
                    }

                    const shares = Number(latestRecord.balances[user.id]?.[account.id] || 0);
                    const quote = latestRecord.stockSnapshot && latestRecord.stockSnapshot.quotes
                        ? latestRecord.stockSnapshot.quotes[account.id]
                        : null;
                    const previousClose = Number(quote && quote.previousClose);
                    if (!Number.isFinite(previousClose) || previousClose <= 0) return sum;

                    const stockCurrency = this.normalizeCurrency((quote && quote.currency) || account.currency);
                    const fxRate = Number(latestRates[stockCurrency]) > 0
                        ? Number(latestRates[stockCurrency])
                        : (stockCurrency === FX_BASE_CURRENCY ? 1 : 0);
                    if (!Number.isFinite(fxRate) || fxRate <= 0) return sum;
                    return sum + shares * previousClose * fxRate;
                }, 0);
            } else {
                const currency = this.normalizeCurrency(account.currency);
                const rate = Number(latestRates[currency]) > 0
                    ? Number(latestRates[currency])
                    : (currency === FX_BASE_CURRENCY ? 1 : 1);
                amountInCny = this.data.settings.users.reduce((sum, user) => {
                    const rawAmount = latestRecord.balances[user.id]?.[account.id] || 0;
                    return sum + rawAmount * rate;
                }, 0);
            }
            
            const tag = this.normalizeAllocationTag(account.allocationTag, account.category);
            totalsByTag[tag] += amountInCny;
        });

        const values = tagOptions.map(option => totalsByTag[option.value] || 0);
        const totalAmount = values.reduce((sum, value) => sum + value, 0);
        const labels = tagOptions.map(option => {
            const amount = totalsByTag[option.value] || 0;
            const percent = totalAmount > 0 ? (amount / totalAmount) * 100 : 0;
            return `${option.label}（${percent.toFixed(1)}%）`;
        });
        const colors = tagOptions.map(option => option.color);

        this.charts.distribution = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = Number(context.parsed) || 0;
                                const percent = totalAmount > 0 ? (value / totalAmount) * 100 : 0;
                                return `${context.label}: ¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}（${percent.toFixed(1)}%）`;
                            }
                        }
                    }
                }
            }
        });
    }

    updateChangeChart(months) {
        const ctx = document.getElementById('changeChart').getContext('2d');
        const isMobile = this.isMobileView();
        
        if (this.charts.change) {
            this.charts.change.destroy();
        }

        const records = this.data.monthlyRecords
            .slice()
            .sort((a, b) => new Date(a.recordDate) - new Date(b.recordDate))
            .slice(-months);

        this.charts.change = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: records.map(r => `${r.year}年${r.month}月`),
                datasets: [
                    {
                        label: '肖肖变化',
                        data: records.map(r => r.changes.xiaoxiao || 0),
                        backgroundColor: '#e91e63',
                        borderRadius: 4
                    },
                    {
                        label: '运运变化',
                        data: records.map(r => r.changes.yunyun || 0),
                        backgroundColor: '#2196f3',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: isMobile ? 'bottom' : 'top',
                    }
                },
                scales: {
                    y: {
                        ticks: {
                            callback: function(value) {
                                return '¥' + value.toLocaleString('zh-CN');
                            }
                        }
                    }
                }
            }
        });
    }

    updateComparisonChart() {
        const ctx = document.getElementById('comparisonChart').getContext('2d');
        const isMobile = this.isMobileView();
        
        if (this.charts.comparison) {
            this.charts.comparison.destroy();
        }

        const latestRecord = this.data.monthlyRecords[0];
        if (!latestRecord) return;

        this.charts.comparison = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['当前资产'],
                datasets: [
                    {
                        label: '肖肖',
                        data: [latestRecord.totals.xiaoxiao || 0],
                        backgroundColor: '#e91e63',
                        borderRadius: 4
                    },
                    {
                        label: '运运',
                        data: [latestRecord.totals.yunyun || 0],
                        backgroundColor: '#2196f3',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: isMobile ? 'bottom' : 'top',
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '¥' + value.toLocaleString('zh-CN');
                            }
                        }
                    }
                }
            }
        });
    }

    renderSettings() {
        const container = document.getElementById('accountTypesList');
        container.innerHTML = '';
        const ownerOrder = ['both', 'xiaoxiao', 'yunyun'];
        const ownerGroups = ownerOrder.map(ownerId => ({
            ownerId,
            label: this.getOwnerLabel(ownerId),
            accounts: this.data.accountTypes.filter(account => (account.ownerId || 'both') === ownerId)
        }));

        ownerGroups.forEach(ownerGroup => {
            if (ownerGroup.accounts.length === 0) return;

            const ownerNode = document.createElement('div');
            ownerNode.className = 'settings-owner-group';
            ownerNode.innerHTML = `
                <div class="settings-owner-title">${ownerGroup.label}（${ownerGroup.accounts.length}项）</div>
                <div class="settings-owner-platforms"></div>
            `;
            const platformContainer = ownerNode.querySelector('.settings-owner-platforms');
            const platformGroups = this.groupAccountsByPlatform(ownerGroup.accounts);

            platformGroups.forEach(platformGroup => {
                const platformNode = document.createElement('div');
                platformNode.className = 'settings-platform-group';
                platformNode.innerHTML = `
                    <div class="settings-platform-header">
                        <span class="settings-platform-icon">${platformGroup.icon}</span>
                        <span class="settings-platform-name">${platformGroup.platform}</span>
                        <span class="settings-platform-actions">
                            <span class="settings-platform-count">${platformGroup.accounts.length}个产品</span>
                        </span>
                    </div>
                    <div class="settings-platform-products"></div>
                `;
                const productContainer = platformNode.querySelector('.settings-platform-products');
                const platformActions = platformNode.querySelector('.settings-platform-actions');
                const sampleAccount = platformGroup.accounts[0] || {};
                const addProductBtn = document.createElement('button');
                addProductBtn.type = 'button';
                addProductBtn.className = 'btn btn-secondary settings-platform-add-btn';
                addProductBtn.textContent = '＋同平台新增产品';
                addProductBtn.setAttribute('data-platform', platformGroup.platform || '');
                addProductBtn.setAttribute('data-owner-id', ownerGroup.ownerId || 'both');
                addProductBtn.setAttribute('data-currency', this.normalizeCurrency(sampleAccount.currency || 'CNY'));
                addProductBtn.setAttribute('data-icon', sampleAccount.icon || platformGroup.icon || this.guessIconByPlatform(platformGroup.platform));
                addProductBtn.setAttribute('data-color', sampleAccount.color || this.guessColorByPlatform(platformGroup.platform));
                addProductBtn.setAttribute('data-category', sampleAccount.category || 'other');
                addProductBtn.setAttribute('data-allocation-tag', this.normalizeAllocationTag(sampleAccount.allocationTag, sampleAccount.category));
                if (platformActions) {
                    platformActions.appendChild(addProductBtn);
                }

                platformGroup.accounts.forEach(account => {
                    const allocationTag = this.normalizeAllocationTag(account.allocationTag, account.category);
                    const stockCodeTag = this.isStockAccount(account) && this.getStockDisplayCode(account)
                        ? `<span>代码 ${this.getStockDisplayCode(account)}</span>`
                        : '';
                    const item = document.createElement('div');
                    item.className = 'account-type-item';
                    item.innerHTML = `
                        <div class="account-type-info">
                            <span class="account-type-icon">${account.icon}</span>
                            <div class="account-type-main">
                                <div class="account-type-title">${account.name}</div>
                                <div class="account-type-meta">
                                    <span>${this.getCurrencyLabel(account.currency)}</span>
                                    ${stockCodeTag}
                                    <span class="allocation-tag-badge tag-${allocationTag}">${this.getAllocationTagLabel(allocationTag)}</span>
                                </div>
                            </div>
                        </div>
                        <div class="account-type-actions">
                            <select class="form-select allocation-tag-select" data-account-id="${account.id}">
                                ${this.getAllocationTagOptions().map(option => `
                                    <option value="${option.value}" ${option.value === allocationTag ? 'selected' : ''}>${option.label}</option>
                                `).join('')}
                            </select>
                        </div>
                    `;
                    const actionContainer = item.querySelector('.account-type-actions');
                    const editBtn = document.createElement('button');
                    editBtn.type = 'button';
                    editBtn.className = 'btn btn-secondary';
                    editBtn.textContent = '编辑';
                    editBtn.addEventListener('click', () => {
                        this.showAddAccountTypeModal({
                            editAccountId: account.id,
                            platform: account.platform,
                            name: account.name,
                            ownerId: account.ownerId || 'both',
                            currency: account.currency,
                            icon: account.icon,
                            color: account.color,
                            category: account.category,
                            stockCode: this.getStockDisplayCode(account)
                        });
                    });

                    const deleteBtn = document.createElement('button');
                    deleteBtn.type = 'button';
                    deleteBtn.className = 'btn btn-danger';
                    deleteBtn.textContent = '删除';
                    deleteBtn.addEventListener('click', () => this.removeAccountType(account.id));

                    if (actionContainer) {
                        actionContainer.appendChild(editBtn);
                        actionContainer.appendChild(deleteBtn);
                    }
                    productContainer.appendChild(item);
                });

                platformContainer.appendChild(platformNode);
            });

            container.appendChild(ownerNode);
        });

        this.bindSettingsPlatformQuickAddEvents();
        this.bindSettingsAllocationTagEvents();

        // 更新系统信息
        document.getElementById('dataCount').textContent = this.data.monthlyRecords.length;
        const lastRecord = this.data.monthlyRecords[0];
        document.getElementById('lastRecord').textContent = lastRecord ? 
            `${lastRecord.year}年${lastRecord.month}月` : '--';

        const syncSettings = this.data.settings.sync || this.getDefaultSyncSettings();
        const emailInput = document.getElementById('supabaseEmail');
        const autoSyncToggle = document.getElementById('autoSyncToggle');

        if (emailInput) emailInput.value = syncSettings.email || '';
        if (autoSyncToggle) autoSyncToggle.checked = Boolean(syncSettings.autoSync);

        this.updateSyncStatusDisplay();
    }

    bindSettingsPlatformQuickAddEvents() {
        document.querySelectorAll('.settings-platform-add-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.showAddAccountTypeModal({
                    platform: btn.getAttribute('data-platform') || '',
                    ownerId: btn.getAttribute('data-owner-id') || 'both',
                    currency: btn.getAttribute('data-currency') || 'CNY',
                    icon: btn.getAttribute('data-icon') || '',
                    color: btn.getAttribute('data-color') || '',
                    category: btn.getAttribute('data-category') || 'other',
                    allocationTag: btn.getAttribute('data-allocation-tag') || 'flexible',
                    lockPlatform: true
                });
            });
        });
    }

    bindSettingsAllocationTagEvents() {
        document.querySelectorAll('.allocation-tag-select').forEach(select => {
            select.addEventListener('change', async (event) => {
                const accountId = event.target.getAttribute('data-account-id');
                if (!accountId) return;
                const targetAccount = this.data.accountTypes.find(account => account.id === accountId);
                if (!targetAccount) return;

                const nextTag = this.normalizeAllocationTag(event.target.value, targetAccount.category);
                const currentTag = this.normalizeAllocationTag(targetAccount.allocationTag, targetAccount.category);
                if (currentTag === nextTag) return;

                targetAccount.allocationTag = nextTag;
                targetAccount.updatedAt = new Date().toISOString();
                await this.saveData();
                this.renderSettings();
                this.updateAnalysisCharts();
            });
        });
    }

    async sendSyncMagicLink() {
        const email = document.getElementById('supabaseEmail').value.trim();
        if (!email) {
            alert('请先输入登录邮箱');
            return;
        }

        try {
            this.data.settings.sync.email = email;
            await this.saveData({ markDirty: false, triggerAutoSync: false });
            await this.syncService.sendMagicLink(email);
            this.syncService.runtimeStatus = '登录链接已发送';
            this.updateSyncStatusDisplay();
            alert('登录链接已发送，请去邮箱点击 Magic Link 完成登录');
        } catch (error) {
            alert(`发送登录链接失败：${error.message}`);
        }
    }

    async logoutSync() {
        try {
            await this.syncService.signOut();
            this.updateSyncStatusDisplay();
            this.renderSettings();
            alert('已退出 Supabase 登录');
        } catch (error) {
            alert(`退出失败：${error.message}`);
        }
    }

    async syncNow() {
        try {
            const result = await this.syncService.syncNow('manual');
            this.renderSettings();
            if (result.ok) {
                alert(result.message);
            } else {
                alert(`同步未完成：${result.message}`);
            }
        } catch (error) {
            alert(`同步失败：${error.message}`);
        }
    }

    showAddAccountTypeModal(preset = {}) {
        const editAccountId = String(preset.editAccountId || '').trim();
        const isEditMode = Boolean(editAccountId);
        document.getElementById('modalTitle').textContent = isEditMode ? '编辑资产明细项' : '添加资产明细项（支持同平台批量）';

        const defaultPlatform = String(preset.platform || '').trim();
        const defaultName = String(preset.name || '').trim();
        const defaultOwner = ['xiaoxiao', 'yunyun', 'both'].includes(preset.ownerId) ? preset.ownerId : 'both';
        const defaultCurrency = this.normalizeCurrency(preset.currency || 'CNY');
        const defaultCategory = ['bank', 'payment', 'investment', 'cash', 'stock', 'other'].includes(preset.category)
            ? preset.category
            : 'other';
        const defaultStockCode = String(preset.stockCode || '').trim().toUpperCase();
        const parsedDefaultStock = this.parseStockCode(defaultStockCode);
        const normalizedDefaultCurrency = parsedDefaultStock ? parsedDefaultStock.currency : defaultCurrency;
        const defaultAllocationTag = this.normalizeAllocationTag(preset.allocationTag, defaultCategory);
        const defaultIcon = String(
            preset.icon ||
            this.guessIconByPlatform(defaultPlatform || '银行') ||
            '🏦'
        ).trim() || '🏦';
        const defaultColor = String(
            preset.color ||
            this.guessColorByPlatform(defaultPlatform || '银行') ||
            '#d32f2f'
        ).trim() || '#d32f2f';
        const lockPlatform = Boolean(defaultPlatform && preset.lockPlatform && !isEditMode);

        const presetIcons = [
            // 银行类
            '🏦', '🏛️', '🏪', '🏢', '🏬', '🏭', '🏡', '🏠',
            // 金融类
            '💳', '💰', '💵', '💴', '💶', '💷', '💸', '🪙', '💎', '💼',
            // 支付类
            '💬', '📱', '💻', '📲', '⌚', '📺', '🖥️', '⌨️',
            // 投资类
            '📊', '📈', '📉', '📋', '📄', '📜', '🔒', '🔐', '🗝️', '🔑',
            // 购物类
            '🛒', '🛍️', '🛒', '🎁', '🎯', '🎪', '🎨', '🎵', '🎮', '⚽',
            // 生活类
            '🚗', '🚕', '🚌', '🚇', '✈️', '🏠', '🏥', '🏫', '⛽', '🍎'
        ];
        
        const presetColors = [
            '#d32f2f', '#1976d2', '#388e3c', '#f57c00', '#7b1fa2', '#5d4037',
            '#455a64', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3',
            '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39',
            '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#795548', '#9e9e9e'
        ];

        document.getElementById('modalBody').innerHTML = `
            <div style="display: grid; gap: 20px;">
                <p style="margin: 0; color: #4f5d75; background: #eef3ff; border: 1px solid #d6e2ff; border-radius: 8px; padding: 10px 12px;">
                    ${isEditMode
                        ? '可直接修改平台、产品、归属、币种、图标和类别。'
                        : '同一平台可一次输入多个产品：普通资产可写“产品名 | 币种”（示例：美元理财 | USD）；股票类别可写“股票名 | 代码”（示例：美团-W | 3690）。'
                    }
                </p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div>
                        <label style="font-weight: 500; margin-bottom: 8px; display: block;">平台：</label>
                        <input type="text" id="newAccountPlatform" class="form-input" style="width: 100%;" placeholder="如：招行 / 支付宝 / 汇丰">
                    </div>
                    <div>
                        <label style="font-weight: 500; margin-bottom: 8px; display: block;">${isEditMode ? '产品名称：' : '单个产品（可选）：'}</label>
                        <input type="text" id="newAccountName" class="form-input" style="width: 100%;" placeholder="${isEditMode ? '如：朝朝宝' : '如：朝朝宝（可留空）'}">
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div>
                        <label style="font-weight: 500; margin-bottom: 8px; display: block;">归属用户：</label>
                        <select id="newAccountOwner" class="form-select" style="width: 100%;">
                            <option value="xiaoxiao">肖肖专用</option>
                            <option value="yunyun">运运专用</option>
                            <option value="both">双方共用</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-weight: 500; margin-bottom: 8px; display: block;">币种：</label>
                        <select id="newAccountCurrency" class="form-select" style="width: 100%;">
                            <option value="CNY">人民币（CNY）</option>
                            <option value="USD">美元（USD）</option>
                            <option value="HKD">港币（HKD）</option>
                            <option value="EUR">欧元（EUR）</option>
                            <option value="GBP">英镑（GBP）</option>
                        </select>
                    </div>
                </div>

                <div id="stockCodeFieldRow" style="display: none;">
                    <label style="font-weight: 500; margin-bottom: 8px; display: block;">股票代码（股票类别必填）：</label>
                    <input
                        type="text"
                        id="newAccountStockCode"
                        class="form-input"
                        style="width: 100%;"
                        placeholder="如：3690 / HK03690 / 600519 / SZ000001"
                    >
                    <p style="margin: 8px 0 0; color: #667085; font-size: 0.82rem;">将自动识别市场和币种，估值时按前一交易日收盘价折算人民币。</p>
                </div>
                ${isEditMode ? '' : `
                    <div>
                        <label style="font-weight: 500; margin-bottom: 8px; display: block;">同平台产品列表（推荐）：</label>
                        <textarea
                            id="newAccountNamesBulk"
                            class="form-input"
                            style="width: 100%; min-height: 120px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;"
                            placeholder="朝朝宝
活期存款
理财产品A
美元理财 | USD"></textarea>
                    </div>
                `}
                
                <div>
                    <label style="font-weight: 500; margin-bottom: 8px; display: block;">选择图标：</label>
                    <div class="icon-grid" style="display: grid; grid-template-columns: repeat(10, 1fr); gap: 8px; margin-bottom: 10px; max-height: 200px; overflow-y: auto; padding: 10px; border: 1px solid #e0e0e0; border-radius: 6px;">
                        ${presetIcons.map(icon => `
                            <button type="button" class="icon-btn" data-icon="${icon}" style="
                                width: 35px; height: 35px; border: 2px solid #e0e0e0; background: white; 
                                border-radius: 6px; font-size: 18px; cursor: pointer; transition: all 0.2s;
                                display: flex; align-items: center; justify-content: center;
                            ">${icon}</button>
                        `).join('')}
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <span>选中图标：</span>
                        <span id="selectedIcon" style="font-size: 24px; padding: 8px; border: 2px solid #e0e0e0; border-radius: 6px; min-width: 40px; text-align: center;">🏦</span>
                        <span style="color: #666; font-size: 0.9rem;">或自定义：</span>
                        <input type="text" id="customIcon" style="width: 60px; padding: 6px; border: 1px solid #e0e0e0; border-radius: 4px; text-align: center;" placeholder="🏦">
                    </div>
                </div>
                
                <div>
                    <label style="font-weight: 500; margin-bottom: 8px; display: block;">选择颜色：</label>
                    <div style="display: grid; grid-template-columns: repeat(12, 1fr); gap: 6px; margin-bottom: 10px;">
                        ${presetColors.map(color => `
                            <button type="button" class="color-btn" data-color="${color}" style="
                                width: 30px; height: 30px; border: 2px solid #e0e0e0; background: ${color}; 
                                border-radius: 50%; cursor: pointer; transition: all 0.2s;
                            "></button>
                        `).join('')}
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <span>选中颜色：</span>
                        <span id="selectedColor" style="
                            display: inline-block; width: 30px; height: 30px; border: 2px solid #e0e0e0; 
                            border-radius: 50%; background: #d32f2f;
                        "></span>
                        <span style="color: #666; font-size: 0.9rem;">或自定义：</span>
                        <input type="color" id="customColor" value="#d32f2f" style="width: 40px; height: 30px; border: none; border-radius: 4px; cursor: pointer;">
                    </div>
                </div>
                
                <div>
                    <label style="font-weight: 500; margin-bottom: 8px; display: block;">类别：</label>
                    <select id="newAccountCategory" class="form-select" style="width: 100%;">
                        <option value="bank">银行</option>
                        <option value="payment">支付平台</option>
                        <option value="investment">投资账户</option>
                        <option value="stock">股票</option>
                        <option value="cash">现金</option>
                        <option value="other">其他</option>
                    </select>
                </div>

                <div>
                    <label style="font-weight: 500; margin-bottom: 8px; display: block;">资产标签（用于汇总占比）：</label>
                    <select id="newAccountAllocationTag" class="form-select" style="width: 100%;">
                        ${this.getAllocationTagOptions().map(option => `
                            <option value="${option.value}">${option.label}</option>
                        `).join('')}
                    </select>
                </div>
            </div>
        `;

        const platformInput = document.getElementById('newAccountPlatform');
        const ownerSelect = document.getElementById('newAccountOwner');
        const currencySelect = document.getElementById('newAccountCurrency');
        const categorySelect = document.getElementById('newAccountCategory');
        const stockCodeInput = document.getElementById('newAccountStockCode');
        const nameInput = document.getElementById('newAccountName');
        const allocationTagSelect = document.getElementById('newAccountAllocationTag');
        const selectedIcon = document.getElementById('selectedIcon');
        const customColorInput = document.getElementById('customColor');
        const selectedColor = document.getElementById('selectedColor');

        if (platformInput) {
            platformInput.value = defaultPlatform;
            platformInput.disabled = lockPlatform;
            if (lockPlatform) {
                platformInput.title = '已从平台分组快捷入口进入，平台已锁定';
            }
        }
        if (nameInput) nameInput.value = defaultName;
        if (ownerSelect) ownerSelect.value = defaultOwner;
        if (currencySelect) currencySelect.value = normalizedDefaultCurrency;
        if (categorySelect) categorySelect.value = defaultCategory;
        if (stockCodeInput) stockCodeInput.value = parsedDefaultStock ? parsedDefaultStock.normalizedCode : defaultStockCode;
        if (allocationTagSelect) allocationTagSelect.value = defaultAllocationTag;
        if (selectedIcon) selectedIcon.textContent = defaultIcon;
        if (customColorInput) customColorInput.value = defaultColor;
        if (selectedColor) selectedColor.style.background = defaultColor;

        if (categorySelect) {
            categorySelect.addEventListener('change', () => this.updateAddAccountCategoryUI());
        }
        if (stockCodeInput) {
            stockCodeInput.addEventListener('input', () => {
                if (!categorySelect || categorySelect.value !== 'stock' || !currencySelect) return;
                const parsed = this.parseStockCode(stockCodeInput.value);
                if (parsed) {
                    currencySelect.value = parsed.currency;
                }
            });
        }

        // 添加事件监听
        this.initAccountModalEvents();
        this.updateAddAccountCategoryUI();

        const modalConfirmBtn = document.getElementById('modalConfirm');
        if (modalConfirmBtn) {
            modalConfirmBtn.textContent = isEditMode ? '保存修改' : '确定';
            modalConfirmBtn.onclick = () => (
                isEditMode
                    ? this.updateAccountType(editAccountId)
                    : this.addAccountType()
            );
        }
        this.showModal();
    }

    showBatchImportAccountModal() {
        document.getElementById('modalTitle').textContent = '批量导入资产明细';
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('modalBody').innerHTML = `
            <div style="display: grid; gap: 14px;">
                <p style="margin: 0; color: #4f5d75; background: #eef3ff; border: 1px solid #d6e2ff; border-radius: 8px; padding: 10px 12px;">
                    直接粘贴 Excel 三列表格（平台 / 产品名称 / 当前金额）。金额里的币种会自动识别（如 USD / HKD）。
                </p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div>
                        <label style="font-weight: 500; margin-bottom: 8px; display: block;">归属用户：</label>
                        <select id="batchImportOwner" class="form-select" style="width: 100%;">
                            <option value="both" selected>双方共用</option>
                            <option value="xiaoxiao">肖肖</option>
                            <option value="yunyun">运运</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-weight: 500; margin-bottom: 8px; display: block;">记账日期：</label>
                        <input id="batchImportRecordDate" class="form-input" type="date" value="${today}" style="width: 100%;">
                    </div>
                </div>
                <label style="display: inline-flex; align-items: center; gap: 8px; font-weight: 500;">
                    <input id="batchImportApplyAmounts" type="checkbox" checked>
                    同步把金额填入记账页（导入后还需手动点“保存记录”）
                </label>
                <div>
                    <label style="font-weight: 500; margin-bottom: 8px; display: block;">明细表格内容：</label>
                    <textarea id="batchImportRows" class="form-input" style="width: 100%; min-height: 220px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;" placeholder="平台\t产品名称\t当前金额\n招行\t招行活期存款\t981,926.37 元\n支付宝\t余额宝\t377,621.79 元\n汇丰\t美元储蓄\t8,560.44 USD"></textarea>
                </div>
            </div>
        `;
        const modalConfirmBtn = document.getElementById('modalConfirm');
        if (modalConfirmBtn) {
            modalConfirmBtn.textContent = '导入明细';
            modalConfirmBtn.onclick = () => this.batchImportAccountTypes();
        }
        this.showModal();
    }

    inferCurrencyFromAmountText(amountText) {
        const raw = String(amountText || '').toUpperCase();
        if (raw.includes('USD') || raw.includes('US$')) return 'USD';
        if (raw.includes('HKD') || raw.includes('HK$')) return 'HKD';
        if (raw.includes('EUR') || raw.includes('€')) return 'EUR';
        if (raw.includes('GBP') || raw.includes('£')) return 'GBP';
        return 'CNY';
    }

    parseAmountFromText(amountText) {
        const normalized = String(amountText || '')
            .replace(/,/g, '')
            .replace(/[^\d.-]/g, '');
        const value = parseFloat(normalized);
        return Number.isFinite(value) ? value : 0;
    }

    parseImportedAssetRows(rawText) {
        return String(rawText || '')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                const columns = line.includes('\t')
                    ? line.split('\t').map(v => v.trim()).filter(Boolean)
                    : line.split(/\s{2,}/).map(v => v.trim()).filter(Boolean);

                if (columns.length < 2) return null;

                const platform = columns[0];
                const name = columns[1];
                const amountText = columns[2] || '';

                if ((platform === '平台' || platform === '平台名称') && String(name).includes('产品')) {
                    return null;
                }
                if (!platform || !name) return null;

                return {
                    platform,
                    name,
                    currency: this.inferCurrencyFromAmountText(amountText),
                    amount: this.parseAmountFromText(amountText)
                };
            })
            .filter(Boolean);
    }

    parseNewAccountProductRows(rawText, defaultCurrency) {
        const fallbackCurrency = this.normalizeCurrency(defaultCurrency || 'CNY');
        return String(rawText || '')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                let name = '';
                let currency = fallbackCurrency;

                if (line.includes('\t')) {
                    const columns = line.split('\t').map(value => value.trim()).filter(Boolean);
                    name = columns[0] || '';
                    currency = columns[1] || fallbackCurrency;
                } else if (line.includes('|') || line.includes('｜')) {
                    const separator = line.includes('|') ? '|' : '｜';
                    const [rawName, rawCurrency] = line.split(separator).map(value => value.trim());
                    name = rawName || '';
                    currency = rawCurrency || fallbackCurrency;
                } else {
                    const matched = line.match(/^(.*?)[,，\s]+(CNY|USD|HKD|EUR|GBP)$/i);
                    if (matched) {
                        name = (matched[1] || '').trim();
                        currency = matched[2] || fallbackCurrency;
                    } else {
                        name = line;
                    }
                }

                name = String(name || '').trim();
                if (!name) return null;

                return {
                    name,
                    currency: this.normalizeCurrency(currency || fallbackCurrency)
                };
            })
            .filter(Boolean);
    }

    parseNewStockProductRows(rawText) {
        return String(rawText || '')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                let name = '';
                let stockCode = '';
                if (line.includes('\t')) {
                    const columns = line.split('\t').map(value => value.trim()).filter(Boolean);
                    name = columns[0] || '';
                    stockCode = columns[1] || '';
                } else if (line.includes('|') || line.includes('｜')) {
                    const separator = line.includes('|') ? '|' : '｜';
                    const [rawName, rawCode] = line.split(separator).map(value => value.trim());
                    name = rawName || '';
                    stockCode = rawCode || '';
                } else {
                    const matched = line.match(/^(.*?)[,，\s]+([A-Z]{0,2}\d{4,6}(?:\.[A-Z]{2})?)$/i);
                    if (matched) {
                        name = (matched[1] || '').trim();
                        stockCode = (matched[2] || '').trim();
                    }
                }

                if (!name || !stockCode) return null;
                const parsed = this.parseStockCode(stockCode);
                if (!parsed) return null;
                return {
                    name,
                    currency: parsed.currency,
                    stockCode: parsed.normalizedCode,
                    stockSecid: parsed.secid,
                    stockMarket: parsed.market
                };
            })
            .filter(Boolean);
    }

    upsertAccountType(platform, name, ownerId, currency) {
        const normalizedCurrency = this.normalizeCurrency(currency);
        const existing = this.data.accountTypes.find(account =>
            account.platform === platform &&
            account.name === name &&
            (account.ownerId || 'both') === ownerId &&
            this.normalizeCurrency(account.currency) === normalizedCurrency
        );

        if (existing) {
            return { account: existing, isNew: false };
        }

        const newAccount = this.normalizeAccountType({
            id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            platform,
            name,
            ownerId,
            currency: normalizedCurrency,
            icon: this.guessIconByPlatform(platform),
            color: this.guessColorByPlatform(platform),
            category: 'other',
            allocationTag: 'flexible',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        this.data.accountTypes.push(newAccount);
        return { account: newAccount, isNew: true };
    }

    updateAddAccountCategoryUI() {
        const categorySelect = document.getElementById('newAccountCategory');
        if (!categorySelect) return;

        const isStockMode = categorySelect.value === 'stock';
        const stockCodeRow = document.getElementById('stockCodeFieldRow');
        const stockCodeInput = document.getElementById('newAccountStockCode');
        const currencySelect = document.getElementById('newAccountCurrency');
        const bulkTextarea = document.getElementById('newAccountNamesBulk');

        if (stockCodeRow) {
            stockCodeRow.style.display = isStockMode ? 'block' : 'none';
        }
        if (currencySelect) {
            currencySelect.disabled = isStockMode;
        }
        if (bulkTextarea) {
            bulkTextarea.placeholder = isStockMode
                ? `美团-W | 3690\n腾讯控股 | 0700\n贵州茅台 | 600519`
                : `朝朝宝\n活期存款\n理财产品A\n美元理财 | USD`;
        }

        if (isStockMode && stockCodeInput && currencySelect) {
            const parsed = this.parseStockCode(stockCodeInput.value);
            if (parsed) {
                currencySelect.value = parsed.currency;
            }
        }
    }

    initAccountModalEvents() {
        // 图标选择事件
        document.querySelectorAll('.icon-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // 重置所有图标按钮样式
                document.querySelectorAll('.icon-btn').forEach(b => {
                    b.style.border = '2px solid #e0e0e0';
                    b.style.background = 'white';
                });
                
                // 高亮选中的图标
                btn.style.border = '2px solid #667eea';
                btn.style.background = '#f3f4ff';
                
                // 更新显示
                const icon = btn.dataset.icon;
                document.getElementById('selectedIcon').textContent = icon;
                document.getElementById('customIcon').value = icon;
            });
        });

        // 颜色选择事件
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // 重置所有颜色按钮样式
                document.querySelectorAll('.color-btn').forEach(b => {
                    b.style.border = '2px solid #e0e0e0';
                    b.style.transform = 'scale(1)';
                });
                
                // 高亮选中的颜色
                btn.style.border = '3px solid #333';
                btn.style.transform = 'scale(1.1)';
                
                // 更新显示
                const color = btn.dataset.color;
                document.getElementById('selectedColor').style.background = color;
                document.getElementById('customColor').value = color;
            });
        });

        // 自定义图标输入事件
        document.getElementById('customIcon').addEventListener('input', (e) => {
            const customIcon = e.target.value;
            if (customIcon) {
                document.getElementById('selectedIcon').textContent = customIcon;
                
                // 重置预设图标选择
                document.querySelectorAll('.icon-btn').forEach(b => {
                    b.style.border = '2px solid #e0e0e0';
                    b.style.background = 'white';
                });
            }
        });

        // 自定义颜色输入事件
        document.getElementById('customColor').addEventListener('input', (e) => {
            const customColor = e.target.value;
            document.getElementById('selectedColor').style.background = customColor;
            
            // 重置预设颜色选择
            document.querySelectorAll('.color-btn').forEach(b => {
                b.style.border = '2px solid #e0e0e0';
                b.style.transform = 'scale(1)';
            });
        });
    }

    async batchImportAccountTypes() {
        const ownerId = document.getElementById('batchImportOwner').value;
        const recordDate = document.getElementById('batchImportRecordDate').value;
        const applyAmounts = Boolean(document.getElementById('batchImportApplyAmounts').checked);
        const rawRows = document.getElementById('batchImportRows').value;
        const rows = this.parseImportedAssetRows(rawRows);

        if (rows.length === 0) {
            alert('未解析到有效明细，请检查粘贴内容（至少包含平台和产品名称两列）');
            return;
        }

        let newCount = 0;
        const importedValues = [];

        rows.forEach(row => {
            const { account, isNew } = this.upsertAccountType(
                row.platform,
                row.name,
                ownerId,
                row.currency
            );
            if (isNew) newCount += 1;
            importedValues.push({
                accountId: account.id,
                amount: row.amount
            });
        });

        this.renderAccountInputs();

        if (applyAmounts) {
            const targetDate = recordDate || new Date().toISOString().split('T')[0];
            this.switchTab('record');
            document.getElementById('recordDate').value = targetDate;
            this.loadRecordByDate();
            const targetUserIds = ownerId === 'both'
                ? this.data.settings.users.map(user => user.id)
                : [ownerId];

            importedValues.forEach(item => {
                targetUserIds.forEach(userId => {
                    const input = document.querySelector(`[data-user="${userId}"][data-account="${item.accountId}"]`);
                    if (input) {
                        input.value = item.amount === 0 ? '0' : String(item.amount);
                    }
                });
            });
            this.updateRecordTotals();
        }

        await this.saveData();
        this.renderSettings();
        this.hideModal();

        const applyTip = applyAmounts ? '，金额已回填到记账页（请手动点击“保存记录”）' : '';
        alert(`已导入 ${rows.length} 条明细，新增 ${newCount} 条资产模板${applyTip}`);
    }

    async addAccountType() {
        const platform = document.getElementById('newAccountPlatform').value.trim();
        const singleName = document.getElementById('newAccountName').value.trim();
        const bulkProductText = document.getElementById('newAccountNamesBulk')
            ? document.getElementById('newAccountNamesBulk').value
            : '';
        const ownerId = document.getElementById('newAccountOwner').value;
        const currency = this.normalizeCurrency(document.getElementById('newAccountCurrency').value);
        const stockCodeInput = document.getElementById('newAccountStockCode');
        const singleStockCode = stockCodeInput ? stockCodeInput.value.trim() : '';
        const selectedIcon = document.getElementById('selectedIcon').textContent;
        const customIcon = document.getElementById('customIcon').value.trim();
        const selectedColor = document.getElementById('customColor').value;
        const category = document.getElementById('newAccountCategory').value;
        const isStockMode = category === 'stock';
        const allocationTag = this.normalizeAllocationTag(
            document.getElementById('newAccountAllocationTag').value,
            category
        );

        // 优先使用自定义图标，否则使用选中的预设图标
        const icon = customIcon || selectedIcon;

        const draftProducts = [];
        if (isStockMode) {
            if (singleName && singleStockCode) {
                const parsedSingleStock = this.parseStockCode(singleStockCode);
                if (!parsedSingleStock) {
                    alert('股票代码格式不正确，请输入如 3690 / HK03690 / 600519 / SZ000001');
                    return;
                }
                draftProducts.push({
                    name: singleName,
                    currency: parsedSingleStock.currency,
                    stockCode: parsedSingleStock.normalizedCode,
                    stockSecid: parsedSingleStock.secid,
                    stockMarket: parsedSingleStock.market
                });
            }
            draftProducts.push(...this.parseNewStockProductRows(bulkProductText));
        } else {
            if (singleName) {
                draftProducts.push({ name: singleName, currency });
            }
            draftProducts.push(...this.parseNewAccountProductRows(bulkProductText, currency));
        }

        if (!platform || !icon || draftProducts.length === 0) {
            alert(
                isStockMode
                    ? '请填写平台，并至少输入一条“股票名称 + 股票代码”（单个或列表），再选择图标'
                    : '请填写平台，并至少输入一个产品（单个或列表），再选择图标'
            );
            return;
        }

        const uniqueProducts = [];
        const productKeySet = new Set();
        draftProducts.forEach(item => {
            const normalizedName = String(item.name || '').trim();
            const normalizedCurrency = this.normalizeCurrency(item.currency || currency);
            if (!normalizedName) return;
            const normalizedStockCode = isStockMode ? String(item.stockCode || '').trim().toUpperCase() : '';
            if (isStockMode && !normalizedStockCode) return;
            const key = isStockMode
                ? `${normalizedName}__${normalizedStockCode}`
                : `${normalizedName}__${normalizedCurrency}`;
            if (productKeySet.has(key)) return;
            productKeySet.add(key);
            uniqueProducts.push({
                name: normalizedName,
                currency: normalizedCurrency,
                stockCode: normalizedStockCode,
                stockSecid: isStockMode ? String(item.stockSecid || '').trim() : '',
                stockMarket: isStockMode ? String(item.stockMarket || '').trim().toLowerCase() : ''
            });
        });

        let addedCount = 0;
        let skippedCount = draftProducts.length - uniqueProducts.length;
        const addedAccounts = [];
        const now = new Date().toISOString();

        uniqueProducts.forEach((product, index) => {
            const exists = this.data.accountTypes.find(acc =>
                acc.platform === platform &&
                acc.name === product.name &&
                (acc.ownerId || 'both') === ownerId &&
                this.normalizeCurrency(acc.currency) === product.currency &&
                (
                    !isStockMode ||
                    this.getStockDisplayCode(acc) === product.stockCode
                )
            );
            if (exists) {
                skippedCount += 1;
                return;
            }

            const newAccount = this.normalizeAccountType({
                id: `custom_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
                platform,
                name: product.name,
                ownerId,
                currency: product.currency,
                icon,
                color: selectedColor,
                category,
                stockCode: isStockMode ? product.stockCode : '',
                stockSecid: isStockMode ? product.stockSecid : '',
                stockMarket: isStockMode ? product.stockMarket : '',
                allocationTag,
                createdAt: now,
                updatedAt: now
            });

            this.data.accountTypes.push(newAccount);
            addedAccounts.push(newAccount);
            addedCount += 1;
        });

        if (addedCount === 0) {
            alert(isStockMode
                ? '未新增：输入的股票都已存在（同平台 + 同归属 + 同代码）'
                : '未新增：输入的产品都已存在（同平台 + 同归属 + 同币种）');
            return;
        }

        await this.saveData();
        this.renderAccountInputs();
        this.renderSettings();
        this.hideModal();

        const skipTip = skippedCount > 0 ? `，跳过 ${skippedCount} 条重复项` : '';
        alert(`已在「${platform}」下新增 ${addedCount} 条产品${skipTip}`);
        console.log('✅ 新账户已添加:', addedAccounts);
    }

    async updateAccountType(accountId) {
        const index = this.data.accountTypes.findIndex(account => account.id === accountId);
        if (index < 0) {
            alert('要修改的明细不存在，请刷新后重试');
            return;
        }

        const platform = document.getElementById('newAccountPlatform').value.trim();
        const name = document.getElementById('newAccountName').value.trim();
        const ownerId = document.getElementById('newAccountOwner').value;
        const currency = this.normalizeCurrency(document.getElementById('newAccountCurrency').value);
        const stockCodeInput = document.getElementById('newAccountStockCode');
        const stockCodeRaw = stockCodeInput ? stockCodeInput.value.trim() : '';
        const selectedIcon = document.getElementById('selectedIcon').textContent;
        const customIcon = document.getElementById('customIcon').value.trim();
        const selectedColor = document.getElementById('customColor').value;
        const category = document.getElementById('newAccountCategory').value;
        const isStockMode = category === 'stock';

        const icon = customIcon || selectedIcon;
        if (!platform || !name || !icon) {
            alert('请填写平台、产品名称并选择图标');
            return;
        }

        let resolvedCurrency = currency;
        let normalizedStockCode = '';
        let stockSecid = '';
        let stockMarket = '';
        if (isStockMode) {
            const parsed = this.parseStockCode(stockCodeRaw);
            if (!parsed) {
                alert('股票代码格式不正确，请输入如 3690 / HK03690 / 600519 / SZ000001');
                return;
            }
            resolvedCurrency = parsed.currency;
            normalizedStockCode = parsed.normalizedCode;
            stockSecid = parsed.secid;
            stockMarket = parsed.market;
        }

        const duplicate = this.data.accountTypes.find((account, accountIndex) =>
            accountIndex !== index &&
            account.platform === platform &&
            account.name === name &&
            (account.ownerId || 'both') === ownerId &&
            this.normalizeCurrency(account.currency) === resolvedCurrency &&
            (
                !isStockMode ||
                this.getStockDisplayCode(account) === normalizedStockCode
            )
        );
        if (duplicate) {
            alert(isStockMode
                ? '已存在相同的「平台 + 股票 + 归属 + 代码」明细，请调整后再保存'
                : '已存在相同的「平台 + 产品 + 归属 + 币种」明细，请调整后再保存');
            return;
        }

        const current = this.data.accountTypes[index];
        const updated = this.normalizeAccountType({
            ...current,
            platform,
            name,
            ownerId,
            currency: resolvedCurrency,
            icon,
            color: selectedColor,
            category,
            stockCode: isStockMode ? normalizedStockCode : '',
            stockSecid: isStockMode ? stockSecid : '',
            stockMarket: isStockMode ? stockMarket : '',
            updatedAt: new Date().toISOString()
        });

        this.data.accountTypes[index] = updated;
        await this.saveData();
        this.renderAccountInputs();
        this.renderSettings();
        this.hideModal();
        alert(`已更新明细：${platform} / ${name}`);
    }

    removeAccountType(accountId) {
        const index = this.data.accountTypes.findIndex(account => account.id === accountId);
        if (index < 0) return;
        const target = this.data.accountTypes[index];

        if (confirm(`确定删除「${target.platform} / ${target.name}」吗？这将影响相关历史记录。`)) {
            this.data.accountTypes.splice(index, 1);
            this.saveData();
            this.renderAccountInputs();
            this.renderSettings();
        }
    }

    showModal() {
        document.getElementById('modal').style.display = 'block';
    }

    editRecord(recordId) {
        // 找到要编辑的记录
        const record = this.data.monthlyRecords.find(r => r.id === recordId);
        if (!record) {
            alert('记录不存在');
            return;
        }

        // 切换到记账页面
        this.switchTab('record');
        
        // 设置日期
        document.getElementById('recordDate').value = record.recordDate;
        
        // 加载记录数据
        this.loadRecordData(record);
        this.showRecordStatus('编辑模式：正在修改' + record.year + '年' + record.month + '月的记录', 'edit');
        this.saveButtonBaseText = '💾 更新记录';
        document.getElementById('saveRecordBtn').textContent = this.saveButtonBaseText;
        
        // 更新总计显示
        this.updateRecordTotals();
        
        console.log('📝 开始编辑记录:', record);
    }

    deleteRecord(recordId) {
        // 找到要删除的记录
        const record = this.data.monthlyRecords.find(r => r.id === recordId);
        if (!record) {
            alert('记录不存在');
            return;
        }

        // 确认删除
        if (!confirm(`确定要删除 ${record.year}年${record.month}月 的记录吗？\n\n家庭总资产：¥${record.totals.combined.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}\n\n此操作不可恢复！`)) {
            return;
        }

        // 删除记录
        this.data.monthlyRecords = this.data.monthlyRecords.filter(r => r.id !== recordId);
        
        // 重新计算所有记录的变化（因为删除记录可能影响其他记录的变化计算）
        this.recalculateAllChanges();
        
        this.saveData();
        this.updateOverview();
        this.updateAnalysisCharts();
        
        console.log('🗑️ 删除记录:', record);
        alert('记录删除成功！');
    }

    recalculateAllChanges() {
        // 按日期排序
        const sortedRecords = this.data.monthlyRecords
            .slice()
            .sort((a, b) => new Date(a.recordDate) - new Date(b.recordDate));

        // 重新计算每条记录的变化
        sortedRecords.forEach((record, index) => {
            if (index === 0) {
                // 第一条记录，变化为0
                record.changes = {
                    xiaoxiao: 0,
                    yunyun: 0,
                    combined: 0
                };
            } else {
                // 与前一条记录比较
                const previousRecord = sortedRecords[index - 1];
                record.changes = {
                    xiaoxiao: (record.totals.xiaoxiao || 0) - (previousRecord.totals.xiaoxiao || 0),
                    yunyun: (record.totals.yunyun || 0) - (previousRecord.totals.yunyun || 0),
                    combined: (record.totals.combined || 0) - (previousRecord.totals.combined || 0)
                };
            }
        });

        console.log('🔄 重新计算所有记录变化完成');
    }

    hideModal() {
        document.getElementById('modal').style.display = 'none';
    }

    exportData() {
        const dataStr = JSON.stringify(this.data, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `资产管理数据_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
    }

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const importedData = JSON.parse(e.target.result);
                    if (confirm('导入数据将覆盖当前所有数据，确定继续吗？')) {
                        this.data = this.mergeDataWithDefaults(importedData);
                        await this.saveData();
                        location.reload(); // 重新加载页面
                    }
                } catch (error) {
                    alert('导入失败：文件格式错误');
                }
            };
            reader.readAsText(file);
        };
        
        input.click();
    }

    async clearData() {
        if (confirm('确定清空所有数据吗？此操作不可恢复！')) {
            if (confirm('请再次确认：这将删除所有记账记录和设置！')) {
                await this.storage.remove(APP_DATA_KEY);
                await this.storage.remove(APP_SYNC_META_KEY);
                location.reload();
            }
        }
    }

    saveData(options = {}) {
        const { markDirty = true, triggerAutoSync = true } = options;

        if (markDirty) {
            this.syncMeta.localRevision += 1;
            this.syncMeta.lastModifiedAt = new Date().toISOString();
            this.syncMeta.dirty = true;
        }

        this.persistQueue = this.persistQueue
            .then(async () => {
                await this.storage.set(APP_DATA_KEY, this.data);
                await this.storage.set(APP_SYNC_META_KEY, this.syncMeta);
            })
            .catch(error => {
                console.error('保存 IndexedDB 数据失败:', error);
            });

        if (markDirty && triggerAutoSync) {
            this.syncService.scheduleAutoSync();
        }

        this.updateSyncStatusDisplay();
        return this.persistQueue;
    }

    async loadData() {
        try {
            const storedData = await this.storage.get(APP_DATA_KEY);
            const storedSyncMeta = await this.storage.get(APP_SYNC_META_KEY);

            if (storedData) {
                this.data = this.mergeDataWithDefaults(storedData);
            } else {
                this.data = this.mergeDataWithDefaults(this.data);
            }

            if (storedSyncMeta && typeof storedSyncMeta === 'object') {
                this.syncMeta = {
                    ...this.getDefaultSyncMeta(),
                    ...storedSyncMeta
                };
            }

            this.syncMeta.localRevision = Math.max(
                Number(this.syncMeta.localRevision) || 0,
                Number(this.syncMeta.lastSyncedRevision) || 0
            );
        } catch (error) {
            console.error('加载 IndexedDB 数据失败:', error);
            this.data = this.mergeDataWithDefaults(this.data);
            this.syncMeta = this.getDefaultSyncMeta();
        }
    }
}

// 初始化应用
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new CoupleAssetTracker();
    window.app = app;
});