-- TIỆM NHÀ GÉ / QUẢN LÝ QUÁN SaaS v0.24.3
-- Chạy 1 lần trên Supabase SQL Editor trước khi test đăng ký mới.

alter table public.user_profiles
  add column if not exists approval_status text not null default 'approved';

alter table public.user_profiles
  drop constraint if exists user_profiles_approval_status_check;

alter table public.user_profiles
  add constraint user_profiles_approval_status_check
  check (approval_status in ('pending','approved','active','rejected','suspended','locked'));

alter table public.shops
  add column if not exists business_type text;

alter table public.shops
  add column if not exists menu_preset text;

update public.user_profiles
set approval_status='approved'
where approval_status is null
   or approval_status not in ('pending','approved','active','rejected','suspended','locked');

update public.shops
set status='active', updated_at=now()
where status is null or trim(status)='';

select
  (select count(*) from public.user_profiles) as tong_user,
  (select count(*) from public.shops) as tong_quan,
  (select count(*) from public.user_profiles where approval_status='pending') as user_cho_duyet,
  (select count(*) from public.shops where status='pending') as quan_cho_duyet;
