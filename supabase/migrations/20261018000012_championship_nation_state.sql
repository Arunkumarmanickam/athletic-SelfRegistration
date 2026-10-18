-- ---------------------------------------------------------------------------
-- 20261018000012_championship_nation_state.sql
--
-- A championship now declares *where* it belongs to, which decides the
-- "representing" question on the registration form:
--
--   level = 'state'     -> nation is India, state_name is the Indian state
--                          (e.g. Tamil Nadu). Athletes pick a district of that
--                          state.
--   level = 'national'  -> nation is the country (e.g. India). Athletes pick
--                          the Indian state they represent (or type a region
--                          for a country without a built-in list).
--
-- The world country list and the Indian state/district lists live in the
-- front-end (src/lib/geo.ts) so the form works without another round trip.
-- ---------------------------------------------------------------------------

alter table public.championships add column if not exists nation text;
alter table public.championships add column if not exists state_name text;

comment on column public.championships.nation is
  'Country the championship belongs to. Always India for a state-level meet.';
comment on column public.championships.state_name is
  'Indian state, for a state-level meet (e.g. Tamil Nadu). Null for a national meet.';

-- Existing championships: every one of them is in India.
update public.championships set nation = 'India' where nation is null;

-- The live state meet is the Coimbatore district championship, in Tamil Nadu,
-- so its athletes immediately get the Tamil Nadu district list.
update public.championships
   set state_name = 'Tamil Nadu'
 where level = 'state'
   and state_name is null
   and (slug = 'state-meet-2026' or name ilike '%coimbatore%');
