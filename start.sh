#!/bin/bash

echo "💰 启动轻记账 Pro（Web版）"
echo "================================"

# 检查并启动本地服务器
if command -v python3 &> /dev/null; then
    echo "✅ 检测到 Python3: $(python3 --version)"
    echo "🌐 启动本地服务器..."
    echo "📡 访问地址: http://localhost:3000"
    echo "⏹️  停止服务器: 按 Ctrl+C"
    echo ""
    python3 -m http.server 3000
elif command -v python &> /dev/null; then
    echo "✅ 检测到 Python: $(python --version)"
    echo "🌐 启动本地服务器..."
    echo "📡 访问地址: http://localhost:3000"
    echo "⏹️  停止服务器: 按 Ctrl+C"
    echo ""
    python -m SimpleHTTPServer 3000
elif command -v node &> /dev/null; then
    echo "✅ 检测到 Node.js: $(node --version)"
    echo "🌐 启动本地服务器..."
    echo "📡 访问地址: http://localhost:3000"
    echo "⏹️  停止服务器: 按 Ctrl+C"
    echo ""
    npx serve . -p 3000
else
    echo "❌ 未找到 Python 或 Node.js"
    echo ""
    echo "📱 您可以直接双击 index.html 文件在浏览器中使用"
    echo ""
    echo "🔧 或者安装以下任一工具后重新运行："
    echo "   • Python: https://python.org/"
    echo "   • Node.js: https://nodejs.org/"
    echo ""
    
    # 尝试直接打开浏览器
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "🚀 正在尝试打开浏览器..."
        open index.html
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "🚀 正在尝试打开浏览器..."
        xdg-open index.html
    elif [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "msys" ]]; then
        echo "🚀 正在尝试打开浏览器..."
        start index.html
    fi
fi