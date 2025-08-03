# GitHub同步命令

## 📋 完整操作步骤

### 1. 添加GitHub远程仓库
```bash
# 将下面的地址替换为你的GitHub仓库地址
git remote add origin https://github.com/你的GitHub用户名/仓库名.git

# 例如：git remote add origin https://github.com/xiaoys/wechat-expense-tracker.git
```

### 2. 验证远程仓库配置
```bash
git remote -v
```
应该看到：
```
origin    https://github.com/你的用户名/仓库名.git (fetch)
origin    https://github.com/你的用户名/仓库名.git (push)
wechat    https://git.weixin.qq.com/xiaoys/accounting.git (fetch)
wechat    https://git.weixin.qq.com/xiaoys/accounting.git (push)
```

### 3. 推送到GitHub
```bash
# 推送代码到GitHub
git push -u origin master
```

### 4. 如果遇到认证问题
```bash
# 如果需要设置用户信息
git config user.name "你的GitHub用户名"
git config user.email "你的GitHub邮箱"

# 如果需要缓存凭据
git config credential.helper store
```

## 🎉 完成后
推送成功后，你就可以：
- 在GitHub上查看你的项目
- 分享项目链接
- 使用GitHub的协作功能
- 设置GitHub Pages进行静态部署

## 📝 项目信息建议
- **仓库名**: `wechat-expense-tracker`
- **描述**: `基于微信云开发的个人记账网站 - Personal expense tracker built with WeChat Cloud Development`
- **标签**: `wechat`, `cloud-development`, `expense-tracker`, `javascript`, `html`, `css`