class LocalDebugExpenseTracker {
    constructor() {
        this.transactions = [];
        this.isLoggedIn = false;
        this.currentUser = null;
        this.storageKey = 'expense-tracker-local-debug';
        this.init();
    }

    init() {
        console.log('🚀 本地调试模式启动');
        this.loadTransactions();
        this.updateSummary();
        this.displayTransactions();
        this.bindEvents();
        this.setDefaultDate();
        this.checkLoginStatus();
    }

    setDefaultDate() {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('date').value = today;
    }

    bindEvents() {
        document.getElementById('loginBtn').addEventListener('click', () => {
            this.login();
        });

        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.logout();
        });

        document.getElementById('expenseForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addTransaction();
        });

        document.getElementById('clearDataBtn').addEventListener('click', () => {
            this.clearAllData();
        });

        document.getElementById('loadSampleBtn').addEventListener('click', () => {
            this.loadSampleData();
        });
    }

    checkLoginStatus() {
        // 检查本地存储的登录状态
        const savedLogin = localStorage.getItem(this.storageKey + '-login');
        if (savedLogin) {
            this.isLoggedIn = true;
            this.currentUser = JSON.parse(savedLogin);
            this.showUserInfo();
        } else {
            this.showLoginButton();
        }
    }

    login() {
        // 模拟登录
        this.isLoggedIn = true;
        this.currentUser = { 
            id: 'local-user-' + Date.now(), 
            name: '本地用户',
            loginTime: new Date().toISOString()
        };
        
        // 保存登录状态
        localStorage.setItem(this.storageKey + '-login', JSON.stringify(this.currentUser));
        
        this.showUserInfo();
        this.showMessage('模拟登录成功', 'success');
        console.log('👤 用户登录:', this.currentUser);
    }

    logout() {
        this.isLoggedIn = false;
        this.currentUser = null;
        
        // 清除登录状态
        localStorage.removeItem(this.storageKey + '-login');
        
        this.showLoginButton();
        this.showMessage('已退出登录', 'success');
        console.log('👋 用户退出登录');
    }

    showLoginButton() {
        document.getElementById('loginBtn').style.display = 'block';
        document.getElementById('userInfo').style.display = 'none';
        this.disableForm(true);
    }

    showUserInfo() {
        document.getElementById('loginBtn').style.display = 'none';
        document.getElementById('userInfo').style.display = 'flex';
        document.getElementById('userName').textContent = this.currentUser.name || '本地用户';
        this.disableForm(false);
    }

    disableForm(disabled) {
        const formElements = document.querySelectorAll('#expenseForm input, #expenseForm select, #expenseForm button');
        formElements.forEach(element => {
            element.disabled = disabled;
        });
    }

    async addTransaction() {
        if (!this.isLoggedIn) {
            this.showMessage('请先登录', 'error');
            return;
        }

        const description = document.getElementById('description').value;
        const amount = parseFloat(document.getElementById('amount').value);
        const type = document.getElementById('type').value;
        const category = document.getElementById('category').value;
        const date = document.getElementById('date').value;

        if (!description || !amount || !type || !category || !date) {
            this.showMessage('请填写所有字段', 'error');
            return;
        }

        const transaction = {
            id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            description,
            amount,
            type,
            category,
            date,
            userId: this.currentUser.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        try {
            this.showLoading(true);
            
            // 模拟网络延迟
            await this.simulateDelay(300);
            
            this.transactions.push(transaction);
            this.saveTransactions();
            
            this.updateSummary();
            this.displayTransactions();
            this.clearForm();
            this.showMessage('添加成功', 'success');
            
            console.log('➕ 添加交易:', transaction);
        } catch (error) {
            console.error('添加交易失败:', error);
            this.showMessage('添加失败，请重试', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async deleteTransaction(id) {
        if (!this.isLoggedIn) {
            this.showMessage('请先登录', 'error');
            return;
        }

        if (!confirm('确定要删除这条记录吗？')) {
            return;
        }

        try {
            this.showLoading(true);
            
            // 模拟网络延迟
            await this.simulateDelay(200);
            
            const deletedTransaction = this.transactions.find(t => t.id === id);
            this.transactions = this.transactions.filter(t => t.id !== id);
            this.saveTransactions();
            
            this.updateSummary();
            this.displayTransactions();
            this.showMessage('删除成功', 'success');
            
            console.log('🗑️ 删除交易:', deletedTransaction);
        } catch (error) {
            console.error('删除交易失败:', error);
            this.showMessage('删除失败，请重试', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    clearForm() {
        document.getElementById('expenseForm').reset();
        this.setDefaultDate();
    }

    updateSummary() {
        const income = this.transactions
            .filter(t => t.type === 'income')
            .reduce((sum, t) => sum + t.amount, 0);

        const expense = this.transactions
            .filter(t => t.type === 'expense')
            .reduce((sum, t) => sum + t.amount, 0);

        const balance = income - expense;

        document.getElementById('totalIncome').textContent = `¥${income.toFixed(2)}`;
        document.getElementById('totalExpense').textContent = `¥${expense.toFixed(2)}`;
        document.getElementById('balance').textContent = `¥${balance.toFixed(2)}`;
        
        const balanceElement = document.getElementById('balance');
        balanceElement.className = 'amount ' + (balance >= 0 ? 'income' : 'expense');
    }

    displayTransactions() {
        const container = document.getElementById('transactionsList');
        
        if (this.transactions.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #6c757d;">暂无交易记录</p>';
            return;
        }

        const sortedTransactions = [...this.transactions].sort((a, b) => 
            new Date(b.date) - new Date(a.date)
        );

        container.innerHTML = sortedTransactions.map(transaction => `
            <div class="transaction-item">
                <div class="transaction-info">
                    <div class="transaction-description">${transaction.description}</div>
                    <div class="transaction-meta">
                        ${transaction.category} • ${transaction.date}
                        <small style="color: #adb5bd;"> • ID: ${transaction.id.split('_')[1]}</small>
                    </div>
                </div>
                <div style="display: flex; align-items: center;">
                    <span class="transaction-amount ${transaction.type}">
                        ${transaction.type === 'income' ? '+' : '-'}¥${transaction.amount.toFixed(2)}
                    </span>
                    <button class="delete-btn" onclick="tracker.deleteTransaction('${transaction.id}')">
                        删除
                    </button>
                </div>
            </div>
        `).join('');
    }

    saveTransactions() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.transactions));
            console.log('💾 数据已保存到localStorage，共', this.transactions.length, '条记录');
        } catch (error) {
            console.error('保存数据失败:', error);
            this.showMessage('保存数据失败', 'error');
        }
    }

    loadTransactions() {
        try {
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                this.transactions = JSON.parse(saved);
                console.log('📖 从localStorage加载了', this.transactions.length, '条记录');
            }
        } catch (error) {
            console.error('加载数据失败:', error);
            this.transactions = [];
        }
    }

    clearAllData() {
        if (!confirm('确定要清空所有数据吗？此操作不可恢复！')) {
            return;
        }

        this.transactions = [];
        localStorage.removeItem(this.storageKey);
        
        this.updateSummary();
        this.displayTransactions();
        this.showMessage('所有数据已清空', 'success');
        
        console.log('🗑️ 所有数据已清空');
    }

    loadSampleData() {
        if (this.transactions.length > 0) {
            if (!confirm('当前已有数据，是否要添加示例数据？')) {
                return;
            }
        }

        const sampleTransactions = [
            {
                id: 'sample_1',
                description: '午餐',
                amount: 28.5,
                type: 'expense',
                category: '食物',
                date: new Date().toISOString().split('T')[0],
                userId: this.currentUser?.id || 'guest',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            {
                id: 'sample_2',
                description: '地铁通勤',
                amount: 6,
                type: 'expense',
                category: '交通',
                date: new Date().toISOString().split('T')[0],
                userId: this.currentUser?.id || 'guest',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            {
                id: 'sample_3',
                description: '工资收入',
                amount: 8000,
                type: 'income',
                category: '工资',
                date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                userId: this.currentUser?.id || 'guest',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            {
                id: 'sample_4',
                description: '咖啡',
                amount: 25,
                type: 'expense',
                category: '食物',
                date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                userId: this.currentUser?.id || 'guest',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            {
                id: 'sample_5',
                description: '购买书籍',
                amount: 89,
                type: 'expense',
                category: '购物',
                date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                userId: this.currentUser?.id || 'guest',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        ];

        this.transactions.push(...sampleTransactions);
        this.saveTransactions();
        this.updateSummary();
        this.displayTransactions();
        this.showMessage('示例数据加载成功', 'success');
        
        console.log('📝 已加载示例数据:', sampleTransactions);
    }

    showLoading(show) {
        document.getElementById('loading').style.display = show ? 'block' : 'none';
    }

    showMessage(message, type = 'success') {
        // 移除现有的消息
        const existingMessage = document.querySelector('.message');
        if (existingMessage) {
            existingMessage.remove();
        }

        // 创建新消息
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        messageDiv.textContent = message;
        
        // 插入到表单前面
        const form = document.getElementById('expenseForm');
        form.parentNode.insertBefore(messageDiv, form);

        // 3秒后自动移除
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.remove();
            }
        }, 3000);
    }

    // 工具方法：模拟网络延迟
    simulateDelay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 调试方法：获取所有数据
    getDebugInfo() {
        return {
            transactions: this.transactions,
            isLoggedIn: this.isLoggedIn,
            currentUser: this.currentUser,
            storageKey: this.storageKey,
            storageSize: JSON.stringify(this.transactions).length
        };
    }
}

// 等待页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.tracker = new LocalDebugExpenseTracker();
    
    // 调试工具：在控制台中可以使用
    window.debugTracker = {
        getInfo: () => tracker.getDebugInfo(),
        clearData: () => tracker.clearAllData(),
        loadSample: () => tracker.loadSampleData(),
        exportData: () => JSON.stringify(tracker.transactions, null, 2)
    };
    
    console.log('🛠️ 调试工具已加载，在控制台中使用 debugTracker 对象');
    console.log('📋 可用命令:');
    console.log('  debugTracker.getInfo() - 获取调试信息');
    console.log('  debugTracker.clearData() - 清空所有数据');
    console.log('  debugTracker.loadSample() - 加载示例数据');
    console.log('  debugTracker.exportData() - 导出JSON格式数据');
});