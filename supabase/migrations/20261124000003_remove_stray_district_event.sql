-- ---------------------------------------------------------------------------
-- Remove the one stray district event left by 20261124000001.
--
-- `5000m Race Walk` was inserted into the closed `state-meet-2026`
-- championship by the wrong-slug migration. The earlier restore guard also
-- matched same-named registrations in the TNMAA championship, so this row was
-- kept. Here the check is scoped to the district championship and the row's
-- own event id, so those TNMAA registrations do not block the cleanup.
-- ---------------------------------------------------------------------------

delete from public.championship_events e
 where e.championship_id = (
         select id
         from public.championships
         where slug = 'state-meet-2026'
       )
   and e.name = '5000m Race Walk'
   and not exists (
     select 1
     from public.registration_events re
     join public.registrations r on r.id = re.registration_id
     where re.event_id = e.id
        or (re.event_name = e.name and r.championship_id = e.championship_id)
   );
