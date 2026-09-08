create extension if not exists pgcrypto;

create table if not exists public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6,8}$'),
  name text not null check (char_length(name) between 1 and 40),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.challenge_submissions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique,
  room_id uuid references public.game_rooms(id) on delete restrict,
  student_name text not null check (char_length(student_name) between 1 and 30),
  student_class text not null check (char_length(student_class) between 1 and 20),
  found_count integer not null check (found_count between 0 and 14),
  tap_count integer not null check (tap_count between 0 and 1000),
  total_score integer not null check (total_score between 0 and 2000),
  friend_name text not null,
  friend_phone text not null,
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.challenge_submissions
  add column if not exists room_id uuid references public.game_rooms(id) on delete restrict;

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists game_rooms_updated_at on public.game_rooms;
create trigger game_rooms_updated_at before update on public.game_rooms
for each row execute function public.set_updated_at();

drop trigger if exists challenge_submissions_updated_at on public.challenge_submissions;
create trigger challenge_submissions_updated_at before update on public.challenge_submissions
for each row execute function public.set_updated_at();

alter table public.game_rooms enable row level security;
alter table public.challenge_submissions enable row level security;

revoke all on public.game_rooms from anon, authenticated;
revoke all on public.challenge_submissions from anon, authenticated;
grant select on public.game_rooms to anon, authenticated;
grant insert, update, select on public.game_rooms to authenticated;
grant select on public.challenge_submissions to authenticated;

drop policy if exists "Visitors can find active rooms" on public.game_rooms;
create policy "Visitors can find active rooms" on public.game_rooms
for select to anon, authenticated using (
  status = 'active' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher'
);

drop policy if exists "Teachers can create rooms" on public.game_rooms;
create policy "Teachers can create rooms" on public.game_rooms
for insert to authenticated with check (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher'
);

drop policy if exists "Teachers can update rooms" on public.game_rooms;
create policy "Teachers can update rooms" on public.game_rooms
for update to authenticated using (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher'
) with check (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher'
);

drop policy if exists "Teachers can read submissions" on public.challenge_submissions;
create policy "Teachers can read submissions" on public.challenge_submissions
for select to authenticated using (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher'
);

do $$ begin
  alter publication supabase_realtime add table public.game_rooms;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.challenge_submissions;
exception when duplicate_object then null;
end $$;

-- 只需改成老师邮箱并执行一次：
-- update auth.users
-- set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"teacher"}'::jsonb
-- where email = 'teacher@example.com';
