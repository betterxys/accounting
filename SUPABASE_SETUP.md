# Supabase 同步初始化（IndexedDB + Supabase）

本文用于初始化本项目的云同步表结构与权限策略。

## 1) 在 Supabase SQL Editor 执行

```sql
create table if not exists public.asset_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.asset_documents enable row level security;

create policy "asset_documents_select_own"
on public.asset_documents
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "asset_documents_insert_own"
on public.asset_documents
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "asset_documents_update_own"
on public.asset_documents
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
```

## 2) 获取前端配置

在 Supabase Project Settings 中获取：

- `Project URL`
- `Publishable key`（或兼容期内的 `anon key`）

然后在系统「设置 -> 云同步（Supabase）」中填写并保存。

## 3) 登录与同步

1. 输入登录邮箱，点击「发送登录链接」。
2. 邮件中点击 Magic Link 回到页面。
3. 点击「立即同步」完成首次云端写入。

## 4) 注意事项

- 前端仅使用 `Publishable/anon key`，**不要**在浏览器中使用 `service_role key`。
- 当前同步表模型是“每个 Supabase 用户一份文档”。
- 如需多人共享同一份资产数据，可在后续版本增加 `household_id + members` 模型。
