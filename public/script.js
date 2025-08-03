class ExpenseTracker {
    constructor() {
        this.transactions = [];
        this.init();
    }

    init() {
        this.loadTransactions();
        this.updateSummary();
        this.displayTransactions();
        this.bindEvents();
        this.setDefaultDate();
    }

    setDefaultDate() {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('date').value = today;
    }

    bindEvents() {
        document.getElementById('expenseForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addTransaction();
        });
    }

    async addTransaction() {
        const description = document.getElementById('description').value;
        const amount = parseFloat(document.getElementById('amount').value);
        const type = document.getElementById('type').value;
        const category = document.getElementById('category').value;
        const date = document.getElementById('date').value;

        if (!description || !amount || !type || !category || !date) {
            alert('请填写所有字段');
            return;
        }

        const transaction = {
            id: Date.now(),
            description,
            amount,
            type,
            category,
            date,
            timestamp: new Date().toISOString()
        };

        try {
            const response = await fetch('/api/transactions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(transaction)
            });

            if (response.ok) {
                this.transactions.push(transaction);
                this.saveTransactions();
                this.updateSummary();
                this.displayTransactions();
                this.clearForm();
            } else {
                alert('添加交易失败');
            }
        } catch (error) {
            console.error('添加交易失败:', error);
            this.transactions.push(transaction);
            this.saveTransactions();
            this.updateSummary();
            this.displayTransactions();
            this.clearForm();
        }
    }

    async deleteTransaction(id) {
        if (!confirm('确定要删除这条记录吗？')) {
            return;
        }

        try {
            const response = await fetch(`/api/transactions/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                this.transactions = this.transactions.filter(t => t.id !== id);
                this.saveTransactions();
                this.updateSummary();
                this.displayTransactions();
            } else {
                alert('删除交易失败');
            }
        } catch (error) {
            console.error('删除交易失败:', error);
            this.transactions = this.transactions.filter(t => t.id !== id);
            this.saveTransactions();
            this.updateSummary();
            this.displayTransactions();
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
                    <button class="delete-btn" onclick="tracker.deleteTransaction(${transaction.id})">
                        删除
                    </button>
                </div>
            </div>
        `).join('');
    }

    saveTransactions() {
        localStorage.setItem('transactions', JSON.stringify(this.transactions));
    }

    async loadTransactions() {
        try {
            const response = await fetch('/api/transactions');
            if (response.ok) {
                this.transactions = await response.json();
            } else {
                this.loadFromLocalStorage();
            }
        } catch (error) {
            console.error('从服务器加载交易失败:', error);
            this.loadFromLocalStorage();
        }
    }

    loadFromLocalStorage() {
        const saved = localStorage.getItem('transactions');
        if (saved) {
            this.transactions = JSON.parse(saved);
        }
    }
}

const tracker = new ExpenseTracker();