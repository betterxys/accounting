class CoupleAssetTracker {
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
        
        // 云开发相关
        this.cloudbase = null;
        this.currentUser = null;
        this.db = null;
        this.isCloudEnabled = false;
        
        this.init();
    }

    async init() {
        // 初始化云开发
        await this.initCloudbase();
        
        // 加载数据
        await this.loadData();
        
        // 初始化界面
        this.initEventListeners();
        this.renderAccountInputs();
        this.updateCurrentMonth();
        this.initCharts();
        this.updateOverview();
        this.renderSettings();
    }

    async initCloudbase() {
        try {
            // 检查是否在微信环境中
            if (typeof tcb !== 'undefined') {
                this.cloudbase = tcb.init({
                    env: 'cloud1-3g8s3xvm7609c639'
                });
                
                this.db = this.cloudbase.database();
                
                // 尝试自动登录
                const loginState = await this.cloudbase.auth().getLoginState();
                if (loginState) {
                    this.currentUser = loginState;
                    this.isCloudEnabled = true;
                    this.updateSyncStatus('🟢 云端已连接');
                } else {
                    this.updateSyncStatus('🔐 点击登录启用云同步');
                    this.showLoginButton();
                }
                
                console.log('✅ 云开发初始化成功');
            } else {
                throw new Error('云开发SDK未加载');
            }
        } catch (error) {
            console.log('⚠️ 云开发不可用，使用本地存储模式');
            this.updateSyncStatus('💾 本地存储模式');
            this.isCloudEnabled = false;
        }
    }

    updateSyncStatus(status) {
        const syncStatusEl = document.getElementById('syncStatus');
        if (syncStatusEl) {
            syncStatusEl.textContent = status;
        }
    }

    showLoginButton() {
        const loginBtn = document.getElementById('loginBtn');
        if (loginBtn) {
            loginBtn.style.display = 'inline-block';
            loginBtn.onclick = () => this.login();
        }
    }

    async login() {
        if (!this.cloudbase) {
            alert('云开发未初始化');
            return;
        }

        try {
            this.updateSyncStatus('🔄 正在登录...');
            
            const loginResult = await this.cloudbase.auth().weixinAuthProvider().signIn();
            this.currentUser = loginResult;
            this.isCloudEnabled = true;
            
            this.updateSyncStatus('🟢 登录成功，正在同步数据...');
            
            // 登录成功后从云端加载数据
            await this.loadDataFromCloud();
            this.updateOverview();
            
            // 隐藏登录按钮
            const loginBtn = document.getElementById('loginBtn');
            if (loginBtn) {
                loginBtn.style.display = 'none';
            }
            
        } catch (error) {
            console.error('登录失败:', error);
            this.updateSyncStatus('🔴 登录失败');
            alert('登录失败，将使用本地存储模式');
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

        // 弹窗事件
        document.getElementById('closeModal').addEventListener('click', () => this.hideModal());
        document.getElementById('modalCancel').addEventListener('click', () => this.hideModal());
    }

    async loadData() {
        if (this.isCloudEnabled && this.currentUser) {
            await this.loadDataFromCloud();
        } else {
            this.loadDataFromLocal();
        }
    }

    async loadDataFromCloud() {
        if (!this.isCloudEnabled || !this.currentUser || !this.db) {
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

            this.updateSyncStatus('🟢 云端数据已加载');
            console.log('✅ 从云端加载数据成功');

        } catch (error) {
            console.error('❌ 从云端加载数据失败:', error);
            this.updateSyncStatus('🔴 云端加载失败，使用本地数据');
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

    async saveData() {
        // 优先保存到云端，同时保存到本地作为备份
        if (this.isCloudEnabled && this.currentUser) {
            await this.saveDataToCloud();
        }
        this.saveDataToLocal();
    }

    async saveDataToCloud() {
        if (!this.isCloudEnabled || !this.currentUser || !this.db) {
            return;
        }

        try {
            this.updateSyncStatus('🔄 保存到云端...');

            // 保存账户类型配置
            const accountTypesData = {
                userId: this.currentUser.user.openid,
                types: this.data.accountTypes,
                updatedAt: new Date()
            };

            const existingAccountTypes = await this.db.collection('accountTypes')
                .where({
                    userId: this.currentUser.user.openid
                })
                .get();

            if (existingAccountTypes.data && existingAccountTypes.data.length > 0) {
                await this.db.collection('accountTypes')
                    .doc(existingAccountTypes.data[0]._id)
                    .update(accountTypesData);
            } else {
                await this.db.collection('accountTypes').add(accountTypesData);
            }

            this.updateSyncStatus('🟢 云端保存成功');

        } catch (error) {
            console.error('❌ 保存到云端失败:', error);
            this.updateSyncStatus('🔴 云端保存失败');
        }
    }

    async saveRecordToCloud(record) {
        if (!this.isCloudEnabled || !this.currentUser || !this.db) {
            return;
        }

        try {
            const recordWithUser = {
                ...record,
                userId: this.currentUser.user.openid,
                updatedAt: new Date()
            };

            const existingResult = await this.db.collection('monthlyRecords')
                .where({
                    userId: this.currentUser.user.openid,
                    id: record.id
                })
                .get();

            if (existingResult.data && existingResult.data.length > 0) {
                await this.db.collection('monthlyRecords')
                    .doc(existingResult.data[0]._id)
                    .update(recordWithUser);
            } else {
                await this.db.collection('monthlyRecords').add(recordWithUser);
            }

        } catch (error) {
            console.error('保存记录到云端失败:', error);
        }
    }

    saveDataToLocal() {
        try {
            localStorage.setItem('coupleAssetTracker', JSON.stringify(this.data));
        } catch (error) {
            console.error('保存到本地失败:', error);
        }
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

    showRecordStatus(message, type) {
        const statusEl = document.getElementById('recordStatus');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = `record-status ${type}`;
            
            setTimeout(() => {
                statusEl.textContent = '';
                statusEl.className = 'record-status';
            }, 3000);
        }
    }

    resetRecordForm() {
        document.querySelectorAll('.account-input input').forEach(input => {
            input.value = '';
        });
        this.updateRecordTotals();
    }

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

        // 保存数据
        await this.saveRecordToCloud(record);
        this.saveDataToLocal();

        // 更新界面
        this.updateOverview();
        this.resetRecordForm();
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
                const el = document.getElementById(id);
                if (el) el.textContent = '¥0.00';
            });
            ['xiaoxiaoChange', 'yunyunChange', 'combinedChange'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = '--';
            });
        }

        this.updateOverviewChart();
        this.renderRecentRecords();
    }

    updateChangeDisplay(elementId, change) {
        const element = document.getElementById(elementId);
        if (!element) return;

        if (change > 0) {
            element.textContent = `+¥${Math.abs(change).toFixed(2)} ↗`;
            element.className = 'asset-change positive';
        } else if (change < 0) {
            element.textContent = `-¥${Math.abs(change).toFixed(2)} ↘`;
            element.className = 'asset-change negative';
        } else {
            element.textContent = '无变化';
            element.className = 'asset-change neutral';
        }
    }

    initCharts() {
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
                maintainAspectRatio: true,
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
            container.innerHTML = '<div class="no-records">暂无记录，点击右上角"📝 记账"开始记录</div>';
            return;
        }

        container.innerHTML = recentRecords.map(record => `
            <div class="record-item">
                <div class="record-info">
                    <div class="record-date">${record.recordDate}</div>
                    <div class="record-summary">${record.year}年${record.month}月记录</div>
                </div>
                <div class="record-amounts">
                    <div class="record-amount">¥${record.totals.combined.toFixed(2)}</div>
                    <div class="record-change ${record.changes.combined > 0 ? 'positive' : record.changes.combined < 0 ? 'negative' : 'neutral'}">
                        ${record.changes.combined > 0 ? '+' : ''}¥${Math.abs(record.changes.combined).toFixed(2)}
                    </div>
                </div>
                <div class="record-actions">
                    <button onclick="tracker.editRecord('${record.id}')" class="btn-icon" title="编辑">✏️</button>
                    <button onclick="tracker.deleteRecord('${record.id}')" class="btn-icon" title="删除">🗑️</button>
                </div>
            </div>
        `).join('');
    }

    editRecord(recordId) {
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

        // 从云端删除
        if (this.isCloudEnabled && this.currentUser && this.db) {
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
        const syncMode = this.isCloudEnabled ? '云端同步' : '本地存储';

        container.innerHTML = `
            <p>版本：1.0.0</p>
            <p>数据条数：<span id="dataCount">${dataCount}</span></p>
            <p>最后记账：<span id="lastRecord">${lastRecordDate}</span></p>
            <p>存储模式：<span>${syncMode}</span></p>
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

    showAddAccountTypeModal() {
        this.showModal('添加账户类型', `
            <div class="modal-form">
                <div class="form-group">
                    <label>账户名称</label>
                    <input type="text" id="newAccountName" placeholder="请输入账户名称">
                </div>
                <div class="form-group">
                    <label>选择图标</label>
                    <div class="icon-selector">
                        <span class="icon-option" data-icon="🏦">🏦</span>
                        <span class="icon-option" data-icon="💳">💳</span>
                        <span class="icon-option" data-icon="💰">💰</span>
                        <span class="icon-option" data-icon="💵">💵</span>
                        <span class="icon-option" data-icon="📱">📱</span>
                        <span class="icon-option" data-icon="💎">💎</span>
                    </div>
                    <input type="hidden" id="selectedIcon" value="🏦">
                </div>
                <div class="form-group">
                    <label>选择颜色</label>
                    <div class="color-selector">
                        <span class="color-option" data-color="#d32f2f" style="background: #d32f2f"></span>
                        <span class="color-option" data-color="#1976d2" style="background: #1976d2"></span>
                        <span class="color-option" data-color="#388e3c" style="background: #388e3c"></span>
                        <span class="color-option" data-color="#f57c00" style="background: #f57c00"></span>
                        <span class="color-option" data-color="#7b1fa2" style="background: #7b1fa2"></span>
                        <span class="color-option" data-color="#5d4037" style="background: #5d4037"></span>
                    </div>
                    <input type="hidden" id="selectedColor" value="#d32f2f">
                </div>
                <div class="form-group">
                    <label>账户类型</label>
                    <select id="accountCategory">
                        <option value="bank">银行</option>
                        <option value="payment">支付</option>
                        <option value="cash">现金</option>
                        <option value="investment">投资</option>
                        <option value="other">其他</option>
                    </select>
                </div>
            </div>
        `, () => this.addAccountType());

        // 添加图标和颜色选择事件
        document.querySelectorAll('.icon-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.icon-option').forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');
                document.getElementById('selectedIcon').value = option.dataset.icon;
            });
        });

        document.querySelectorAll('.color-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');
                document.getElementById('selectedColor').value = option.dataset.color;
            });
        });

        // 默认选择第一个选项
        document.querySelector('.icon-option').classList.add('selected');
        document.querySelector('.color-option').classList.add('selected');
    }

    async addAccountType() {
        const name = document.getElementById('newAccountName').value.trim();
        const icon = document.getElementById('selectedIcon').value;
        const color = document.getElementById('selectedColor').value;
        const category = document.getElementById('accountCategory').value;

        if (!name) {
            alert('请输入账户名称');
            return;
        }

        const newAccount = {
            id: 'custom_' + Date.now(),
            name: name,
            icon: icon,
            color: color,
            category: category
        };

        this.data.accountTypes.push(newAccount);
        await this.saveData();
        this.renderAccountTypes();
        this.renderAccountInputs();
        this.hideModal();
    }

    async deleteAccountType(accountId) {
        if (!confirm('确定要删除这个账户类型吗？删除后相关记录数据不会受影响。')) return;

        this.data.accountTypes = this.data.accountTypes.filter(a => a.id !== accountId);
        await this.saveData();
        this.renderAccountTypes();
        this.renderAccountInputs();
    }

    exportData() {
        const dataToExport = {
            ...this.data,
            exportDate: new Date().toISOString(),
            version: '1.0.0',
            cloudEnabled: this.isCloudEnabled
        };

        const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `couple-asset-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        const importedData = JSON.parse(e.target.result);
                        if (importedData.monthlyRecords && importedData.accountTypes) {
                            this.data = {
                                monthlyRecords: importedData.monthlyRecords,
                                accountTypes: importedData.accountTypes,
                                settings: importedData.settings || this.data.settings
                            };
                            
                            await this.saveData();
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

    async clearData() {
        if (!confirm('确定要清空所有数据吗？此操作不可恢复！')) {
            return;
        }

        this.data.monthlyRecords = [];

        // 清空云端数据
        if (this.isCloudEnabled && this.currentUser && this.db) {
            try {
                this.updateSyncStatus('🔄 清空云端数据...');
                
                const recordsResult = await this.db.collection('monthlyRecords')
                    .where({
                        userId: this.currentUser.user.openid
                    })
                    .get();

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

    showModal(title, content, onConfirm) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = content;
        document.getElementById('modal').style.display = 'flex';
        
        document.getElementById('modalConfirm').onclick = onConfirm || (() => this.hideModal());
    }

    hideModal() {
        document.getElementById('modal').style.display = 'none';
    }

    initAnalysisCharts() {
        // 初始化分析图表
        this.initAnalysisChart('assetTrendChart', 'line');
        this.initAnalysisChart('distributionChart', 'doughnut');
        this.initAnalysisChart('changeChart', 'bar');
        this.initAnalysisChart('comparisonChart', 'bar');
    }

    initAnalysisChart(canvasId, type) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || this.charts[canvasId]) return;

        const ctx = canvas.getContext('2d');
        
        this.charts[canvasId] = new Chart(ctx, {
            type: type,
            data: {
                labels: [],
                datasets: []
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }

    updateAnalysisCharts() {
        const timeRange = parseInt(document.getElementById('timeRange').value);
        const recentRecords = [...this.data.monthlyRecords]
            .sort((a, b) => {
                if (a.year !== b.year) return a.year - b.year;
                return a.month - b.month;
            })
            .slice(-timeRange);

        this.updateAssetTrendChart(recentRecords);
        this.updateDistributionChart(recentRecords);
        this.updateChangeChart(recentRecords);
        this.updateComparisonChart(recentRecords);
    }

    updateAssetTrendChart(records) {
        const chart = this.charts.assetTrendChart;
        if (!chart) return;

        const labels = records.map(r => `${r.year}-${String(r.month).padStart(2, '0')}`);
        
        chart.data.labels = labels;
        chart.data.datasets = [
            {
                label: '肖肖',
                data: records.map(r => r.totals.xiaoxiao),
                borderColor: '#e91e63',
                backgroundColor: 'rgba(233, 30, 99, 0.1)',
                borderWidth: 2,
                fill: false
            },
            {
                label: '运运',
                data: records.map(r => r.totals.yunyun),
                borderColor: '#2196f3',
                backgroundColor: 'rgba(33, 150, 243, 0.1)',
                borderWidth: 2,
                fill: false
            },
            {
                label: '家庭总资产',
                data: records.map(r => r.totals.combined),
                borderColor: '#4caf50',
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                borderWidth: 3,
                fill: false
            }
        ];
        chart.update();
    }

    updateDistributionChart(records) {
        const chart = this.charts.distributionChart;
        if (!chart || records.length === 0) return;

        const latestRecord = records[records.length - 1];
        const accountTotals = {};

        // 统计各账户类型总额
        this.data.settings.users.forEach(user => {
            if (latestRecord.balances[user.id]) {
                Object.entries(latestRecord.balances[user.id]).forEach(([accountId, amount]) => {
                    const account = this.data.accountTypes.find(a => a.id === accountId);
                    if (account) {
                        accountTotals[account.name] = (accountTotals[account.name] || 0) + amount;
                    }
                });
            }
        });

        const labels = Object.keys(accountTotals);
        const data = Object.values(accountTotals);
        const colors = labels.map((_, index) => {
            const hue = (index * 360 / labels.length) % 360;
            return `hsl(${hue}, 70%, 60%)`;
        });

        chart.data.labels = labels;
        chart.data.datasets = [{
            data: data,
            backgroundColor: colors,
            borderWidth: 1
        }];
        chart.update();
    }

    updateChangeChart(records) {
        const chart = this.charts.changeChart;
        if (!chart) return;

        const labels = records.map(r => `${r.year}-${String(r.month).padStart(2, '0')}`);
        
        chart.data.labels = labels;
        chart.data.datasets = [
            {
                label: '月度变化',
                data: records.map(r => r.changes.combined),
                backgroundColor: records.map(r => r.changes.combined >= 0 ? '#4caf50' : '#f44336'),
                borderWidth: 1
            }
        ];
        chart.update();
    }

    updateComparisonChart(records) {
        const chart = this.charts.comparisonChart;
        if (!chart) return;

        const labels = records.map(r => `${r.year}-${String(r.month).padStart(2, '0')}`);
        
        chart.data.labels = labels;
        chart.data.datasets = [
            {
                label: '肖肖',
                data: records.map(r => r.totals.xiaoxiao),
                backgroundColor: '#e91e63'
            },
            {
                label: '运运',
                data: records.map(r => r.totals.yunyun),
                backgroundColor: '#2196f3'
            }
        ];
        chart.update();
    }
}

// 初始化应用
let tracker;
document.addEventListener('DOMContentLoaded', () => {
    tracker = new CoupleAssetTracker();
    window.tracker = tracker; // 方便调试和按钮调用
});