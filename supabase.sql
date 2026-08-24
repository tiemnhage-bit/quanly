-- Bản 0.7: chạy toàn bộ đoạn này trong Supabase > SQL Editor
create table if not exists public.app_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  products jsonb not null default '[]'::jsonb,
  orders jsonb not null default '[]'::jsonb,
  ingredients jsonb not null default '[]'::jsonb,
  stock_receipts jsonb not null default '[]'::jsonb,
  stock_counts jsonb not null default '[]'::jsonb,
  stock_adjustments jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_states add column if not exists ingredients jsonb not null default '[]'::jsonb;
alter table public.app_states add column if not exists stock_receipts jsonb not null default '[]'::jsonb;
alter table public.app_states add column if not exists stock_counts jsonb not null default '[]'::jsonb;
alter table public.app_states add column if not exists stock_adjustments jsonb not null default '[]'::jsonb;
alter table public.app_states enable row level security;

drop policy if exists "Xem dữ liệu của chính mình" on public.app_states;
create policy "Xem dữ liệu của chính mình" on public.app_states for select using (auth.uid() = user_id);
drop policy if exists "Tạo dữ liệu của chính mình" on public.app_states;
create policy "Tạo dữ liệu của chính mình" on public.app_states for insert with check (auth.uid() = user_id);
drop policy if exists "Cập nhật dữ liệu của chính mình" on public.app_states;
create policy "Cập nhật dữ liệu của chính mình" on public.app_states for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
