# 💰 肖肖&运运资产管理系统（GitHub Pages）

专为肖肖和运运设计的双人资产管理系统，支持月度记账、趋势分析和可视化图表。

> 当前仓库只保留 **1 套实现**：纯前端 GitHub Pages 版本（`index.html + style.css + script.js`）。

## ✨ 核心功能

- 资产概览：显示肖肖、运运及家庭总资产
- 月度记账：双人分账户录入，支持历史记录编辑/删除
- 数据分析：趋势图、账户分布图、月度变化图、个人对比图
- 系统设置：账户类型管理、数据导入/导出、数据清空

## 📁 项目结构

```text
.
├── index.html          # 页面结构
├── style.css           # 样式
├── script.js           # 核心逻辑
├── test-data.js        # 测试数据工具（loadTestData/clearTestData）
├── start.sh            # 本地启动脚本
├── package.json
└── 数据结构设计.md
```

## 🚀 本地运行

### 方法 1：直接打开

双击 `index.html`，即可在浏览器使用。

### 方法 2：启动本地服务器

```bash
./start.sh
```

默认访问地址：`http://localhost:3000`

## 🌐 部署到 GitHub Pages

1. 将代码推送到 GitHub 仓库（建议默认分支）。
2. 打开仓库 `Settings -> Pages`。
3. `Build and deployment` 选择 `Deploy from a branch`。
4. Branch 选择你的发布分支（如 `main`），Folder 选择 `/ (root)`。
5. 保存后等待 GitHub Pages 发布完成。

发布成功后，可通过仓库给出的 Pages URL 访问系统。

## 🧪 快速测试

打开浏览器开发者工具（F12），在控制台执行：

```javascript
loadTestData();   // 加载示例数据
clearTestData();  // 清空测试数据
```

## 💾 数据存储说明

- 数据保存在浏览器 `localStorage`（键名：`coupleAssetTracker`）
- 清空浏览器数据会导致本地记录丢失
- 建议定期在设置页导出 JSON 备份

## 🔧 开发说明

- 这是纯前端项目，无后端依赖
- 修改后直接提交并重新发布 GitHub Pages 即可生效
