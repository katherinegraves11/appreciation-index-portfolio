-- Run this once in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists briefs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  house text not null,
  bag text not null,
  spec text,
  horizon_years int not null,
  client_type text not null,
  cohort text,
  budget text,
  notes text,
  dossier text not null,
  sources jsonb not null default '[]'::jsonb,
  result jsonb not null,
  model text not null,
  usage jsonb
);

create index if not exists briefs_created_at_idx on briefs (created_at desc);

-- The app talks to this table with the service-role key from the server only.
-- Keep row-level security on so the anon key can't read it from a browser.
alter table briefs enable row level security;
