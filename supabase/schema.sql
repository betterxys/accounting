-- 为 Web 记账应用创建数据表和权限
-- 在 Supabase SQL Editor 里执行本文件

create table if not exists public.user_bookkeeping_data (
    user_id uuid primary key references auth.users(id) on delete cascade,
    payload jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.user_bookkeeping_data enable row level security;

drop policy if exists "Users can read own bookkeeping data" on public.user_bookkeeping_data;
create policy "Users can read own bookkeeping data"
on public.user_bookkeeping_data
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own bookkeeping data" on public.user_bookkeeping_data;
create policy "Users can insert own bookkeeping data"
on public.user_bookkeeping_data
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own bookkeeping data" on public.user_bookkeeping_data;
create policy "Users can update own bookkeeping data"
on public.user_bookkeeping_data
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own bookkeeping data" on public.user_bookkeeping_data;
create policy "Users can delete own bookkeeping data"
on public.user_bookkeeping_data
for delete
using (auth.uid() = user_id);
