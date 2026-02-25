const APP_DB_NAME = 'couple_asset_tracker_db';
const APP_DB_VERSION = 1;
const APP_KV_STORE = 'key_value_store';
const APP_DATA_KEY = 'app_data';
const APP_SYNC_META_KEY = 'sync_meta';
const SUPABASE_SYNC_TABLE = 'asset_documents';

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
        const syncSettings = this.app.data.settings.sync || {};
        return Boolean(syncSettings.supabaseUrl && syncSettings.supabasePublishableKey);
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

        const syncSettings = this.app.data.settings.sync || {};
        this.client = window.supabase.createClient(
            syncSettings.supabaseUrl,
            syncSettings.supabasePublishableKey,
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
        if (!this.isConfigured()) return '未配置';
        if (!this.user) return '已配置，未登录';
        return `已登录：${this.user.email || this.user.id}`;
    }

    getRuntimeStatusText() {
        return this.runtimeStatus;
    }

    async saveConfig(config) {
        this.app.data.settings.sync = {
            ...this.app.data.settings.sync,
            ...config
        };

        await this.app.saveData({ markDirty: false, triggerAutoSync: false });

        this.client = null;
        this.user = null;
        if (this.authSubscription) {
            this.authSubscription.unsubscribe();
            this.authSubscription = null;
        }

        await this.init();
        this.app.renderSettings();
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
            return { ok: false, message: '请先保存 Supabase 配置' };
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
        this.charts = {};
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
        this.initCharts();
        this.updateOverview();
        this.renderSettings();
        await this.syncService.init();
        this.updateSyncStatusDisplay();
    }

    getDefaultAccountTypes() {
        return [
            { id: 'cmbc', name: '招商银行', icon: '🏦', color: '#d32f2f', category: 'bank' },
            { id: 'icbc', name: '中国银行', icon: '🏛️', color: '#1976d2', category: 'bank' },
            { id: 'ccb', name: '建设银行', icon: '🏦', color: '#0d47a1', category: 'bank' },
            { id: 'wechat', name: '微信', icon: '💬', color: '#4caf50', category: 'payment' },
            { id: 'alipay', name: '支付宝', icon: '💰', color: '#2196f3', category: 'payment' },
            { id: 'cash', name: '现金', icon: '💵', color: '#ff9800', category: 'cash' }
        ];
    }

    getDefaultUsers() {
        return [
            { id: 'xiaoxiao', name: '肖肖', avatar: '👩', color: '#e91e63' },
            { id: 'yunyun', name: '运运', avatar: '👨', color: '#2196f3' }
        ];
    }

    getDefaultSyncSettings() {
        return {
            supabaseUrl: '',
            supabasePublishableKey: '',
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

        const merged = {
            ...defaults,
            ...source,
            monthlyRecords: Array.isArray(source.monthlyRecords) ? source.monthlyRecords : defaults.monthlyRecords,
            accountTypes: Array.isArray(source.accountTypes) && source.accountTypes.length > 0
                ? source.accountTypes
                : defaults.accountTypes,
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
        );

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
        this.data = this.mergeDataWithDefaults(remoteData);
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
        this.data = this.mergeDataWithDefaults(mergedData);
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
        document.getElementById('exportDataBtn').addEventListener('click', () => this.exportData());
        document.getElementById('importDataBtn').addEventListener('click', () => this.importData());
        document.getElementById('clearDataBtn').addEventListener('click', () => this.clearData());
        document.getElementById('saveSyncConfigBtn').addEventListener('click', () => this.saveSyncConfig());
        document.getElementById('supabaseLoginBtn').addEventListener('click', () => this.sendSyncMagicLink());
        document.getElementById('supabaseLogoutBtn').addEventListener('click', () => this.logoutSync());
        document.getElementById('syncNowBtn').addEventListener('click', () => this.syncNow());

        // 弹窗事件
        document.getElementById('closeModal').addEventListener('click', () => this.hideModal());
        document.getElementById('modalCancel').addEventListener('click', () => this.hideModal());
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
        }
    }

    updateCurrentMonth() {
        const now = new Date();
        const monthStr = `${now.getFullYear()}年${now.getMonth() + 1}月`;
        document.getElementById('currentMonth').textContent = monthStr;
    }

    renderAccountInputs() {
        const users = this.data.settings.users;
        
        users.forEach(user => {
            const container = document.getElementById(`${user.id}Accounts`);
            container.innerHTML = '';

            this.data.accountTypes.forEach(account => {
                const inputGroup = document.createElement('div');
                inputGroup.className = 'account-input-group';
                inputGroup.innerHTML = `
                    <span class="account-icon">${account.icon}</span>
                    <span class="account-label">${account.name}</span>
                    <input 
                        type="number" 
                        step="0.01" 
                        placeholder="0.00"
                        class="form-input account-input"
                        data-user="${user.id}"
                        data-account="${account.id}"
                    >
                `;
                container.appendChild(inputGroup);
            });

            // 添加输入事件监听
            container.querySelectorAll('.account-input').forEach(input => {
                input.addEventListener('input', () => this.updateRecordTotals());
            });
        });
    }

    initNewRecord() {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('recordDate').value = today;
        
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
        if (!selectedDate) return;

        const date = new Date(selectedDate);
        const recordId = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        // 查找是否有对应日期的记录
        const existingRecord = this.data.monthlyRecords.find(r => r.id === recordId);
        
        if (existingRecord) {
            // 加载已有记录
            this.loadRecordData(existingRecord);
            this.showRecordStatus('编辑模式：正在修改' + existingRecord.year + '年' + existingRecord.month + '月的记录', 'edit');
            document.getElementById('saveRecordBtn').textContent = '💾 更新记录';
        } else {
            // 清空输入，准备新记录
            this.clearRecordInputs();
            this.showRecordStatus('新记录模式：将创建' + date.getFullYear() + '年' + (date.getMonth() + 1) + '月的记录', 'new');
            document.getElementById('saveRecordBtn').textContent = '💾 保存记录';
        }
        
        this.updateRecordTotals();
    }

    loadRecordData(record) {
        // 填充各账户的余额数据
        this.data.settings.users.forEach(user => {
            this.data.accountTypes.forEach(account => {
                const input = document.querySelector(`[data-user="${user.id}"][data-account="${account.id}"]`);
                if (input && record.balances[user.id] && record.balances[user.id][account.id] !== undefined) {
                    input.value = record.balances[user.id][account.id];
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

    updateRecordTotals() {
        const users = this.data.settings.users;
        let familyTotal = 0;

        users.forEach(user => {
            let userTotal = 0;
            document.querySelectorAll(`[data-user="${user.id}"]`).forEach(input => {
                const value = parseFloat(input.value) || 0;
                userTotal += value;
            });
            
            document.getElementById(`${user.id}RecordTotal`).textContent = `¥${userTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
            familyTotal += userTotal;
        });

        document.getElementById('familyRecordTotal').textContent = `¥${familyTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
    }

    saveRecord() {
        const recordDate = document.getElementById('recordDate').value;
        if (!recordDate) {
            alert('请选择记账日期');
            return;
        }

        const date = new Date(recordDate);
        const recordId = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        // 收集余额数据
        const balances = {};
        const totals = {};
        let familyTotal = 0;

        this.data.settings.users.forEach(user => {
            balances[user.id] = {};
            let userTotal = 0;

            this.data.accountTypes.forEach(account => {
                const input = document.querySelector(`[data-user="${user.id}"][data-account="${account.id}"]`);
                const amount = parseFloat(input.value) || 0;
                balances[user.id][account.id] = amount;
                userTotal += amount;
            });

            totals[user.id] = userTotal;
            familyTotal += userTotal;
        });

        totals.combined = familyTotal;

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
                <div style="display: flex; align-items: center; gap: 10px;">
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
                        position: 'top',
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
                        radius: 4,
                        hoverRadius: 6
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
        
        if (this.charts.assetTrend) {
            this.charts.assetTrend.destroy();
        }

        const records = this.data.monthlyRecords
            .slice()
            .sort((a, b) => new Date(a.recordDate) - new Date(b.recordDate))
            .slice(-months);

        // 设置canvas固定尺寸
        ctx.canvas.width = 400;
        ctx.canvas.height = 300;

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
                responsive: false,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
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

        // 计算各账户类型的总金额
        const accountTotals = {};
        this.data.accountTypes.forEach(account => {
            accountTotals[account.name] = 0;
            this.data.settings.users.forEach(user => {
                accountTotals[account.name] += latestRecord.balances[user.id]?.[account.id] || 0;
            });
        });

        // 设置canvas固定尺寸
        ctx.canvas.width = 400;
        ctx.canvas.height = 300;

        this.charts.distribution = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(accountTotals),
                datasets: [{
                    data: Object.values(accountTotals),
                    backgroundColor: this.data.accountTypes.map(a => a.color),
                    borderWidth: 2
                }]
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                    }
                }
            }
        });
    }

    updateChangeChart(months) {
        const ctx = document.getElementById('changeChart').getContext('2d');
        
        if (this.charts.change) {
            this.charts.change.destroy();
        }

        const records = this.data.monthlyRecords
            .slice()
            .sort((a, b) => new Date(a.recordDate) - new Date(b.recordDate))
            .slice(-months);

        // 设置canvas固定尺寸
        ctx.canvas.width = 400;
        ctx.canvas.height = 300;

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
                responsive: false,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
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
        
        if (this.charts.comparison) {
            this.charts.comparison.destroy();
        }

        const latestRecord = this.data.monthlyRecords[0];
        if (!latestRecord) return;

        // 设置canvas固定尺寸
        ctx.canvas.width = 400;
        ctx.canvas.height = 300;

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
                responsive: false,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
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

        this.data.accountTypes.forEach((account, index) => {
            const item = document.createElement('div');
            item.className = 'account-type-item';
            item.innerHTML = `
                <div class="account-type-info">
                    <span class="account-type-icon">${account.icon}</span>
                    <span>${account.name}</span>
                </div>
                <button class="btn btn-danger" onclick="app.removeAccountType(${index})" style="padding: 4px 8px; font-size: 0.8rem;">删除</button>
            `;
            container.appendChild(item);
        });

        // 更新系统信息
        document.getElementById('dataCount').textContent = this.data.monthlyRecords.length;
        const lastRecord = this.data.monthlyRecords[0];
        document.getElementById('lastRecord').textContent = lastRecord ? 
            `${lastRecord.year}年${lastRecord.month}月` : '--';

        const syncSettings = this.data.settings.sync || this.getDefaultSyncSettings();
        const urlInput = document.getElementById('supabaseUrl');
        const keyInput = document.getElementById('supabasePublishableKey');
        const emailInput = document.getElementById('supabaseEmail');
        const autoSyncToggle = document.getElementById('autoSyncToggle');

        if (urlInput) urlInput.value = syncSettings.supabaseUrl || '';
        if (keyInput) keyInput.value = syncSettings.supabasePublishableKey || '';
        if (emailInput) emailInput.value = syncSettings.email || '';
        if (autoSyncToggle) autoSyncToggle.checked = Boolean(syncSettings.autoSync);

        this.updateSyncStatusDisplay();
    }

    async saveSyncConfig() {
        const supabaseUrl = document.getElementById('supabaseUrl').value.trim();
        const supabasePublishableKey = document.getElementById('supabasePublishableKey').value.trim();
        const email = document.getElementById('supabaseEmail').value.trim();
        const autoSync = document.getElementById('autoSyncToggle').checked;

        try {
            await this.syncService.saveConfig({
                supabaseUrl,
                supabasePublishableKey,
                email,
                autoSync
            });
            alert('同步配置已保存');
        } catch (error) {
            alert(`保存同步配置失败：${error.message}`);
        }
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

    showAddAccountTypeModal() {
        document.getElementById('modalTitle').textContent = '添加账户类型';
        
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
                <div>
                    <label style="font-weight: 500; margin-bottom: 8px; display: block;">账户名称：</label>
                    <input type="text" id="newAccountName" class="form-input" style="width: 100%;" placeholder="如：工商银行">
                </div>
                
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
                        <option value="cash">现金</option>
                        <option value="other">其他</option>
                    </select>
                </div>
            </div>
        `;
        
        // 添加事件监听
        this.initAccountModalEvents();
        
        document.getElementById('modalConfirm').onclick = () => this.addAccountType();
        this.showModal();
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

    addAccountType() {
        const name = document.getElementById('newAccountName').value.trim();
        const selectedIcon = document.getElementById('selectedIcon').textContent;
        const customIcon = document.getElementById('customIcon').value.trim();
        const selectedColor = document.getElementById('customColor').value;
        const category = document.getElementById('newAccountCategory').value;

        // 优先使用自定义图标，否则使用选中的预设图标
        const icon = customIcon || selectedIcon;

        if (!name || !icon) {
            alert('请填写账户名称和选择图标');
            return;
        }

        // 检查是否已存在相同名称的账户
        const existingAccount = this.data.accountTypes.find(acc => acc.name === name);
        if (existingAccount) {
            alert('账户名称已存在，请使用其他名称');
            return;
        }

        const newAccount = {
            id: 'custom_' + Date.now(),
            name,
            icon,
            color: selectedColor,
            category,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.data.accountTypes.push(newAccount);
        this.saveData();
        this.renderAccountInputs();
        this.renderSettings();
        this.hideModal();
        
        console.log('✅ 新账户已添加:', newAccount);
    }

    removeAccountType(index) {
        if (confirm('确定删除这个账户类型吗？这将影响所有相关记录。')) {
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
        document.getElementById('saveRecordBtn').textContent = '💾 更新记录';
        
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