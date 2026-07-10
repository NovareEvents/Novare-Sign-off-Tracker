-- Run this once in your Supabase project's SQL Editor (Supabase dashboard ->
-- SQL Editor -> New query -> paste this -> Run).
--
-- This creates one table that stores the app's shared data as key/value
-- rows (same shape as the roster/shifts/calendar keys the app already uses).
-- It's intentionally simple: it mirrors exactly what the app was already
-- doing, just backed by a real database instead of the Claude artifact
-- storage API.

create table if not exists novare_kv (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security is on by default for new Supabase tables, which blocks
-- all access until you add a policy. These policies require a real,
-- logged-in Supabase Auth session (admin or trainee — either counts) to
-- read or write this table. Someone who isn't logged in — even if they have
-- your site's public key — gets nothing.

alter table novare_kv enable row level security;

create policy "authenticated read" on novare_kv
  for select using (auth.role() = 'authenticated');

create policy "authenticated write" on novare_kv
  for insert with check (auth.role() = 'authenticated');

create policy "authenticated update" on novare_kv
  for update using (auth.role() = 'authenticated');
