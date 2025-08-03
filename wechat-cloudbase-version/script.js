// 微信云开发资产管理系统
class CloudbaseAssetTracker {
    constructor() {
        this.data = {
            monthlyRecords: [],
            accountTypes: this.getDefaultAccountTypes(),
            settings: {
                users: [
                    { id: 'xiaoxiao', name: '肖肖', avatar: '👩', color: '#e91e63' },
                    { id: 'yunyun', name: '运运', avatar: '👨', color: '#2196f3' }
                ]
            }
        };
        this.charts = {};
        this.cloudbase = null;
        this.currentUser = null;
        this.db = null;
        this.init();
    }

    async init() {
        // 初始化云开发
        await this.initCloudbase();
        
        // 初始化界面和事件
        this.initEventListeners();
        this.renderAccountInputs();
        this.updateCurrentMonth();
        this.initCharts();
        
        // 尝试自动登录
        await this.autoLogin();
        
        // 加载数据
        await this.loadData();
        this.updateOverview();
        this.renderSettings();
    }

    async initCloudbase() {
        try {
            // 初始化云开发 SDK
            this.cloudbase = cloudbase.init({
                env: 'cloud1-3g8s3xvm7609c639' // 你的云开发环境ID
            });
            
            // 获取数据库引用
            this.db = this.cloudbase.database();
            
            console.log('✅ 微信云开发初始化成功');
            this.updateSyncStatus('🟢 云开发已连接');
        } catch (error) {
            console.error('❌ 微信云开发初始化失败:', error);
            this.updateSyncStatus('🔴 云开发连接失败');
        }
    }

    async autoLogin() {
        try {
            // 尝试获取当前登录状态
            const loginState = await this.cloudbase.auth().getLoginState();
            if (loginState) {
                this.currentUser = loginState;
                this.updateUserInfo(loginState.user);
                this.updateSyncStatus('🟢 已登录');
                return true;
            }
        } catch (error) {
            console.log('未登录或登录状态过期');
        }
        return false;
    }

    async login() {
        try {
            this.updateSyncStatus('🔄 正在登录...');
            
            // 使用微信登录
            const loginResult = await this.cloudbase.auth().weixinAuthProvider().signIn();
            
            this.currentUser = loginResult;
            this.updateUserInfo(loginResult.user);
            this.updateSyncStatus('🟢 登录成功');
            
            // 登录成功后加载数据
            await this.loadDataFromCloud();
            
        } catch (error) {
            console.error('登录失败:', error);
            this.updateSyncStatus('🔴 登录失败');
            alert('登录失败，请重试');
        }
    }

    async logout() {
        try {
            await this.cloudbase.auth().signOut();
            this.currentUser = null;
            this.updateUserInfo(null);
            this.updateSyncStatus('🟢 已退出登录');
            
            // 清空本地数据
            this.data.monthlyRecords = [];
            this.updateOverview();
            
        } catch (error) {
            console.error('退出登录失败:', error);
        }
    }

    updateUserInfo(user) {
        const userInfoEl = document.getElementById('userInfo');
        const loginBtn = document.getElementById('loginBtn');
        const logoutBtn = document.getElementById('logoutBtn');

        if (user) {
            userInfoEl.textContent = user.nickName || user.openid.substr(0, 8) + '...';
            loginBtn.style.display = 'none';
            logoutBtn.style.display = 'inline-block';
        } else {
            userInfoEl.textContent = '未登录';
            loginBtn.style.display = 'inline-block';
            logoutBtn.style.display = 'none';
        }
    }

    updateSyncStatus(status) {
        const syncStatusEl = document.getElementById('syncStatus');
        if (syncStatusEl) {
            syncStatusEl.textContent = status;
        }
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

    initEventListeners() {
        // 登录相关
        document.getElementById('loginBtn').addEventListener('click', () => this.login());
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());

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
        document.getElementById('syncDataBtn').addEventListener('click', () => this.syncData());
        document.getElementById('clearDataBtn').addEventListener('click', () => this.clearData());

        // 弹窗事件
        document.getElementById('closeModal').addEventListener('click', () => this.hideModal());
        document.getElementById('modalCancel').addEventListener('click', () => this.hideModal());
    }

    async loadData() {
        if (this.currentUser) {
            await this.loadDataFromCloud();
        } else {
            this.loadDataFromLocal();
        }
    }

    async loadDataFromCloud() {
        if (!this.currentUser || !this.db) {
            console.log('未登录或数据库未初始化');
            return;
        }

        try {
            this.updateSyncStatus('🔄 从云端加载数据...');

            // 加载月度记录
            const recordsResult = await this.db.collection('monthlyRecords')
                .where({
                    userId: this.currentUser.user.openid
                })
                .orderBy('year', 'desc')
                .orderBy('month', 'desc')
                .get();

            this.data.monthlyRecords = recordsResult.data || [];

            // 加载账户类型
            const accountTypesResult = await this.db.collection('accountTypes')
                .where({
                    userId: this.currentUser.user.openid
                })
                .get();

            if (accountTypesResult.data && accountTypesResult.data.length > 0) {
                this.data.accountTypes = accountTypesResult.data[0].types || this.getDefaultAccountTypes();
            }

            this.updateSyncStatus('🟢 数据加载完成');
            console.log('✅ 从云端加载数据成功');

        } catch (error) {
            console.error('❌ 从云端加载数据失败:', error);
            this.updateSyncStatus('🔴 加载失败，使用本地数据');
            this.loadDataFromLocal();
        }
    }

    loadDataFromLocal() {
        try {
            const saved = localStorage.getItem('coupleAssetTracker');
            if (saved) {
                const savedData = JSON.parse(saved);
                this.data.monthlyRecords = savedData.monthlyRecords || [];
                this.data.accountTypes = savedData.accountTypes || this.getDefaultAccountTypes();
            }
            console.log('✅ 从本地加载数据成功');
        } catch (error) {
            console.error('❌ 从本地加载数据失败:', error);
        }
    }

    async saveDataToCloud(record) {
        if (!this.currentUser || !this.db) {
            console.log('未登录，仅保存到本地');
            this.saveDataToLocal();
            return;
        }

        try {
            this.updateSyncStatus('🔄 保存到云端...');

            // 添加用户ID
            const recordWithUser = {
                ...record,
                userId: this.currentUser.user.openid,
                updatedAt: new Date()
            };

            // 检查是否已存在该记录
            const existingResult = await this.db.collection('monthlyRecords')
                .where({
                    userId: this.currentUser.user.openid,
                    id: record.id
                })
                .get();

            if (existingResult.data && existingResult.data.length > 0) {
                // 更新现有记录
                await this.db.collection('monthlyRecords')
                    .doc(existingResult.data[0]._id)
                    .update(recordWithUser);
            } else {
                // 添加新记录
                await this.db.collection('monthlyRecords').add(recordWithUser);
            }

            // 同时保存账户类型配置
            await this.saveAccountTypesToCloud();

            this.updateSyncStatus('🟢 保存成功');
            console.log('✅ 保存到云端成功');

        } catch (error) {
            console.error('❌ 保存到云端失败:', error);
            this.updateSyncStatus('🔴 云端保存失败，已保存到本地');
        }

        // 无论云端是否成功，都保存到本地作为备份
        this.saveDataToLocal();
    }

    async saveAccountTypesToCloud() {
        if (!this.currentUser || !this.db) return;

        try {
            const accountTypesData = {
                userId: this.currentUser.user.openid,
                types: this.data.accountTypes,
                updatedAt: new Date()
            };

            // 检查是否已存在配置
            const existingResult = await this.db.collection('accountTypes')
                .where({
                    userId: this.currentUser.user.openid
                })
                .get();

            if (existingResult.data && existingResult.data.length > 0) {
                // 更新现有配置
                await this.db.collection('accountTypes')
                    .doc(existingResult.data[0]._id)
                    .update(accountTypesData);
            } else {
                // 添加新配置
                await this.db.collection('accountTypes').add(accountTypesData);
            }

        } catch (error) {
            console.error('保存账户类型到云端失败:', error);
        }
    }

    saveDataToLocal() {
        try {
            localStorage.setItem('coupleAssetTracker', JSON.stringify(this.data));
        } catch (error) {
            console.error('保存到本地失败:', error);
        }
    }

    async syncData() {
        if (!this.currentUser) {
            alert('请先登录后再同步数据');
            return;
        }

        try {
            this.updateSyncStatus('🔄 正在同步...');
            
            // 重新从云端加载最新数据
            await this.loadDataFromCloud();
            
            // 更新界面
            this.updateOverview();
            this.renderSettings();
            
            this.updateSyncStatus('🟢 同步完成');
            
        } catch (error) {
            console.error('同步失败:', error);
            this.updateSyncStatus('🔴 同步失败');
            alert('同步失败，请检查网络连接');
        }
    }

    // 保存记录方法
    async saveRecord() {
        if (!this.validateInputs()) {
            return;
        }

        const recordDate = document.getElementById('recordDate').value;
        if (!recordDate) {
            alert('请选择记账日期');
            return;
        }

        const date = new Date(recordDate);
        const recordId = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        // 收集数据
        const balances = {};
        let totals = { xiaoxiao: 0, yunyun: 0, combined: 0 };

        this.data.settings.users.forEach(user => {
            balances[user.id] = {};
            this.data.accountTypes.forEach(account => {
                const inputId = `${user.id}_${account.id}`;
                const input = document.getElementById(inputId);
                if (input && input.value) {
                    const amount = parseFloat(input.value) || 0;
                    balances[user.id][account.id] = amount;
                    totals[user.id] += amount;
                }
            });
            totals.combined += totals[user.id];
        });

        // 计算相比上月的变化
        const changes = this.calculateChanges(totals);

        const record = {
            id: recordId,
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            recordDate: recordDate,
            balances: balances,
            totals: totals,
            changes: changes
        };

        // 更新或添加记录
        const existingIndex = this.data.monthlyRecords.findIndex(r => r.id === recordId);
        if (existingIndex >= 0) {
            this.data.monthlyRecords[existingIndex] = record;
            this.showRecordStatus('✅ 记录已更新', 'success');
        } else {
            this.data.monthlyRecords.unshift(record);
            this.showRecordStatus('✅ 记录已保存', 'success');
        }

        // 保存到云端和本地
        await this.saveDataToCloud(record);

        // 更新界面
        this.updateOverview();
        this.resetRecordForm();
    }

    // 其他方法继续使用原有逻辑，但增加云端同步功能...
    // (这里省略其他方法的完整实现，它们与原版本基本相同，只是在数据操作时会同步到云端)

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

    validateInputs() {
        let hasValue = false;
        this.data.settings.users.forEach(user => {
            this.data.accountTypes.forEach(account => {
                const inputId = `${user.id}_${account.id}`;
                const input = document.getElementById(inputId);
                if (input && input.value && parseFloat(input.value) > 0) {
                    hasValue = true;
                }
            });
        });

        if (!hasValue) {
            alert('请至少输入一个账户的余额');
            return false;
        }
        return true;
    }

    calculateChanges(currentTotals) {
        const sortedRecords = [...this.data.monthlyRecords].sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.month - a.month;
        });

        const previousRecord = sortedRecords[0];
        if (!previousRecord) {
            return { xiaoxiao: 0, yunyun: 0, combined: 0 };
        }

        return {
            xiaoxiao: currentTotals.xiaoxiao - (previousRecord.totals.xiaoxiao || 0),
            yunyun: currentTotals.yunyun - (previousRecord.totals.yunyun || 0),
            combined: currentTotals.combined - (previousRecord.totals.combined || 0)
        };
    }

    showRecordStatus(message, type) {
        const statusEl = document.getElementById('recordStatus');
        statusEl.textContent = message;
        statusEl.className = `record-status ${type}`;
        
        setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'record-status';
        }, 3000);
    }

    resetRecordForm() {
        document.querySelectorAll('.account-input input').forEach(input => {
            input.value = '';
        });
        this.updateRecordTotals();
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
            if (!container) return;

            container.innerHTML = '';

            this.data.accountTypes.forEach(account => {
                const accountDiv = document.createElement('div');
                accountDiv.className = 'account-input';

                accountDiv.innerHTML = `
                    <label for="${user.id}_${account.id}" class="account-label">
                        <span class="account-icon" style="color: ${account.color}">${account.icon}</span>
                        <span class="account-name">${account.name}</span>
                    </label>
                    <input 
                        type="number" 
                        id="${user.id}_${account.id}" 
                        placeholder="0.00" 
                        step="0.01" 
                        min="0"
                        class="form-input"
                    >
                `;

                container.appendChild(accountDiv);

                // 添加输入事件监听
                const input = accountDiv.querySelector('input');
                input.addEventListener('input', () => this.updateRecordTotals());
            });
        });
    }

    updateRecordTotals() {
        const users = this.data.settings.users;
        let familyTotal = 0;

        users.forEach(user => {
            let userTotal = 0;
            this.data.accountTypes.forEach(account => {
                const inputId = `${user.id}_${account.id}`;
                const input = document.getElementById(inputId);
                if (input && input.value) {
                    userTotal += parseFloat(input.value) || 0;
                }
            });

            const totalEl = document.getElementById(`${user.id}RecordTotal`);
            if (totalEl) {
                totalEl.textContent = userTotal.toFixed(2);
            }

            familyTotal += userTotal;
        });

        const familyTotalEl = document.getElementById('familyRecordTotal');
        if (familyTotalEl) {
            familyTotalEl.textContent = familyTotal.toFixed(2);
        }
    }

    updateOverview() {
        const latestRecord = this.data.monthlyRecords[0];

        if (latestRecord) {
            // 更新资产总额
            document.getElementById('xiaoxiaoTotal').textContent = `¥${latestRecord.totals.xiaoxiao.toFixed(2)}`;
            document.getElementById('yunyunTotal').textContent = `¥${latestRecord.totals.yunyun.toFixed(2)}`;
            document.getElementById('combinedTotal').textContent = `¥${latestRecord.totals.combined.toFixed(2)}`;

            // 更新变化指示
            this.updateChangeDisplay('xiaoxiaoChange', latestRecord.changes.xiaoxiao);
            this.updateChangeDisplay('yunyunChange', latestRecord.changes.yunyun);
            this.updateChangeDisplay('combinedChange', latestRecord.changes.combined);
        } else {
            // 显示默认值
            ['xiaoxiaoTotal', 'yunyunTotal', 'combinedTotal'].forEach(id => {
                document.getElementById(id).textContent = '¥0.00';
            });
            ['xiaoxiaoChange', 'yunyunChange', 'combinedChange'].forEach(id => {
                document.getElementById(id).textContent = '--';
            });
        }

        this.updateOverviewChart();
        this.renderRecentRecords();
    }

    updateChangeDisplay(elementId, change) {
        const element = document.getElementById(elementId);
        if (change > 0) {
            element.textContent = `+¥${Math.abs(change).toFixed(2)} ↗`;
            element.className = 'change positive';
        } else if (change < 0) {
            element.textContent = `-¥${Math.abs(change).toFixed(2)} ↘`;
            element.className = 'change negative';
        } else {
            element.textContent = '无变化';
            element.className = 'change neutral';
        }
    }

    initCharts() {
        // 初始化概览趋势图
        this.initOverviewChart();
    }

    initOverviewChart() {
        const canvas = document.getElementById('trendChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        
        this.charts.overview = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: '家庭总资产',
                    data: [],
                    borderColor: '#2196f3',
                    backgroundColor: 'rgba(33, 150, 243, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '¥' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }

    updateOverviewChart() {
        if (!this.charts.overview) return;

        const records = [...this.data.monthlyRecords]
            .sort((a, b) => {
                if (a.year !== b.year) return a.year - b.year;
                return a.month - b.month;
            })
            .slice(-6); // 最近6个月

        const labels = records.map(r => `${r.year}-${String(r.month).padStart(2, '0')}`);
        const data = records.map(r => r.totals.combined);

        this.charts.overview.data.labels = labels;
        this.charts.overview.data.datasets[0].data = data;
        this.charts.overview.update();
    }

    renderRecentRecords() {
        const container = document.getElementById('recentRecordsList');
        if (!container) return;

        const recentRecords = this.data.monthlyRecords.slice(0, 5);

        if (recentRecords.length === 0) {
            container.innerHTML = '<div class="no-records">暂无记录</div>';
            return;
        }

        container.innerHTML = recentRecords.map(record => `
            <div class="record-item">
                <div class="record-date">${record.recordDate}</div>
                <div class="record-amount">¥${record.totals.combined.toFixed(2)}</div>
                <div class="record-change ${record.changes.combined > 0 ? 'positive' : record.changes.combined < 0 ? 'negative' : 'neutral'}">
                    ${record.changes.combined > 0 ? '+' : ''}${record.changes.combined.toFixed(2)}
                </div>
                <div class="record-actions">
                    <button onclick="tracker.editRecord('${record.id}')" class="btn-icon" title="编辑">✏️</button>
                    <button onclick="tracker.deleteRecord('${record.id}')" class="btn-icon" title="删除">🗑️</button>
                </div>
            </div>
        `).join('');
    }

    renderSettings() {
        this.renderAccountTypes();
        this.renderSystemInfo();
    }

    renderAccountTypes() {
        const container = document.getElementById('accountTypesList');
        if (!container) return;

        container.innerHTML = this.data.accountTypes.map(account => `
            <div class="account-type-item">
                <span class="account-icon" style="color: ${account.color}">${account.icon}</span>
                <span class="account-name">${account.name}</span>
                <span class="account-category">${this.getCategoryName(account.category)}</span>
                <button onclick="tracker.deleteAccountType('${account.id}')" class="btn-icon btn-danger" title="删除">🗑️</button>
            </div>
        `).join('');
    }

    renderSystemInfo() {
        const container = document.querySelector('.system-info');
        if (!container) return;

        const dataCount = this.data.monthlyRecords.length;
        const lastRecord = this.data.monthlyRecords[0];
        const lastRecordDate = lastRecord ? lastRecord.recordDate : '--';

        container.innerHTML = `
            <p>版本：1.0.0 (云开发版)</p>
            <p>数据条数：<span id="dataCount">${dataCount}</span></p>
            <p>最后记账：<span id="lastRecord">${lastRecordDate}</span></p>
            <p>同步状态：<span id="syncInfo">${this.currentUser ? '🟢 已连接云端' : '🔴 未登录'}</span></p>
        `;
    }

    getCategoryName(category) {
        const categoryMap = {
            'bank': '银行',
            'payment': '支付',
            'cash': '现金',
            'investment': '投资',
            'other': '其他'
        };
        return categoryMap[category] || '其他';
    }

    // 其他方法保持与原版本相同...
    initNewRecord() {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        document.getElementById('recordDate').value = dateStr;
        this.loadRecordByDate();
    }

    loadRecordByDate() {
        const selectedDate = document.getElementById('recordDate').value;
        if (!selectedDate) return;

        const date = new Date(selectedDate);
        const recordId = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const existingRecord = this.data.monthlyRecords.find(r => r.id === recordId);

        if (existingRecord) {
            this.loadRecordData(existingRecord);
            this.showRecordStatus('编辑模式：正在修改' + existingRecord.year + '年' + existingRecord.month + '月的记录', 'edit');
            document.getElementById('saveRecordBtn').textContent = '💾 更新记录';
        } else {
            this.resetRecordForm();
            this.showRecordStatus('新建模式：创建新的月度记录', 'new');
            document.getElementById('saveRecordBtn').textContent = '💾 保存记录';
        }
    }

    loadRecordData(record) {
        this.data.settings.users.forEach(user => {
            this.data.accountTypes.forEach(account => {
                const inputId = `${user.id}_${account.id}`;
                const input = document.getElementById(inputId);
                if (input && record.balances[user.id] && record.balances[user.id][account.id]) {
                    input.value = record.balances[user.id][account.id];
                }
            });
        });
        this.updateRecordTotals();
    }

    exportData() {
        const dataToExport = {
            ...this.data,
            exportDate: new Date().toISOString(),
            version: '1.0.0-cloudbase'
        };

        const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `couple-asset-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async clearData() {
        if (!confirm('确定要清空所有数据吗？此操作不可恢复！')) {
            return;
        }

        this.data.monthlyRecords = [];
        
        // 同时清空云端数据（如果已登录）
        if (this.currentUser && this.db) {
            try {
                this.updateSyncStatus('🔄 清空云端数据...');
                
                const recordsResult = await this.db.collection('monthlyRecords')
                    .where({
                        userId: this.currentUser.user.openid
                    })
                    .get();

                // 删除所有记录
                const deletePromises = recordsResult.data.map(record => 
                    this.db.collection('monthlyRecords').doc(record._id).remove()
                );
                
                await Promise.all(deletePromises);
                this.updateSyncStatus('🟢 云端数据已清空');
                
            } catch (error) {
                console.error('清空云端数据失败:', error);
                this.updateSyncStatus('🔴 云端清空失败');
            }
        }

        // 清空本地数据
        localStorage.removeItem('coupleAssetTracker');
        
        this.updateOverview();
        this.renderSettings();
        
        alert('数据已清空');
    }

    hideModal() {
        document.getElementById('modal').style.display = 'none';
    }

    // 初始化分析图表的方法
    initAnalysisCharts() {
        // 这里可以添加分析页面的图表初始化代码
        console.log('初始化分析图表');
    }

    updateAnalysisCharts() {
        // 这里可以添加分析图表更新代码
        console.log('更新分析图表');
    }

    // 添加缺失的方法
    showAddAccountTypeModal() {
        // 显示添加账户类型的弹窗
        console.log('显示添加账户类型弹窗');
    }

    editRecord(recordId) {
        // 编辑记录
        const record = this.data.monthlyRecords.find(r => r.id === recordId);
        if (record) {
            this.switchTab('record');
            document.getElementById('recordDate').value = record.recordDate;
            this.loadRecordData(record);
        }
    }

    async deleteRecord(recordId) {
        if (!confirm('确定要删除这条记录吗？')) return;

        // 从本地数组中删除
        this.data.monthlyRecords = this.data.monthlyRecords.filter(r => r.id !== recordId);

        // 从云端删除（如果已登录）
        if (this.currentUser && this.db) {
            try {
                const result = await this.db.collection('monthlyRecords')
                    .where({
                        userId: this.currentUser.user.openid,
                        id: recordId
                    })
                    .get();

                if (result.data && result.data.length > 0) {
                    await this.db.collection('monthlyRecords').doc(result.data[0]._id).remove();
                }
            } catch (error) {
                console.error('从云端删除记录失败:', error);
            }
        }

        // 保存到本地
        this.saveDataToLocal();
        
        // 更新界面
        this.updateOverview();
    }

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const importedData = JSON.parse(e.target.result);
                        if (importedData.monthlyRecords && importedData.accountTypes) {
                            this.data = {
                                monthlyRecords: importedData.monthlyRecords,
                                accountTypes: importedData.accountTypes,
                                settings: importedData.settings || this.data.settings
                            };
                            this.saveDataToLocal();
                            this.updateOverview();
                            this.renderSettings();
                            this.renderAccountInputs();
                            alert('数据导入成功');
                        } else {
                            alert('文件格式不正确');
                        }
                    } catch (error) {
                        alert('文件解析失败');
                    }
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }

    deleteAccountType(accountId) {
        if (!confirm('确定要删除这个账户类型吗？')) return;

        this.data.accountTypes = this.data.accountTypes.filter(a => a.id !== accountId);
        this.saveAccountTypesToCloud();
        this.saveDataToLocal();
        this.renderAccountTypes();
        this.renderAccountInputs();
    }
}

// 初始化应用
let tracker;
document.addEventListener('DOMContentLoaded', () => {
    tracker = new CloudbaseAssetTracker();
    window.tracker = tracker; // 方便调试和按钮调用
});