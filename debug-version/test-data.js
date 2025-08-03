// 测试数据生成器
function generateTestData() {
    const testData = {
        monthlyRecords: [
            {
                id: "2024-06",
                year: 2024,
                month: 6,
                recordDate: "2024-06-30",
                balances: {
                    xiaoxiao: {
                        cmbc: 15000,
                        icbc: 8000,
                        wechat: 1200,
                        alipay: 800
                    },
                    yunyun: {
                        cmbc: 22000,
                        icbc: 12000,
                        wechat: 600,
                        alipay: 1000
                    }
                },
                totals: {
                    xiaoxiao: 25000,
                    yunyun: 35600,
                    combined: 60600
                },
                changes: {
                    xiaoxiao: 0,
                    yunyun: 0,
                    combined: 0
                },
                createdAt: "2024-06-30T15:30:00Z"
            },
            {
                id: "2024-07",
                year: 2024,
                month: 7,
                recordDate: "2024-07-31",
                balances: {
                    xiaoxiao: {
                        cmbc: 16500,
                        icbc: 8500,
                        wechat: 1000,
                        alipay: 1200
                    },
                    yunyun: {
                        cmbc: 24000,
                        icbc: 13000,
                        wechat: 800,
                        alipay: 1500
                    }
                },
                totals: {
                    xiaoxiao: 27200,
                    yunyun: 39300,
                    combined: 66500
                },
                changes: {
                    xiaoxiao: 2200,
                    yunyun: 3700,
                    combined: 5900
                },
                createdAt: "2024-07-31T16:20:00Z"
            },
            {
                id: "2024-08",
                year: 2024,
                month: 8,
                recordDate: "2024-08-31",
                balances: {
                    xiaoxiao: {
                        cmbc: 18000,
                        icbc: 9000,
                        wechat: 1500,
                        alipay: 1000
                    },
                    yunyun: {
                        cmbc: 26000,
                        icbc: 14000,
                        wechat: 900,
                        alipay: 1800
                    }
                },
                totals: {
                    xiaoxiao: 29500,
                    yunyun: 42700,
                    combined: 72200
                },
                changes: {
                    xiaoxiao: 2300,
                    yunyun: 3400,
                    combined: 5700
                },
                createdAt: "2024-08-31T14:45:00Z"
            }
        ],
        accountTypes: [
            { id: 'cmbc', name: '招商银行', icon: '🏦', color: '#d32f2f', category: 'bank' },
            { id: 'icbc', name: '中国银行', icon: '🏛️', color: '#1976d2', category: 'bank' },
            { id: 'wechat', name: '微信', icon: '💬', color: '#4caf50', category: 'payment' },
            { id: 'alipay', name: '支付宝', icon: '💰', color: '#2196f3', category: 'payment' }
        ],
        settings: {
            users: [
                { id: 'xiaoxiao', name: '肖肖', avatar: '👩', color: '#e91e63' },
                { id: 'yunyun', name: '运运', avatar: '👨', color: '#2196f3' }
            ]
        }
    };

    return testData;
}

// 加载测试数据的函数
function loadTestData() {
    if (window.app) {
        const testData = generateTestData();
        window.app.data = testData;
        window.app.saveData();
        window.app.updateOverview();
        window.app.updateAnalysisCharts();
        console.log('✅ 测试数据已加载');
        alert('测试数据已加载！现在可以看到图表数据了。');
    } else {
        console.error('❌ 应用未初始化');
    }
}

// 清空数据的函数
function clearTestData() {
    if (window.app) {
        window.app.data.monthlyRecords = [];
        window.app.saveData();
        window.app.updateOverview();
        window.app.updateAnalysisCharts();
        console.log('🗑️ 数据已清空');
        alert('数据已清空！');
    }
}

console.log('🧪 测试工具已加载');
console.log('📋 使用方法:');
console.log('  - loadTestData() : 加载测试数据');
console.log('  - clearTestData() : 清空所有数据');
console.log('  - generateTestData() : 生成测试数据对象');