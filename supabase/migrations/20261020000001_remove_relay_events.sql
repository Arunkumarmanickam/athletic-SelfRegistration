-- Relay events do not exist in this project's programme. They were seeded by
-- 20261018000008_seed_categories_events.sql and snapshotted into the live
-- championship, but were never supposed to be offered. Remove them everywhere.
--
-- Detach first in case any registration ever referenced a relay event (none do
-- at the time of writing), then remove the events themselves.

delete from public.registration_events
where event_id in (
  select id from public.championship_events where name ilike '%relay%'
);

delete from public.championship_events where name ilike '%relay%';

delete from public.default_events where name ilike '%relay%';
