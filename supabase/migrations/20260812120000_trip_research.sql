-- Shared grounded research for one "generate" click.
--
-- A batch fans out one itinerary per theme, and every variant used to resolve
-- the destination and re-run the same searches. Only the activities query
-- varies by theme, so research-trip now runs the shared work once, stores the
-- payload here, and each generate-itinerary invocation loads it by id.
--
-- Storing it server-side (rather than passing the research back through the
-- browser) keeps the payload off the wire and means a client cannot hand the
-- model text that the system prompt treats as factual ground truth.

create table if not exists public.trip_research (
  id uuid primary key,
  batch_id uuid,
  destinations text[] not null default '{}',
  destination_was_resolved boolean not null default false,
  research jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists trip_research_batch_id_idx
  on public.trip_research (batch_id);

create index if not exists trip_research_created_at_idx
  on public.trip_research (created_at);

alter table public.trip_research enable row level security;

-- No policies: this table is written and read only by the edge functions via
-- the service role, which bypasses RLS. The browser never touches it — it
-- only carries the research id between the two function calls — so anon and
-- authenticated get no grants at all.
