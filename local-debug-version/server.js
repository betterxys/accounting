const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// MIME类型映射
const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon'
};

function getContentType(filePath) {
    const ext = path.extname(filePath);
    return mimeTypes[ext] || 'text/plain';
}

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url);
    let pathname = parsedUrl.pathname;
    
    // 如果访问根路径，返回index.html
    if (pathname === '/') {
        pathname = '/index.html';
    }
    
    const filePath = path.join(__dirname, pathname);
    
    // 检查文件是否存在
    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            // 文件不存在，返回404
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>404 - 文件未找到</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        h1 { color: #dc3545; }
                    </style>
                </head>
                <body>
                    <h1>404 - 文件未找到</h1>
                    <p>请求的文件 <strong>${pathname}</strong> 不存在</p>
                    <p><a href="/">返回首页</a></p>
                </body>
                </html>
            `);
            return;
        }
        
        // 读取文件
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>500 - 服务器错误</title>
                        <style>
                            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                            h1 { color: #dc3545; }
                        </style>
                    </head>
                    <body>
                        <h1>500 - 服务器错误</h1>
                        <p>读取文件时发生错误</p>
                        <p><a href="/">返回首页</a></p>
                    </body>
                    </html>
                `);
                return;
            }
            
            // 返回文件内容
            const contentType = getContentType(filePath);
            res.writeHead(200, { 
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
                'Access-Control-Allow-Headers': 'Content-Type'
            });
            res.end(data);
        });
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log('🚀 本地调试服务器启动成功！');
    console.log(`📡 服务器地址: http://localhost:${PORT}`);
    console.log(`📁 当前目录: ${__dirname}`);
    console.log('');
    console.log('🔧 可用的调试功能:');
    console.log('  - 实时预览网站');
    console.log('  - 数据存储在localStorage');
    console.log('  - 浏览器开发者工具调试');
    console.log('  - 控制台调试命令');
    console.log('');
    console.log('⏹️  停止服务器: 按 Ctrl+C');
});

// 优雅退出
process.on('SIGINT', () => {
    console.log('\n👋 服务器正在关闭...');
    server.close(() => {
        console.log('✅ 服务器已停止');
        process.exit(0);
    });
});