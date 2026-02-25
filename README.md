# 轻记账 Pro（GitHub Pages + Supabase 登录权限版）

一个可直接上线的 Web 记账系统，支持：

- 邮箱登录/注册（Supabase Auth）
- 每个用户独立数据（RLS 权限隔离）
- 流水记账、预算管理、图表分析
- JSON 导入/导出备份

前端部署在 GitHub Pages，数据存储在 Supabase。

---

## 核心能力

### 1) 登录与权限
- 邮箱 + 密码注册/登录
- 未登录时页面锁定，无法操作账本
- 每个用户只可读写自己的数据（Row Level Security）

### 2) 记账能力
- 收入/支出流水增删改查
- 账户与分类管理
- 多条件筛选（月份、类型、分类、关键词）
- 预算设置与执行进度
- 概览图表（趋势、分类占比、账户余额）

### 3) 数据管理
- 云端主存储：Supabase
- 本地缓存兜底：`localStorage`（`web_bookkeeping_cache_v2`）
- 导出 JSON / 导入 JSON

---

## 本地启动

```bash
npm run serve
# 或
python3 -m http.server 3000
```

访问：`http://localhost:3000`

---

## 首次接入 Supabase（必须）

### Step 1：创建 Supabase 项目
在 Supabase 新建一个项目（免费套餐即可起步）。

### Step 2：执行 SQL 建表与权限
打开 Supabase SQL Editor，执行：

- `supabase/schema.sql`

该脚本会创建 `public.user_bookkeeping_data`，并启用 RLS，仅允许用户访问自己的数据。

### Step 3：填写前端配置
编辑根目录文件：

- `supabase-config.js`

填入你的项目 URL 和 anon key（注意：**不要填 service role key**）：

```js
window.SUPABASE_CONFIG = {
  url: "https://xxxx.supabase.co",
  anonKey: "你的-anon-key"
};
```

---

## 部署到 GitHub Pages

项目已包含工作流：`.github/workflows/deploy-pages.yml`

### 启用方式
1. GitHub 仓库 -> `Settings` -> `Pages`
2. Source 选择 **GitHub Actions**
3. push 代码，工作流自动发布

> 注意：如果仓库是 private，且令牌权限受限，首次可能需要你在页面里手动启用 Pages。

---

## 目录结构（关键文件）

- `index.html`：主页面结构
- `style.css`：样式与响应式
- `script.js`：业务逻辑（登录、数据同步、记账功能）
- `supabase-config.js`：Supabase 前端配置
- `supabase/schema.sql`：建表 + RLS 权限策略
- `.github/workflows/deploy-pages.yml`：自动部署

---

## 成本说明

- GitHub Pages：通常免费（静态站点）
- Supabase：有免费额度，个人记账一般可先免费使用
- 潜在费用来自超额存储/流量或短信登录（本项目默认邮箱登录）

---

## 常见问题

### Q1：别人能看到我的账本吗？
不能。别人即使访问页面，也需要登录。并且 RLS 会按 `auth.uid()` 隔离数据。

### Q2：为什么我登录后提示读取云端数据失败？
通常是以下问题：
- `supabase-config.js` 未正确填写
- 未执行 `supabase/schema.sql`
- RLS policy 没有创建成功

### Q3：anon key 放前端安全吗？
可以。anon key 本身不是管理员密钥。真正安全边界由 RLS 决定。
