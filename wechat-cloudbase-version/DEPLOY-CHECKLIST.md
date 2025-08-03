# ✅ 云开发部署检查清单

## 📋 部署前检查

### 1. 文件版本确认
- [ ] 确保使用 `wechat-cloudbase-version` 目录中的文件
- [ ] 不要使用其他目录的文件

### 2. 必需文件列表
```
wechat-cloudbase-version/
├── index.html    ← 最新版本，包含正确的SDK引用
├── script.js     ← CoupleAssetTracker类，云开发逻辑
├── style.css     ← 样式文件
└── test-data.js  ← 测试数据（可选）
```

### 3. SDK配置验证
- [ ] index.html中使用 `@cloudbase/js-sdk@1.7.1`
- [ ] script.js中使用 `tcb.init()` 而不是 `cloudbase.init()`

## 🚀 重新部署步骤

### 1. 清理旧文件
在微信云开发控制台 > 静态网站托管中：
- 删除所有现有文件
- 确保目录为空

### 2. 上传新文件
**严格按照以下顺序上传文件**：

1. **index.html** 
   ```html
   <!-- 应该包含这个SDK引用 -->
   <script src="https://unpkg.com/@cloudbase/js-sdk@1.7.1/dist/index.umd.js"></script>
   ```

2. **script.js**
   ```javascript
   // 应该包含这个初始化代码
   if (typeof tcb !== 'undefined') {
       this.cloudbase = tcb.init({
           env: 'cloud1-3g8s3xvm7609c639'
       });
   ```

3. **style.css** - 样式文件

4. **test-data.js** - 测试数据（可选）

### 3. 验证部署
- [ ] 访问云开发域名
- [ ] F12查看控制台，无404错误
- [ ] 看到正确的日志信息

## 🔍 部署后验证

### 预期日志信息
```javascript
// 正确的日志应该是：
"⚠️ 云开发不可用，使用本地存储模式"
// 或者
"✅ 云开发初始化成功"
```

### 预期界面状态
- [ ] 右上角显示 "🔐 点击登录启用云同步" 或 "💾 本地存储模式"
- [ ] 所有功能正常工作
- [ ] 无JavaScript错误

### 错误信息排查
如果还有错误：

1. **SDK 404错误**
   - 检查网络连接
   - 尝试访问SDK地址是否可用

2. **undefined错误**
   - 确保文件上传顺序正确
   - 检查script.js是否为最新版本

3. **DOM错误**
   - 确保HTML结构完整
   - 检查元素ID是否匹配

## 🆘 如果仍有问题

### 备用SDK地址
如果当前SDK不可用，可以试试：
```html
<!-- 备选方案1 -->
<script src="https://imgcache.qq.com/qcloud/cloudbase-js-sdk/1.7.1/cloudbase.full.js"></script>

<!-- 备选方案2 -->
<script src="https://static.cloudbase.net/js-sdk/1.7.1/cloudbase.full.js"></script>
```

### 完全降级版本
如果云开发SDK始终有问题，可以：
- 使用 `production-version` 中的文件
- 完全依赖localStorage，移除云开发功能

## ✅ 部署成功标志

访问网站后：
- ✅ 页面正常加载
- ✅ 控制台无错误
- ✅ 同步状态显示正常
- ✅ 所有功能可用
- ✅ 数据可以保存和读取