# 微信云开发部署指南

## 📋 前置准备

### 1. 注册微信小程序
1. 访问 [微信公众平台](https://mp.weixin.qq.com/)
2. 注册小程序账号（个人或企业）
3. 获取 AppID

### 2. 开通云开发
1. 登录微信开发者工具
2. 创建新项目，选择你的 AppID
3. 在开发者工具中点击"云开发" -> "开通"
4. 创建环境（推荐创建两个：开发环境和生产环境）

## 🚀 部署步骤

### 方法一：静态网站托管（推荐）

#### 1. 配置环境ID
编辑 `script.js` 文件，将 `your-env-id` 替换为你的云开发环境ID：
```javascript
cloud.init({
    env: 'cloud1-3g8s3xvm7609c639', // 你的云开发环境ID
    traceUser: true
});
```

#### 2. 部署云函数
1. 在微信开发者工具中打开项目
2. 右键点击 `cloudfunctions/login` 文件夹
3. 选择"上传并部署：云端安装依赖"

#### 3. 配置数据库
1. 在云开发控制台中选择"数据库"
2. 创建集合 `transactions`
3. 设置权限（参考 database.md）

#### 4. 部署静态网站
1. 在云开发控制台选择"静态网站托管"
2. 开通静态网站托管服务
3. 上传文件：
   - index.html
   - style.css  
   - script.js
4. 设置默认首页为 `index.html`

### 方法二：通过微信开发者工具

#### 1. 导入项目
1. 打开微信开发者工具
2. 选择"导入项目"
3. 选择项目目录
4. 填入 AppID

#### 2. 配置云函数
1. 在 `project.config.json` 中填入正确的 AppID
2. 右键云函数目录，选择"上传并部署"

#### 3. 发布到体验版
1. 点击"上传"按钮
2. 在微信公众平台后台发布体验版
3. 通过体验版二维码访问

## 🔧 配置说明

### 1. 环境变量
在 `script.js` 中需要配置的变量：
```javascript
// 云开发环境ID
env: 'cloud1-3g8s3xvm7609c639'

// 如果需要自定义域名，修改以下配置
// cloud.init({
//     env: 'cloud1-3g8s3xvm7609c639',
//     traceUser: true,
//     region: 'ap-shanghai' // 可选：指定地域
// });
```

### 2. 数据库权限设置
在云开发控制台 -> 数据库 -> 权限设置中：
```json
{
  "read": "auth.openid == resource.userId",
  "write": "auth.openid == resource.userId"
}
```

### 3. 静态网站托管配置
- 开启索引页面：index.html
- 开启错误页面：index.html（SPA路由支持）
- 开启HTTPS（默认开启）

## 🌐 域名配置

### 1. 使用默认域名
部署后会自动获得一个默认域名：
`https://cloud1-3g8s3xvm7609c639.web.app/`

### 2. 绑定自定义域名
1. 在"静态网站托管"中点击"设置"
2. 添加自定义域名
3. 配置DNS解析（CNAME记录）
4. 等待SSL证书生效

## 🔒 安全配置

### 1. 域名白名单
在微信公众平台 -> 开发 -> 开发设置中配置：
- request合法域名
- uploadFile合法域名  
- downloadFile合法域名

### 2. 云函数权限
确保云函数只能被授权用户调用：
```javascript
// 在云函数中验证用户身份
const wxContext = cloud.getWXContext()
if (!wxContext.OPENID) {
    return { code: -1, message: '未授权' }
}
```

## 📊 监控和日志

### 1. 云函数日志
在云开发控制台 -> 云函数 -> 日志中查看函数执行日志

### 2. 数据库监控
在数据库控制台中查看：
- 读写次数统计
- 存储容量使用情况
- 请求响应时间

### 3. 静态网站访问统计
在静态网站托管控制台查看：
- 访问量统计
- 流量使用情况
- CDN命中率

## 💡 优化建议

### 1. 性能优化
- 启用CDN加速
- 压缩静态资源
- 使用图片压缩

### 2. 成本优化
- 合理设置数据库索引
- 优化云函数执行时间
- 使用缓存减少数据库查询

### 3. 用户体验
- 添加加载状态
- 实现离线缓存
- 优化移动端适配

## 🛠️ 故障排查

### 常见问题

#### 1. 云开发初始化失败
- 检查环境ID是否正确
- 确认云开发服务已开通
- 检查网络连接

#### 2. 数据库权限错误
- 检查权限设置
- 确认用户已登录
- 验证userId字段

#### 3. 云函数调用失败
- 检查函数是否部署成功
- 查看云函数日志
- 确认参数格式正确

#### 4. 静态网站无法访问
- 检查文件是否上传完整
- 确认域名配置正确
- 验证SSL证书状态

## 📞 技术支持

- [微信云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)
- [云开发社区](https://developers.weixin.qq.com/community/minihome/mixflow/1286298/)
- [开发者工具下载](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)