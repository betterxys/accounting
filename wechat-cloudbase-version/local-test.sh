#!/bin/bash

echo "🌥️ 启动微信云开发版本本地测试..."
echo "📍 当前目录: $(pwd)"
echo ""

# 检查端口是否被占用
if lsof -Pi :3003 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  端口 3003 已被占用，尝试使用端口 3004"
    PORT=3004
else
    PORT=3003
fi

echo "🚀 启动本地服务器..."
echo "📱 访问地址: http://localhost:$PORT"
echo ""
echo "🔍 测试检查项："
echo "  1. 页面是否正常加载"
echo "  2. 是否显示'💾 本地存储模式'状态"
echo "  3. 所有功能是否正常工作"
echo "  4. 数据是否保存到localStorage"
echo ""
echo "💡 测试提示："
echo "  - 由于本地环境无云开发SDK，会自动降级到本地存储模式"
echo "  - 界面应该与正式版本完全相同"
echo "  - 可以正常记账、查看图表、导入导出数据"
echo ""
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