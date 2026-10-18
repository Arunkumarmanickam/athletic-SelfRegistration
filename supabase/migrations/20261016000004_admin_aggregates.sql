-- ============================================================================
-- Admin-side aggregate helpers
-- ============================================================================
-- Aggregations are performed in Postgres so the dashboard stays fast even
-- with tens of thousands of registrations (no full table scans in the client).
-- ============================================================================

create or replace function public.get_dashboard_stats()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'registrations_total',          (select count(*) from public.registrations),
    'registrations_paid',           (select count(*) from public.registrations where payment_status = 'paid'),
    'registrations_pending_payment',(select count(*) from public.registrations where payment_status = 'pending'),
    'registrations_failed_payment', (select count(*) from public.registrations where payment_status = 'failed'),
    'registrations_refunded',       (select count(*) from public.registrations where payment_status = 'refunded'),
    'registrations_cancelled',      (select count(*) from public.registrations
                                       where status = 'cancelled' or payment_status = 'cancelled'),
    'athletes_total',               (select count(*) from public.athlete_profiles),
    'payments_captured_count',      (select count(*) from public.payments where status = 'captured'),
    'payments_created_count',       (select count(*) from public.payments where status = 'created'),
    'payments_failed_count',        (select count(*) from public.payments where status = 'failed'),
    'payments_captured_amount_paise',
      coalesce((select sum(amount_paise) from public.payments where status = 'captured'), 0),
    'payments_refunded_amount_paise',
      coalesce((select sum(amount_paise) from public.payments where status = 'refunded'), 0),
    'by_championship', coalesce((
      select jsonb_agg(entry order by entry->>'name')
      from (
        select jsonb_build_object(
          'championship_id', c.id,
          'name', c.name,
          'status', c.status,
          'total', count(r.id),
          'paid', count(r.id) filter (where r.payment_status = 'paid'),
          'pending', count(r.id) filter (where r.payment_status = 'pending'),
          'failed', count(r.id) filter (where r.payment_status = 'failed')
        ) as entry
        from public.championships c
        left join public.registrations r on r.championship_id = c.id
        group by c.id, c.name, c.status
      ) s
    ), '[]'::jsonb),
    'by_gender', coalesce((
      select jsonb_agg(jsonb_build_object('gender', gender, 'count', cnt) order by cnt desc)
      from (
        select p.gender, count(*) as cnt
        from public.registrations r
        join public.athlete_profiles p on p.id = r.athlete_profile_id
        group by p.gender
      ) g
    ), '[]'::jsonb),
    'by_state', coalesce((
      select jsonb_agg(jsonb_build_object('state', state, 'count', cnt))
      from (
        select p.state, count(*) as cnt
        from public.registrations r
        join public.athlete_profiles p on p.id = r.athlete_profile_id
        group by p.state
        order by cnt desc
        limit 10
      ) st
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_dashboard_stats() from public, anon, authenticated;
grant execute on function public.get_dashboard_stats() to service_role;
