#!/bin/bash

echo "🚀 启动记账网站本地调试环境"
echo "================================"

# 检查Node.js是否安装
if command -v node &> /dev/null; then
    echo "✅ 检测到 Node.js: $(node --version)"
    echo "🌐 使用 Node.js 服务器启动..."
    node server.js
elif command -v python3 &> /dev/null; then
    echo "✅ 检测到 Python3: $(python3 --version)"
    echo "🌐 使用 Python3 服务器启动..."
    echo "📡 访问地址: http://localhost:3000"
    python3 -m http.server 3000
elif command -v python &> /dev/null; then
    echo "✅ 检测到 Python: $(python --version)"
    echo "🌐 使用 Python 服务器启动..."
    echo "📡 访问地址: http://localhost:3000"
    python -m SimpleHTTPServer 3000
else
    echo "❌ 未找到 Node.js 或 Python"
    echo "请安装 Node.js 或 Python 后重试"
    echo ""
    echo "安装方法:"
    echo "  Node.js: https://nodejs.org/"
    echo "  Python: https://python.org/"
    exit 1
fi