-- Payments foundation: purchases, credit ledger, trip entitlements, and the
-- private store for gated generation state. See docs/payments-spec.md.

-- ── purchases ────────────────────────────────────────────────────────────────
-- One row per completed Stripe checkout. stripe_session_id's uniqueness is the
-- idempotency anchor for webhook retries and the confirm-checkout fallback.
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_session_id text not null unique,
  stripe_payment_intent text,
  product_key text not null,
  amount_cents integer not null,
  credits integer not null,
  created_at timestamptz not null default now()
);

alter table public.purchases enable row level security;

create policy "Users can view their own purchases"
  on public.purchases for select
  using (auth.uid() = user_id);

-- ── credit_ledger ────────────────────────────────────────────────────────────
-- Append-only. Balance = sum(delta). Grants are positive (purchase, refund
-- adjustments are negative), spends are -1 with reason 'trip_entitlement'.
create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null,
  purchase_id uuid references public.purchases(id),
  batch_id uuid,
  created_at timestamptz not null default now()
);

-- A batch can be spent on exactly once, ever — this is what makes retries and
-- extra variants of a paid trip structurally free.
create unique index credit_ledger_one_spend_per_batch
  on public.credit_ledger (batch_id)
  where reason = 'trip_entitlement';

create index credit_ledger_user_idx on public.credit_ledger (user_id);

alter table public.credit_ledger enable row level security;

create policy "Users can view their own ledger"
  on public.credit_ledger for select
  using (auth.uid() = user_id);

-- ── trip_entitlements ────────────────────────────────────────────────────────
-- Which batches generate in full. generate-itinerary's tier check reads this.
create table public.trip_entitlements (
  batch_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ledger_id uuid not null references public.credit_ledger(id),
  created_at timestamptz not null default now()
);

create index trip_entitlements_user_idx on public.trip_entitlements (user_id);

alter table public.trip_entitlements enable row level security;

create policy "Users can view their own entitlements"
  on public.trip_entitlements for select
  using (auth.uid() = user_id);

-- ── itinerary_jobs_private ───────────────────────────────────────────────────
-- Unredacted generation output + the state a resume needs (research blocks,
-- plan findings, preferences). RLS with no policies = service role only, same
-- pattern as generation_costs. The public itinerary_jobs.content column only
-- ever holds the redacted stream.
create table public.itinerary_jobs_private (
  job_id uuid primary key,
  content text not null,
  resume_state jsonb,
  updated_at timestamptz not null default now()
);

alter table public.itinerary_jobs_private enable row level security;

-- ── credit_balances ──────────────────────────────────────────────────────────
-- security_invoker so the ledger's RLS applies: each user sees only their own
-- balance row.
create view public.credit_balances
  with (security_invoker = true) as
  select user_id, coalesce(sum(delta), 0)::integer as balance
  from public.credit_ledger
  group by user_id;

-- ── attribution columns ──────────────────────────────────────────────────────
alter table public.itinerary_jobs add column user_id uuid;
alter table public.generation_costs add column user_id uuid;

-- ── saved_trips: allow re-saving an unlocked trip in place ───────────────────
create policy "Users can update their own trips"
  on public.saved_trips for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── entitle_batch ────────────────────────────────────────────────────────────
-- Atomically spend one credit on a batch. Idempotent per batch: if the batch
-- is already entitled this is a no-op returning the current balance. Raises
-- INSUFFICIENT_CREDITS when the balance is 0. The advisory lock serializes
-- concurrent spends by the same user (two tabs racing with one credit).
create function public.entitle_batch(p_user uuid, p_batch uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_ledger_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('credit_ledger'), hashtext(p_user::text));

  select coalesce(sum(delta), 0) into v_balance
  from credit_ledger where user_id = p_user;

  if exists (select 1 from trip_entitlements where batch_id = p_batch) then
    return v_balance;
  end if;

  if v_balance < 1 then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  insert into credit_ledger (user_id, delta, reason, batch_id)
  values (p_user, -1, 'trip_entitlement', p_batch)
  returning id into v_ledger_id;

  insert into trip_entitlements (batch_id, user_id, ledger_id)
  values (p_batch, p_user, v_ledger_id);

  return v_balance - 1;
end;
$$;

-- ── apply_purchase ───────────────────────────────────────────────────────────
-- Called by the Stripe webhook and the confirm-checkout fallback, possibly
-- both for the same session — the on-conflict short-circuit makes the second
-- call a no-op. Grants the pack's credits and, for an unlock purchase, spends
-- one immediately on the batch being unlocked.
create function public.apply_purchase(
  p_session_id text,
  p_user uuid,
  p_product_key text,
  p_amount_cents integer,
  p_credits integer,
  p_payment_intent text default null,
  p_unlock_batch uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_id uuid;
begin
  insert into purchases (user_id, stripe_session_id, stripe_payment_intent,
                         product_key, amount_cents, credits)
  values (p_user, p_session_id, p_payment_intent,
          p_product_key, p_amount_cents, p_credits)
  on conflict (stripe_session_id) do nothing
  returning id into v_purchase_id;

  if v_purchase_id is null then
    return;
  end if;

  insert into credit_ledger (user_id, delta, reason, purchase_id)
  values (p_user, p_credits, 'purchase', v_purchase_id);

  if p_unlock_batch is not null then
    perform entitle_batch(p_user, p_unlock_batch);
  end if;
end;
$$;

-- ── dock_refund ──────────────────────────────────────────────────────────────
-- Docks a refunded purchase's credits, capped at what the user still has —
-- entitlements already consumed are not clawed back.
create function public.dock_refund(p_session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase purchases%rowtype;
  v_balance integer;
  v_dock integer;
begin
  select * into v_purchase from purchases where stripe_session_id = p_session_id;
  if v_purchase.id is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('credit_ledger'), hashtext(v_purchase.user_id::text));

  if exists (select 1 from credit_ledger
             where purchase_id = v_purchase.id and reason = 'refund') then
    return;
  end if;

  select coalesce(sum(delta), 0) into v_balance
  from credit_ledger where user_id = v_purchase.user_id;

  v_dock := least(v_balance, v_purchase.credits);
  if v_dock > 0 then
    insert into credit_ledger (user_id, delta, reason, purchase_id)
    values (v_purchase.user_id, -v_dock, 'refund', v_purchase.id);
  end if;
end;
$$;

-- These run with definer rights; only the service role (edge functions) may
-- call them.
revoke execute on function public.entitle_batch(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.apply_purchase(text, uuid, text, integer, integer, text, uuid) from public, anon, authenticated;
revoke execute on function public.dock_refund(text) from public, anon, authenticated;
