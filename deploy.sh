#!/bin/bash

# 记账网站部署脚本

set -e

echo "🚀 开始部署记账网站..."

# 检查是否安装了 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 请先安装 Node.js"
    echo "   下载地址: https://nodejs.org/"
    exit 1
fi

# 检查是否安装了 npm
if ! command -v npm &> /dev/null; then
    echo "❌ 错误: 请先安装 npm"
    exit 1
fi

echo "✅ Node.js 和 npm 已安装"

# 安装依赖
echo "📦 安装项目依赖..."
npm install

# 检查端口是否被占用
PORT=${1:-3000}
if lsof -i :$PORT > /dev/null 2>&1; then
    echo "⚠️  警告: 端口 $PORT 已被占用"
    echo "   请停止占用端口的进程或使用其他端口"
    echo "   使用方法: ./deploy.sh 3001"
    exit 1
fi

# 启动应用
echo "🎯 在端口 $PORT 启动应用..."
export PORT=$PORT
npm start &

# 获取进程ID
PID=$!

# 等待应用启动
sleep 3

# 检查应用是否成功启动
if ps -p $PID > /dev/null; then
    echo "✅ 应用启动成功!"
    echo "🌐 访问地址: http://localhost:$PORT"
    echo "📊 进程ID: $PID"
    echo ""
    echo "📋 管理命令:"
    echo "   停止应用: kill $PID"
    echo "   查看日志: tail -f nohup.out"
    echo ""
    echo "🔧 如需后台运行，请使用:"
    echo "   nohup npm start > app.log 2>&1 &"
else
    echo "❌ 应用启动失败"
    exit 1
fi