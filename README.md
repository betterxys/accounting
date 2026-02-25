# 轻记账 Pro（Web 版）

一个可直接上线的 Web 记账系统，支持**流水记账、预算控制、图表分析、数据备份恢复**。  
技术方案为纯前端（HTML + CSS + JavaScript + Chart.js），部署简单，打开即用。

---

## 功能清单

### 1) 流水管理
- 收入 / 支出双类型流水
- 账户、分类、金额、日期、备注
- 流水编辑与删除
- 按月份 / 类型 / 分类 / 关键词筛选

### 2) 仪表盘
- 当前总资产
- 当月收入、当月支出、结余率
- 最近 6 个月收支趋势图
- 当月支出分类占比图
- 各账户余额分布图
- 最近流水列表

### 3) 预算管理
- 按月 + 分类设置预算
- 自动计算已用、剩余 / 超支
- 预算执行进度条

### 4) 设置与数据管理
- 自定义账户（含初始余额）
- 自定义收入 / 支出分类
- 一键导出 JSON 备份
- JSON 导入恢复
- 一键清空全部数据

---

## 本地启动

```bash
npm run serve
# 或
python3 -m http.server 3000
```

浏览器访问：
- `http://localhost:3000`

---

## 部署（GitHub Pages 自动化）

仓库已内置工作流：`.github/workflows/deploy-pages.yml`

### 首次启用步骤
1. 打开 GitHub 仓库 Settings -> Pages
2. Source 选择 **GitHub Actions**
3. 推送代码后，工作流会自动发布到 Pages

### 访问地址
部署成功后，默认访问地址为：

`https://<你的GitHub用户名>.github.io/<仓库名>/`

例如本仓库一般是：

`https://betterxys.github.io/accounting/`

---

## 数据说明

- 浏览器本地存储键：`web_bookkeeping_pro_v1`
- 数据文件格式：JSON
- 不依赖后端数据库

---

## 目录结构（核心）

- `index.html`：页面结构
- `style.css`：样式和响应式布局
- `script.js`：业务逻辑、图表、数据存储
- `.github/workflows/deploy-pages.yml`：自动部署到 GitHub Pages

---

## 后续可扩展方向

- 多币种支持
- 周 / 年度报表
- 可视化账单导入（CSV / Excel）
- 多用户协作（接入后端）
