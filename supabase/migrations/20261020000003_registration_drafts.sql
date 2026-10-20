-- ---------------------------------------------------------------------------
-- Nothing is issued until payment succeeds.
--
-- The portal used to create a permanent athlete profile (and therefore an
-- Athlete ID) plus a bib number the moment someone submitted the form. Anyone
-- who filled in the form and then walked away at the payment gate left both
-- behind forever, which burns bib numbers and fills the athlete table with
-- people who never registered.
--
-- This migration moves the pre-payment stage into a staging table:
--
--   * `registration_drafts` holds an unpaid submission: the form data, the
--     Aadhaar-verified flag, the resolved category/events/fee and the Razorpay
--     order. It has NO athlete_profile_id, so no Athlete ID and no bib exist.
--   * On payment capture, `promote_draft` creates the athlete profile (reusing
--     an existing one when the same mobile + date of birth is already known),
--     issues the Athlete ID and bib, creates the confirmed registration, and
--     deletes the draft — all in one transaction.
--   * `prune_registration_drafts` deletes drafts that were never paid.
--
-- A draft is identified by a single-use bearer token (stored only as a hash),
-- which replaces the athlete session for the pre-payment steps. Athlete
-- sessions stay bound to real profiles, as before.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Staging table
-- ---------------------------------------------------------------------------
create table if not exists public.registration_drafts (
  id              uuid primary key default gen_random_uuid(),
  token_hash      text not null unique,
  championship_id uuid not null references public.championships (id) on delete cascade,
  category_id     uuid references public.championship_categories (id),
  category_name   text,
  -- the submitted form, exactly as the athlete typed it
  personal        jsonb not null default '{}'::jsonb,
  event_ids       uuid[] not null default '{}',
  fee_paise       integer not null default 0 check (fee_paise >= 0),
  currency        text not null default 'INR',
  aadhaar_verified_at timestamptz,
  request_ip      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '24 hours'
);

create index if not exists registration_drafts_champ_idx
  on public.registration_drafts (championship_id);
create index if not exists registration_drafts_expires_idx
  on public.registration_drafts (expires_at);

alter table public.registration_drafts enable row level security;

-- A registration remembers which draft produced it. The draft row is deleted on
-- promotion, so this is a plain uuid (deliberately NOT a foreign key) that makes
-- promote_draft idempotent and lets an order be traced back after the fact.
alter table public.registrations
  add column if not exists draft_id uuid;

create index if not exists registrations_draft_idx
  on public.registrations (draft_id) where draft_id is not null;

-- ---------------------------------------------------------------------------
-- Housekeeping: drop drafts that were never paid.
-- ---------------------------------------------------------------------------
create or replace function public.prune_registration_drafts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with gone as (
    delete from public.registration_drafts
    where expires_at < now()
      -- A draft that owns a live, non-failed Razorpay order is kept a little
      -- longer: the athlete may still be on the bank page.
      and not exists (
        select 1 from public.payment_orders o
        where o.draft_id = public.registration_drafts.id
          and o.status in ('created', 'authorized')
          and o.created_at > now() - interval '2 hours'
      )
    returning 1
  )
  select count(*) into v_deleted from gone;
  return v_deleted;
end $$;

grant execute on function public.prune_registration_drafts() to service_role;

-- ---------------------------------------------------------------------------
-- Payment orders placed against a draft.
--
-- Kept separate from `payments` because a payment row requires a real
-- registration (payments.registration_id is not null). The order lives here
-- until the payment is captured, at which point the payment row is created
-- against the promoted registration.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_orders (
  id                uuid primary key default gen_random_uuid(),
  draft_id          uuid not null references public.registration_drafts (id) on delete cascade,
  razorpay_order_id text not null unique,
  razorpay_payment_id text unique,
  amount_paise      integer not null check (amount_paise >= 0),
  currency          text not null default 'INR',
  status            text not null default 'created'
                      check (status in ('created', 'authorized', 'captured', 'failed', 'expired')),
  method            text,
  signature_verified boolean not null default false,
  failure_reason    text,
  attempt_number    integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  verified_at       timestamptz
);

create index if not exists payment_orders_draft_idx on public.payment_orders (draft_id);
create index if not exists payment_orders_status_idx on public.payment_orders (status);

alter table public.payment_orders enable row level security;
