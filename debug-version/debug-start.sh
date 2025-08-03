#!/bin/bash

echo "🔧 启动调试版本..."
echo "📍 当前目录: $(pwd)"
echo "🌐 调试模式：自动加载测试数据"

# 检查端口是否被占用
if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  端口 3001 已被占用，尝试使用端口 3002"
    PORT=3002
else
    PORT=3001
fi

echo "🚀 启动本地服务器..."
echo "📱 访问地址: http://localhost:$PORT"
echo "🧪 调试提示: 打开浏览器控制台输入 loadTestData() 可加载测试数据"
echo "🛑 按 Ctrl+C 停止服务器"
echo ""

# 优先使用 Python，否则使用 Node.js
if command -v python3 >/dev/null 2>&1; then
    echo "使用 Python 服务器..."
    python3 -m http.server $PORT
elif command -v node >/dev/null 2>&1; then
    echo "使用 Node.js 服务器..."
    npx serve . -p $PORT
else
    echo "❌ 错误: 未找到 Python3 或 Node.js"
    echo "请安装其中之一："
    echo "  - Python: https://python.org"
    echo "  - Node.js: https://nodejs.org"
    exit 1
fi