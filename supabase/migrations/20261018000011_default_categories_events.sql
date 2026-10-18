-- ---------------------------------------------------------------------------
-- 20261018000011_default_categories_events.sql
--
-- Age categories and events become *standard defaults*.
--
--   * Every newly created championship is seeded from these two tables, so a
--     new championship is immediately usable without re-typing the same 15 age
--     brackets and 22 events.
--   * While creating a championship the organiser can uncheck any default (or
--     add extra ones) for that championship only.
--   * Editing or deleting a championship's own categories/events never changes
--     these defaults, and changing these defaults never touches championships
--     that were already created.
--
-- Seeded from the state-meet-2026 configuration so the standard set is exactly
-- the 15 masters age brackets (30+ ... 100+) and the 22 track & field events
-- already in use.
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

create table if not exists public.default_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  gender      text not null default 'any' check (gender in ('any', 'male', 'female')),
  min_age     integer not null check (min_age >= 0),
  max_age     integer not null check (max_age >= 0),
  fee_paise   integer not null default 0 check (fee_paise >= 0),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint default_categories_age_range check (max_age >= min_age)
);

create table if not exists public.default_events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  gender      text not null default 'any' check (gender in ('any', 'male', 'female')),
  fee_paise   integer not null default 0 check (fee_paise >= 0),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists default_categories_updated_at on public.default_categories;
create trigger default_categories_updated_at before update on public.default_categories
  for each row execute function public.set_updated_at();

drop trigger if exists default_events_updated_at on public.default_events;
create trigger default_events_updated_at before update on public.default_events
  for each row execute function public.set_updated_at();

-- Only the service role (Edge Functions) may touch the defaults.
alter table public.default_categories enable row level security;
alter table public.default_events     enable row level security;
revoke all on public.default_categories from anon, authenticated;
revoke all on public.default_events     from anon, authenticated;

-- ---- seed the standard set from the championship already configured --------
insert into public.default_categories (name, gender, min_age, max_age, fee_paise, is_active, sort_order)
select c.name, c.gender, c.min_age, c.max_age, c.fee_paise, c.is_active, c.sort_order
from public.championship_categories c
join public.championships ch on ch.id = c.championship_id
where ch.slug = 'state-meet-2026'
on conflict (name) do nothing;

insert into public.default_events (name, gender, fee_paise, is_active, sort_order)
select e.name, e.gender, e.fee_paise, e.is_active, e.sort_order
from public.championship_events e
join public.championships ch on ch.id = e.championship_id
where ch.slug = 'state-meet-2026'
on conflict (name) do nothing;
