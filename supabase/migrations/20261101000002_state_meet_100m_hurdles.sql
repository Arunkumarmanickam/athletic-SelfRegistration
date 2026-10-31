-- ---------------------------------------------------------------------------
-- 100m Hurdles is open to both genders in the 2026 programme.
--
-- The event was originally seeded as women-only. The organiser's list offers
-- it to men 50+ to 65+ and women 30+ to 35+, so the row must no longer be
-- restricted to women. The per-gender category lists themselves are set by
-- 20261101000001_event_gender_categories.sql.
-- ---------------------------------------------------------------------------

update public.championship_events e
set gender = 'any'
from public.championships c
where c.id = e.championship_id
  and c.slug = 'state-meet-2026'
  and e.name = '100m Hurdles';
