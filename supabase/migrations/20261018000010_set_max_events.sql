-- ---------------------------------------------------------------------------
-- 20261018000010_set_max_events.sql
--
-- Sets the per-athlete event cap for the 44th Coimbatore District Masters meet
-- to 3, so the form blocks a 4th selection. Change it any time in the admin UI
-- (championship -> Max events per athlete); NULL means unlimited.
--
-- Idempotent.
-- ---------------------------------------------------------------------------
update public.championships
set max_events_per_athlete = 3,
    updated_at = now()
where slug = 'state-meet-2026';
