const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const DATA_FILE = path.join(__dirname, 'data.json');

function readData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error('读取数据文件失败:', error);
        return [];
    }
}

function writeData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('写入数据文件失败:', error);
        return false;
    }
}

app.get('/api/transactions', (req, res) => {
    try {
        const transactions = readData();
        res.json(transactions);
    } catch (error) {
        console.error('获取交易记录失败:', error);
        res.status(500).json({ error: '获取交易记录失败' });
    }
});

app.post('/api/transactions', (req, res) => {
    try {
        const transaction = req.body;
        
        if (!transaction.description || !transaction.amount || !transaction.type || !transaction.category || !transaction.date) {
            return res.status(400).json({ error: '缺少必要字段' });
        }

        const transactions = readData();
        transaction.id = Date.now();
        transaction.timestamp = new Date().toISOString();
        
        transactions.push(transaction);
        
        if (writeData(transactions)) {
            res.status(201).json(transaction);
        } else {
            res.status(500).json({ error: '保存交易记录失败' });
        }
    } catch (error) {
        console.error('添加交易记录失败:', error);
        res.status(500).json({ error: '添加交易记录失败' });
    }
});

app.delete('/api/transactions/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const transactions = readData();
        
        const index = transactions.findIndex(t => t.id === id);
        if (index === -1) {
            return res.status(404).json({ error: '交易记录不存在' });
        }
        
        transactions.splice(index, 1);
        
        if (writeData(transactions)) {
            res.json({ message: '删除成功' });
        } else {
            res.status(500).json({ error: '删除交易记录失败' });
        }
    } catch (error) {
        console.error('删除交易记录失败:', error);
        res.status(500).json({ error: '删除交易记录失败' });
    }
});

app.get('/api/stats', (req, res) => {
    try {
        const transactions = readData();
        
        const income = transactions
            .filter(t => t.type === 'income')
            .reduce((sum, t) => sum + t.amount, 0);
            
        const expense = transactions
            .filter(t => t.type === 'expense')
            .reduce((sum, t) => sum + t.amount, 0);
            
        const balance = income - expense;
        
        const categoryStats = {};
        transactions.forEach(t => {
            if (!categoryStats[t.category]) {
                categoryStats[t.category] = { income: 0, expense: 0 };
            }
            categoryStats[t.category][t.type] += t.amount;
        });
        
        res.json({
            income,
            expense,
            balance,
            categoryStats,
            totalTransactions: transactions.length
        });
    } catch (error) {
        console.error('获取统计数据失败:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
    console.log(`记账网站运行在 http://localhost:${PORT}`);
});