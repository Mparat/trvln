create table if not exists public.saved_trips (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  variants    jsonb not null default '[]',
  preferences jsonb,
  created_at  timestamptz default now()
);

alter table public.saved_trips enable row level security;

create policy "select own trips"
  on public.saved_trips for select
  using (auth.uid() = user_id);

create policy "insert own trips"
  on public.saved_trips for insert
  with check (auth.uid() = user_id);

create policy "delete own trips"
  on public.saved_trips for delete
  using (auth.uid() = user_id);
