-- Per-request API cost accounting, in dollars, for pricing analysis.
-- One row per edge-function invocation that spent money on any model vendor.
-- Written by the service role only; no client access.
create table if not exists public.generation_costs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  function_name text not null,
  batch_id uuid,
  job_id uuid,
  theme text,
  day_count int,
  mode text,
  grounded boolean,
  request_id text,
  total_usd numeric(12, 6) not null,
  by_vendor jsonb not null default '{}'::jsonb,
  by_phase jsonb not null default '{}'::jsonb,
  entries jsonb not null default '[]'::jsonb
);

comment on table public.generation_costs is
  'Dollar cost of every model API call, per edge-function request. entries holds one object per API call (phase, vendor, model, tokens, usd).';

create index if not exists generation_costs_created_at_idx on public.generation_costs (created_at desc);
create index if not exists generation_costs_batch_idx on public.generation_costs (batch_id) where batch_id is not null;
create index if not exists generation_costs_day_count_idx on public.generation_costs (day_count) where day_count is not null;

alter table public.generation_costs enable row level security;
-- No policies: the service role bypasses RLS, and nothing else should read or
-- write cost data.
