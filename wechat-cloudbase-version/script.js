class CloudExpenseTracker {
    constructor() {
        this.transactions = [];
        this.isLoggedIn = false;
        this.currentUser = null;
        this.db = null;
        this.init();
    }

    async init() {
        await this.initCloudBase();
        this.bindEvents();
        this.setDefaultDate();
        this.checkLoginStatus();
    }

    async initCloudBase() {
        try {
            // 初始化云开发
            cloud.init({
                env: 'cloud1-3g8s3xvm7609c639', // 你的云开发环境ID
                traceUser: true
            });
            
            this.db = cloud.database();
            console.log('云开发初始化成功');
        } catch (error) {
            console.error('云开发初始化失败:', error);
            this.showMessage('云开发初始化失败，请检查配置', 'error');
        }
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
    }

    async checkLoginStatus() {
        try {
            const { result } = await cloud.callFunction({
                name: 'login',
                data: {}
            });
            
            if (result.code === 0) {
                this.isLoggedIn = true;
                this.currentUser = result.data;
                this.showUserInfo();
                await this.loadTransactions();
            } else {
                this.showLoginButton();
            }
        } catch (error) {
            console.log('未登录状态');
            this.showLoginButton();
        }
    }

    async login() {
        try {
            // 在实际部署时，这里需要实现微信登录逻辑
            // 目前使用模拟登录
            const result = await cloud.callFunction({
                name: 'login',
                data: {}
            });

            if (result.result.code === 0) {
                this.isLoggedIn = true;
                this.currentUser = result.result.data;
                this.showUserInfo();
                await this.loadTransactions();
                this.showMessage('登录成功', 'success');
            } else {
                this.showMessage('登录失败', 'error');
            }
        } catch (error) {
            console.error('登录失败:', error);
            // 模拟登录（用于演示）
            this.isLoggedIn = true;
            this.currentUser = { openid: 'demo-user', nickName: '演示用户' };
            this.showUserInfo();
            await this.loadTransactions();
            this.showMessage('演示模式登录成功', 'success');
        }
    }

    logout() {
        this.isLoggedIn = false;
        this.currentUser = null;
        this.transactions = [];
        this.showLoginButton();
        this.updateSummary();
        this.displayTransactions();
        this.showMessage('已退出登录', 'success');
    }

    showLoginButton() {
        document.getElementById('loginBtn').style.display = 'block';
        document.getElementById('userInfo').style.display = 'none';
        this.disableForm(true);
    }

    showUserInfo() {
        document.getElementById('loginBtn').style.display = 'none';
        document.getElementById('userInfo').style.display = 'flex';
        document.getElementById('userName').textContent = this.currentUser.nickName || '用户';
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
            description,
            amount,
            type,
            category,
            date,
            userId: this.currentUser.openid,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        try {
            this.showLoading(true);
            
            // 添加到云数据库
            const result = await this.db.collection('transactions').add({
                data: transaction
            });

            transaction._id = result._id;
            this.transactions.push(transaction);
            
            this.updateSummary();
            this.displayTransactions();
            this.clearForm();
            this.showMessage('添加成功', 'success');
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
            
            // 从云数据库删除
            await this.db.collection('transactions').doc(id).remove();
            
            this.transactions = this.transactions.filter(t => t._id !== id);
            this.updateSummary();
            this.displayTransactions();
            this.showMessage('删除成功', 'success');
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
                    </div>
                </div>
                <div style="display: flex; align-items: center;">
                    <span class="transaction-amount ${transaction.type}">
                        ${transaction.type === 'income' ? '+' : '-'}¥${transaction.amount.toFixed(2)}
                    </span>
                    <button class="delete-btn" onclick="tracker.deleteTransaction('${transaction._id}')">
                        删除
                    </button>
                </div>
            </div>
        `).join('');
    }

    async loadTransactions() {
        if (!this.isLoggedIn) {
            return;
        }

        try {
            this.showLoading(true);
            
            // 从云数据库获取当前用户的交易记录
            const result = await this.db.collection('transactions')
                .where({
                    userId: this.currentUser.openid
                })
                .orderBy('createdAt', 'desc')
                .get();

            this.transactions = result.data;
            this.updateSummary();
            this.displayTransactions();
        } catch (error) {
            console.error('加载交易记录失败:', error);
            this.showMessage('加载数据失败', 'error');
        } finally {
            this.showLoading(false);
        }
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
}

// 等待页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.tracker = new CloudExpenseTracker();
});