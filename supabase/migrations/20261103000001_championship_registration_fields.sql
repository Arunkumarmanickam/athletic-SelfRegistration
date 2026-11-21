-- ---------------------------------------------------------------------------
-- Custom registration fields per championship
--
-- Lets an administrator add extra input fields to the public registration form
-- for a championship (e.g. T-Shirt Size, Dietary Preference, Emergency
-- Contact Name). Each field has a type (text, dropdown, radio, checkbox), a
-- list of options for choice-based types, a required flag, and a sort order.
--
-- The submitted values are stored inside the draft's / registration's `personal`
-- jsonb, so nothing about the core schema changes. A championship's custom
-- fields are returned alongside its categories and events by
-- `admin-championships` (action `list`) and `public-config`, and can be managed
-- with actions `field_create` / `field_update` / `field_delete`.
-- ---------------------------------------------------------------------------

create table if not exists public.championship_registration_fields (
  id              uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships (id) on delete cascade,
  field_key       text not null,
  label           text not null,
  field_type      text not null check (field_type in ('text', 'dropdown', 'radio', 'checkbox')),
  options         jsonb not null default '[]'::jsonb,
  is_required     boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint championship_registration_fields_champ_key_key
    unique (championship_id, field_key)
);

create index if not exists championship_registration_fields_champ_idx
  on public.championship_registration_fields (championship_id);

-- All application access goes through Edge Functions using the service role,
-- matching the rest of this schema: enable RLS, grant no direct role access.
alter table public.championship_registration_fields enable row level security;

-- Auto-set updated_at on changes (public.set_updated_at already exists).
create trigger championship_registration_fields_updated_at
before update on public.championship_registration_fields
for each row execute function public.set_updated_at();
