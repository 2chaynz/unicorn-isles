-- Run once in Supabase: SQL Editor → New query → paste → Run.
create table if not exists public.user_state (
  user_id uuid primary key references auth.users on delete cascade,
  gems jsonb,
  lists jsonb,
  discovered jsonb,
  saved_filters jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

-- Each user reads and writes only their own row.
create policy "own state" on public.user_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
