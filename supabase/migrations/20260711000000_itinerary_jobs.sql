-- Server-side persistence for itinerary generation so a job finishes and is
-- saved even if the client tab is backgrounded/discarded (common on mobile).
-- The browser still streams live for the "watching" case; this table is the
-- backup a reloaded tab reconnects to.

create table if not exists public.itinerary_jobs (
  id uuid primary key,
  batch_id uuid not null,
  theme_id text,
  theme_name text,
  theme_emoji text,
  status text not null default 'pending', -- pending | complete | error
  content text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists itinerary_jobs_batch_id_idx
  on public.itinerary_jobs (batch_id);

alter table public.itinerary_jobs enable row level security;

-- Jobs are keyed by an unguessable UUID and hold no sensitive data (same trust
-- model as the public inspiration-media bucket). Allow anonymous reads so a
-- returning/reloaded tab can fetch its finished itinerary. Writes happen only
-- from the edge function via the service role, which bypasses RLS.
create policy "Anyone can read itinerary jobs"
  on public.itinerary_jobs for select
  using (true);

-- The browser reads jobs with the anon key; make the table privilege explicit.
grant select on public.itinerary_jobs to anon, authenticated;
