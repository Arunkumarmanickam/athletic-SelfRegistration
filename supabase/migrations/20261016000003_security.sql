-- ============================================================================
-- Athlete Registration Portal — Security lockdown
-- ============================================================================
-- Row Level Security with NO policies for the public roles means the anon
-- and authenticated keys can never read or write these tables, even if the
-- frontend code (or the anon key) leaks. All access happens through Edge
-- Functions, which use the service-role key (bypasses RLS, server-side only).
-- ============================================================================

alter table public.app_settings            enable row level security;
alter table public.id_sequences            enable row level security;
alter table public.athlete_profiles        enable row level security;
alter table public.championships           enable row level security;
alter table public.championship_categories enable row level security;
alter table public.championship_events     enable row level security;
alter table public.registrations           enable row level security;
alter table public.registration_events     enable row level security;
alter table public.payments                enable row level security;
alter table public.payment_events          enable row level security;
alter table public.otp_challenges          enable row level security;
alter table public.athlete_sessions        enable row level security;
alter table public.admin_users             enable row level security;
alter table public.audit_logs              enable row level security;
alter table public.rate_limits             enable row level security;

-- Belt and suspenders: remove direct table privileges from the public roles.
-- The service_role keeps its privileges and bypasses RLS.
revoke all on public.app_settings            from anon, authenticated;
revoke all on public.id_sequences            from anon, authenticated;
revoke all on public.athlete_profiles        from anon, authenticated;
revoke all on public.championships           from anon, authenticated;
revoke all on public.championship_categories from anon, authenticated;
revoke all on public.championship_events     from anon, authenticated;
revoke all on public.registrations           from anon, authenticated;
revoke all on public.registration_events     from anon, authenticated;
revoke all on public.payments                from anon, authenticated;
revoke all on public.payment_events          from anon, authenticated;
revoke all on public.otp_challenges          from anon, authenticated;
revoke all on public.athlete_sessions        from anon, authenticated;
revoke all on public.admin_users             from anon, authenticated;
revoke all on public.audit_logs              from anon, authenticated;
revoke all on public.rate_limits             from anon, authenticated;

revoke execute on function public.create_registration(uuid, text, jsonb, uuid, uuid[], text) from public, anon, authenticated;
revoke execute on function public.generate_athlete_id() from public, anon, authenticated;
revoke execute on function public.generate_bib_number(uuid) from public, anon, authenticated;
revoke execute on function public.next_sequence_value(text, bigint) from public, anon, authenticated;
revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
revoke execute on function public.hash_secret(text) from public, anon, authenticated;

-- Only the server-side service role may call these functions.
grant execute on function public.create_registration(uuid, text, jsonb, uuid, uuid[], text) to service_role;
grant execute on function public.generate_athlete_id() to service_role;
grant execute on function public.generate_bib_number(uuid) to service_role;
grant execute on function public.next_sequence_value(text, bigint) to service_role;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
grant execute on function public.hash_secret(text) to service_role;
grant execute on function public.age_on(date, date) to service_role;

-- ---------------------------------------------------------------------------
-- Private storage bucket for athlete documents/photos.
-- No public policies: only the service role (Edge Functions) can access it.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'athlete-documents',
  'athlete-documents',
  false,
  5242880, -- 5 MB
  '["image/jpeg","image/png","image/webp","application/pdf"]'
)
on conflict (id) do nothing;
