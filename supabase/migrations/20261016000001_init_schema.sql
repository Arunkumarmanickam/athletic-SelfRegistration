-- ============================================================================
-- Athlete Registration Portal — Initial database schema
-- ============================================================================
-- Design notes:
--   * All athlete data lives in Postgres tables with Row Level Security enabled
--     and NO public policies: the browser can never read these tables directly.
--     Every read/write happens inside Edge Functions using the service role key.
--   * Identifiers:
--       - athlete_id        : permanent, one per human athlete (ATH-2026-000001)
--       - registration_code : one per championship registration; ALSO the bib
--                             number (e.g. M60103). There is intentionally no
--                             separate "bib_number" column.
--   * Money is stored as integer paise to avoid floating point errors.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- App-wide settings (key/value JSON store)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('athlete_id_format', '{"prefix": "ATH", "sequence_length": 6}'::jsonb),
  ('site', '{"organizer_name": "", "support_email": "", "support_phone": "", "address": ""}'::jsonb),
  ('notifications', '{"email_enabled": false, "sms_enabled": false}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Sequences used for athlete IDs and bib numbers (race-safe counters)
-- ---------------------------------------------------------------------------
create table if not exists public.id_sequences (
  scope       text primary key,
  last_value  bigint not null
);

-- ---------------------------------------------------------------------------
-- Reusable athlete profiles (permanent identity, independent of championships)
-- ---------------------------------------------------------------------------
create table if not exists public.athlete_profiles (
  id                      uuid primary key default gen_random_uuid(),
  athlete_id              text not null unique,
  full_name               text not null,
  date_of_birth           date not null,
  gender                  text not null check (gender in ('male', 'female', 'other')),
  mobile_country_code     text not null default '+91',
  mobile_number           text not null,
  mobile_e164             text not null,
  email                   text,
  state                   text not null,
  district                text,
  address                 text,
  representing            text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  photo_path              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists athlete_profiles_mobile_dob_idx
  on public.athlete_profiles (mobile_e164, date_of_birth);
create index if not exists athlete_profiles_name_idx
  on public.athlete_profiles (lower(full_name));

-- ---------------------------------------------------------------------------
-- Championships (many supported; one may be active initially)
-- ---------------------------------------------------------------------------
create table if not exists public.championships (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique,
  name                    text not null,
  description             text,
  location                text,
  starts_on               date,
  ends_on                 date,
  registration_opens_at   timestamptz,
  registration_closes_at  timestamptz,
  status                  text not null default 'draft'
                            check (status in ('draft', 'open', 'closed', 'archived')),
  currency                text not null default 'INR',
  base_fee_paise          integer not null default 0 check (base_fee_paise >= 0),
  -- Bib numbers are derived (M|W + age category + sequence) rather than
  -- configured per championship. See generate_bib_number().
  form_config             jsonb not null default '{}'::jsonb,
  terms_text              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Age categories per championship (fees + eligibility are configurable)
-- ---------------------------------------------------------------------------
create table if not exists public.championship_categories (
  id               uuid primary key default gen_random_uuid(),
  championship_id  uuid not null references public.championships (id) on delete cascade,
  name             text not null,
  gender           text not null default 'any' check (gender in ('any', 'male', 'female')),
  min_age          integer not null check (min_age >= 0),
  max_age          integer not null check (max_age >= 0),
  fee_paise        integer not null default 0 check (fee_paise >= 0),
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint categories_age_range check (max_age >= min_age),
  constraint categories_unique_name unique (championship_id, name)
);

-- ---------------------------------------------------------------------------
-- Events / disciplines per championship
-- ---------------------------------------------------------------------------
create table if not exists public.championship_events (
  id               uuid primary key default gen_random_uuid(),
  championship_id  uuid not null references public.championships (id) on delete cascade,
  name             text not null,
  gender           text not null default 'any' check (gender in ('any', 'male', 'female')),
  -- null  => event open to every category; otherwise restricted to listed categories
  category_ids     uuid[],
  fee_paise        integer not null default 0 check (fee_paise >= 0),
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint events_unique_name unique (championship_id, name)
);

-- ---------------------------------------------------------------------------
-- Registrations (one row per athlete per championship; code = bib number)
-- ---------------------------------------------------------------------------
create table if not exists public.registrations (
  id                 uuid primary key default gen_random_uuid(),
  registration_code  text not null,
  athlete_profile_id uuid not null references public.athlete_profiles (id),
  championship_id    uuid not null references public.championships (id),
  category_id        uuid references public.championship_categories (id),
  category_name      text,
  status             text not null default 'pending'
                       check (status in ('pending', 'confirmed', 'cancelled', 'withdrawn')),
  payment_status     text not null default 'pending'
                       check (payment_status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  fee_paise          integer not null check (fee_paise >= 0),
  currency           text not null default 'INR',
  -- snapshot of the athlete's details as submitted for THIS registration, so
  -- receipts/exports stay accurate even if the profile is edited later
  form_snapshot      jsonb not null default '{}'::jsonb,
  notes              text,
  request_ip         text,
  registered_at      timestamptz not null default now(),
  confirmed_at       timestamptz,
  updated_at         timestamptz not null default now(),
  constraint registrations_unique_code unique (championship_id, registration_code)
);

create index if not exists registrations_profile_idx  on public.registrations (athlete_profile_id);
create index if not exists registrations_champ_idx    on public.registrations (championship_id, payment_status);
create index if not exists registrations_status_idx   on public.registrations (status, payment_status);
create index if not exists registrations_registered_idx on public.registrations (registered_at desc);

-- ---------------------------------------------------------------------------
-- Event selections of a registration
-- ---------------------------------------------------------------------------
create table if not exists public.registration_events (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  event_id        uuid not null references public.championship_events (id),
  event_name      text not null,
  fee_paise       integer not null default 0,
  constraint registration_events_unique unique (registration_id, event_id)
);

-- ---------------------------------------------------------------------------
-- Payments (one row per Razorpay order attempt)
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id                   uuid primary key default gen_random_uuid(),
  registration_id      uuid not null references public.registrations (id),
  razorpay_order_id    text not null unique,
  razorpay_payment_id  text unique,
  amount_paise         integer not null check (amount_paise >= 0),
  currency             text not null default 'INR',
  status               text not null default 'created'
                         check (status in ('created', 'authorized', 'captured', 'failed', 'cancelled', 'refunded', 'expired')),
  method               text,
  failure_reason       text,
  signature_verified   boolean not null default false,
  attempt_number       integer not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  verified_at          timestamptz
);

create index if not exists payments_registration_idx on public.payments (registration_id, created_at desc);
create index if not exists payments_status_idx       on public.payments (status);

-- ---------------------------------------------------------------------------
-- Razorpay webhook event log (idempotency + audit)
-- ---------------------------------------------------------------------------
create table if not exists public.payment_events (
  id                  uuid primary key default gen_random_uuid(),
  razorpay_event_id   text not null unique,
  event_type          text not null,
  payload             jsonb,
  processing_status   text not null default 'received'
                        check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  error               text,
  received_at         timestamptz not null default now(),
  processed_at        timestamptz
);

-- ---------------------------------------------------------------------------
-- OTP challenges for returning-athlete verification (never store plaintext OTP)
-- ---------------------------------------------------------------------------
create table if not exists public.otp_challenges (
  id                 uuid primary key default gen_random_uuid(),
  athlete_profile_id uuid not null references public.athlete_profiles (id) on delete cascade,
  mobile_e164        text not null,
  code_hash          text not null,
  purpose            text not null default 'profile_lookup'
                       check (purpose in ('profile_lookup', 'profile_match')),
  attempts           integer not null default 0,
  max_attempts       integer not null default 5,
  expires_at         timestamptz not null,
  consumed_at        timestamptz,
  request_ip         text,
  created_at         timestamptz not null default now()
);

create index if not exists otp_challenges_mobile_idx on public.otp_challenges (mobile_e164, created_at desc);
create index if not exists otp_challenges_profile_idx on public.otp_challenges (athlete_profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Short-lived sessions issued after a successful OTP verification
-- ---------------------------------------------------------------------------
create table if not exists public.athlete_sessions (
  id                 uuid primary key default gen_random_uuid(),
  athlete_profile_id uuid not null references public.athlete_profiles (id) on delete cascade,
  token_hash         text not null unique,
  expires_at         timestamptz not null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists athlete_sessions_profile_idx on public.athlete_sessions (athlete_profile_id);

-- ---------------------------------------------------------------------------
-- Admin users (linked to Supabase Auth accounts)
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null default 'admin' check (role in ('owner', 'admin', 'viewer')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit trail for administrative actions
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.admin_users (id) on delete set null,
  admin_email   text,
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  details       jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- Simple fixed-window rate limiting for public endpoints
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  bucket_key   text primary key,
  window_start timestamptz not null,
  count        integer not null default 0
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists athlete_profiles_updated_at on public.athlete_profiles;
create trigger athlete_profiles_updated_at before update on public.athlete_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists championships_updated_at on public.championships;
create trigger championships_updated_at before update on public.championships
  for each row execute function public.set_updated_at();

drop trigger if exists categories_updated_at on public.championship_categories;
create trigger categories_updated_at before update on public.championship_categories
  for each row execute function public.set_updated_at();

drop trigger if exists events_updated_at on public.championship_events;
create trigger events_updated_at before update on public.championship_events
  for each row execute function public.set_updated_at();

drop trigger if exists registrations_updated_at on public.registrations;
create trigger registrations_updated_at before update on public.registrations
  for each row execute function public.set_updated_at();

drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

drop trigger if exists admin_users_updated_at on public.admin_users;
create trigger admin_users_updated_at before update on public.admin_users
  for each row execute function public.set_updated_at();
