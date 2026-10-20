-- ---------------------------------------------------------------------------
-- Keep-alive.
--
-- Supabase pauses FREE projects after a week without activity. This portal is
-- dormant for most of the year (a championship runs for a few weeks, then
-- nothing until the next edition), so between editions the project can pause —
-- the site still loads, but every database call fails, which would take down a
-- registration window that had just opened.
--
-- A paused project keeps its data and is restored in about a minute from the
-- dashboard, so this is not a data-loss risk. It is a availability risk, and
-- the fix is to generate a small amount of activity on a schedule.
--
-- `pg_cron` runs inside the database; `pg_net` lets it make an HTTP request.
-- The job calls the public `health` Edge Function twice a week, which
-- deliberately performs a real (but empty) database query, so the ping proves
-- the database answered rather than merely that the API is up.
--
-- This is a best-effort measure. Supabase's pausing is based on project
-- activity, so a scheduled in-database job is very likely — but not
-- contractually guaranteed — to prevent it. The certain fix is a paid plan,
-- and an external uptime monitor (see README §7) covers both cases and alerts
-- on genuine outages too.
--
-- Cost: nothing. Neither extension is billed.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any previous definition before re-scheduling, so the
-- migration can be re-run (and the schedule changed) without duplicates.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'keep-alive') then
    perform cron.unschedule('keep-alive');
  end if;
end
$$;

-- Monday and Thursday at 06:00 UTC — an even spread, so the gap between pings
-- can never approach the one-week pause threshold.
--
-- TIMEOUT: verified empirically, not guessed. At 5000 ms the call times out —
-- a cold Edge Function needs longer than that, so every ping would fail
-- silently and the keep-alive would do nothing while appearing healthy
-- (`net._http_response` recorded `timed_out = true`). 20000 ms returns 200 OK.
--
-- The URL is hardcoded because Postgres has no built-in knowledge of the
-- project's own URL (`app.settings.*` is empty on this project, so reading it
-- from there would silently schedule a job that calls a NULL url and never
-- works — worse than no keep-alive, because it would look like it was running).
-- This is not a secret: the same host appears in the shipped browser bundle and
-- in every client-side API call.
select cron.schedule(
  'keep-alive',
  '0 6 * * 1,4',
  $job$
  select net.http_get(
    url := 'https://urlkpbvvtossdzsjcmie.supabase.co/functions/v1/health',
    timeout_milliseconds := 20000
  )
  $job$
);
