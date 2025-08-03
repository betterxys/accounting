# 💰 个人记账网站

一个简单易用的个人记账网站，支持收入支出记录、分类管理和数据统计。

## 🌟 功能特性

- ✅ 添加收入/支出记录
- 📊 实时统计总收入、总支出和余额
- 🏷️ 支持多种分类（食物、交通、购物等）
- 📅 按日期记录和查看
- 💾 数据本地存储（JSON文件）
- 📱 响应式设计，支持手机访问
- 🎨 美观的界面设计

## 🚀 快速开始

### 本地运行

1. **克隆或下载项目**
   ```bash
   # 如果是从git仓库克隆
   git clone <your-repo-url>
   cd expense-tracker
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动应用**
   ```bash
   npm start
   ```

4. **访问应用**
   打开浏览器访问 `http://localhost:3000`

### 使用部署脚本

```bash
# 使用默认端口 3000
./deploy.sh

# 使用自定义端口
./deploy.sh 8080
```

## 🖥️ 部署到服务器

### 方法一：使用 PM2（推荐）

1. **安装 PM2**
   ```bash
   npm install -g pm2
   ```

2. **创建 PM2 配置文件**
   ```bash
   cat > ecosystem.config.js << EOF
   module.exports = {
     apps: [{
       name: 'expense-tracker',
       script: 'server/app.js',
       instances: 1,
       autorestart: true,
       watch: false,
       max_memory_restart: '1G',
       env: {
         NODE_ENV: 'production',
         PORT: 3000
       }
     }]
   };
   EOF
   ```

3. **启动应用**
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

### 方法二：使用 Docker

1. **创建 Dockerfile**
   ```dockerfile
   FROM node:18-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm install --production
   COPY . .
   EXPOSE 3000
   CMD ["npm", "start"]
   ```

2. **构建和运行**
   ```bash
   docker build -t expense-tracker .
   docker run -d -p 3000:3000 --name expense-app expense-tracker
   ```

### 方法三：直接部署

1. **上传文件到服务器**
   ```bash
   scp -r expense-tracker user@your-server:/home/user/
   ```

2. **在服务器上安装依赖并启动**
   ```bash
   ssh user@your-server
   cd /home/user/expense-tracker
   npm install --production
   nohup npm start > app.log 2>&1 &
   ```

## 🔧 环境要求

- Node.js 14.0 或更高版本
- npm 6.0 或更高版本

## 📁 项目结构

```
expense-tracker/
├── public/                 # 前端文件
│   ├── index.html         # 主页面
│   ├── style.css          # 样式文件
│   └── script.js          # 前端逻辑
├── server/                # 后端文件
│   ├── app.js            # 服务器主文件
│   └── data.json         # 数据存储文件
├── package.json          # 项目配置
├── deploy.sh            # 部署脚本
└── README.md           # 说明文档
```

## 🛡️ 安全注意事项

- 默认配置仅适合个人使用
- 生产环境建议添加用户认证
- 定期备份 `server/data.json` 文件
- 建议使用 HTTPS
- 可以设置防火墙限制访问

## 🔗 API 接口

- `GET /api/transactions` - 获取所有交易记录
- `POST /api/transactions` - 添加新的交易记录
- `DELETE /api/transactions/:id` - 删除指定交易记录
- `GET /api/stats` - 获取统计数据

## 🛠️ 自定义配置

### 修改端口
```bash
export PORT=8080
npm start
```

### 修改数据存储位置
编辑 `server/app.js` 中的 `DATA_FILE` 变量：
```javascript
const DATA_FILE = path.join(__dirname, '../data/transactions.json');
```

## 📝 更新日志

- v1.0.0 - 初始版本，基础记账功能

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License