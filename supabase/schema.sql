-- Run this once in Supabase SQL Editor. Every policy restricts data to its owner.
create table if not exists public.library_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('image', 'video')),
  prompt text not null check (char_length(prompt) <= 8000),
  created_at timestamptz not null default now()
);

alter table public.library_items enable row level security;

create policy "Users manage their own library"
on public.library_items for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
