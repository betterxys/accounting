# 轻记账 Pro（GitHub Pages 直发 + Supabase 登录权限）

一个可直接上线的 Web 记账系统，支持：

- 邮箱登录/注册（Supabase Auth）
- 每个用户独立数据（RLS 权限隔离）
- 流水记账、预算管理、图表分析
- JSON 导入/导出备份

前端使用 **GitHub Pages 分支直接发布**，数据存储在 Supabase。

---

## 核心能力

### 1) 登录与权限
- 邮箱 + 密码注册/登录
- 未登录时页面锁定，无法操作账本
- 每个用户只能读写自己的账本数据（RLS）

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
在 Supabase 新建项目（免费套餐即可起步）。

### Step 2：执行 SQL 建表与权限
在 Supabase SQL Editor 执行：

- `supabase/schema.sql`

会创建 `public.user_bookkeeping_data`，并启用 RLS，仅允许用户访问自己的数据。

### Step 3：填写前端配置
编辑根目录文件：

- `supabase-config.js`

填入项目 URL 和 anon key（注意：**不要填 service role key**）：

```js
window.SUPABASE_CONFIG = {
  url: "https://xxxx.supabase.co",
  anonKey: "你的-anon-key"
};
```

---

## 部署到 GitHub Pages（推荐：直发模式）

### 当前发布模式
- Source：`Deploy from a branch`
- Branch：`cursor/web-30da`
- Folder：`/(root)`

### 稳定化建议（后续）
当该功能分支合并到主分支后，把 Pages 发布分支切到：

- Branch：`main`
- Folder：`/(root)`

这样更稳定，也避免长期使用临时开发分支发布。

---

## 目录结构（关键文件）

- `index.html`：主页面结构
- `style.css`：样式与响应式
- `script.js`：业务逻辑（登录、云端同步、记账功能）
- `supabase-config.js`：Supabase 前端配置
- `supabase/schema.sql`：建表 + RLS 权限策略

---

## 成本说明

- GitHub Pages：静态站点通常免费
- Supabase：有免费额度，个人记账通常可先免费使用
- 潜在费用来自超额存储/流量或短信登录（本项目默认邮箱登录）

---

## 常见问题

### Q1：别人能看到我的账本吗？
不能。别人即使访问页面，也需要登录；并且 RLS 会按 `auth.uid()` 隔离数据。

### Q2：登录后提示读取云端数据失败怎么办？
通常检查这三项：
- `supabase-config.js` 是否填写正确
- `supabase/schema.sql` 是否已执行
- RLS policy 是否创建成功

### Q3：anon key 放前端安全吗？
可以。anon key 不是管理员密钥，真正安全边界由 RLS 决定。
