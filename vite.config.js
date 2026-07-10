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
-- all access until you add a policy. Since this app doesn't have per-user
-- accounts yet (it uses the PIN-based trainee model built into the app),
-- these policies allow the app's public "anon" key to read and write freely.
--
-- IMPORTANT: this means anyone who has your site's URL and inspects the
-- page's JavaScript can find your Supabase URL and anon key and read/write
-- this table directly, bypassing the app's UI entirely. That's the same
-- trust model the app already had (the PIN system was never meant to be a
-- hard security boundary — see the app's own caveats about that). If you
-- later add real user accounts (Supabase Auth), tighten these policies to
-- check auth.uid() instead of allowing anyone.

alter table novare_kv enable row level security;

create policy "public read" on novare_kv
  for select using (true);

create policy "public write" on novare_kv
  for insert with check (true);

create policy "public update" on novare_kv
  for update using (true);
