-- ============================================================================
-- Athlete Registration Portal — Database functions
-- ============================================================================
-- Everything that must be race-safe or authoritative lives here:
--   * next_sequence_value      — atomic counters for athlete IDs and bibs
--   * generate_athlete_id      — permanent athlete identity (ATH-2026-000001)
--   * generate_bib_number      — per-championship registration code / bib
--   * check_rate_limit         — fixed-window limiter for public endpoints
--   * hash_token / hash_otp    — SHA-256 helpers (plaintext is never stored)
--   * create_registration      — validates, computes fees, assigns IDs, and
--                                creates/updates the registration atomically
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Atomic sequence counter
-- ---------------------------------------------------------------------------
create or replace function public.next_sequence_value(p_scope text, p_initial bigint default 1)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v bigint;
begin
  insert into public.id_sequences (scope, last_value)
  values (p_scope, p_initial)
  on conflict (scope) do update
    set last_value = public.id_sequences.last_value + 1
  returning last_value into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- SHA-256 helpers (hex). Used for OTP codes and session tokens.
-- ---------------------------------------------------------------------------
create or replace function public.hash_secret(p_value text)
returns text
language sql
immutable
as $$
  select encode(digest(p_value, 'sha256'), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- Athlete ID:  <PREFIX>-<YEAR>-<zero padded sequence>
-- Example:     ATH-2026-000001
-- ---------------------------------------------------------------------------
create or replace function public.generate_athlete_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg     jsonb := coalesce(
    (select value from public.app_settings where key = 'athlete_id_format'),
    '{"prefix": "ATH", "sequence_length": 6}'::jsonb);
  v_prefix  text  := coalesce(v_cfg->>'prefix', 'ATH');
  v_len     int   := coalesce((v_cfg->>'sequence_length')::int, 6);
  v_year    text  := to_char(now(), 'YYYY');
  v_seq     bigint;
  v_id      text;
begin
  v_seq := public.next_sequence_value('athlete:' || v_year);
  v_id  := v_prefix || '-' || v_year || '-' || lpad(v_seq::text, v_len, '0');
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Bib number (= championship Registration ID).
-- Format: <championship.bib_prefix><zero padded sequence>   e.g. M60103
-- Sequence is per championship, so concurrent championships never collide.
-- ---------------------------------------------------------------------------
create or replace function public.generate_bib_number(p_championship_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_len    int;
  v_start  bigint;
  v_seq    bigint;
begin
  select bib_prefix, bib_sequence_length, bib_start_number
    into v_prefix, v_len, v_start
  from public.championships
  where id = p_championship_id;

  if not found then
    raise exception 'Championship not found';
  end if;

  v_seq := public.next_sequence_value('bib:' || p_championship_id::text, v_start);
  return v_prefix || lpad(v_seq::text, greatest(v_len, 1), '0');
end $$;

-- ---------------------------------------------------------------------------
-- Fixed-window rate limiter. Returns true when the request is allowed.
-- ---------------------------------------------------------------------------
create or replace function public.check_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now  timestamptz := now();
  v_cur  record;
begin
  select window_start, count into v_cur
  from public.rate_limits
  where bucket_key = p_key
  for update;

  if not found then
    insert into public.rate_limits (bucket_key, window_start, count)
    values (p_key, v_now, 1);
    return true;
  end if;

  if v_now - v_cur.window_start > make_interval(secs => p_window_seconds) then
    update public.rate_limits set window_start = v_now, count = 1 where bucket_key = p_key;
    return true;
  end if;

  if v_cur.count >= p_limit then
    return false;
  end if;

  update public.rate_limits set count = count + 1 where bucket_key = p_key;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Completed years of age on a given date
-- ---------------------------------------------------------------------------
create or replace function public.age_on(p_dob date, p_on date)
returns integer
language sql
immutable
as $$
  select date_part('year', age(p_on, p_dob))::int;
$$;

-- ---------------------------------------------------------------------------
-- create_registration — the single authoritative entry point for creating or
-- refreshing a championship registration.
--
-- Parameters:
--   p_championship_id        championship to register for
--   p_athlete_session_token  raw token from a verified OTP session (returning
--                            athlete). When null a NEW profile is created.
--   p_personal               jsonb of personal fields (see edge function docs)
--   p_category_id            chosen category
--   p_event_ids              chosen events
--   p_request_ip             caller IP for the audit trail
--
-- Returns jsonb:
--   { ok: true,  registration_id, registration_code, fee_paise, currency,
--     athlete_id, profile_id, already_registered?... }
--   { ok: false, error: { code, message } }
-- ---------------------------------------------------------------------------
create or replace function public.create_registration(
  p_championship_id uuid,
  p_athlete_session_token text default null,
  p_personal jsonb default null,
  p_category_id uuid default null,
  p_event_ids uuid[] default '{}',
  p_request_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch           public.championships%rowtype;
  v_profile      public.athlete_profiles%rowtype;
  v_cat          public.championship_categories%rowtype;
  v_event        public.championship_events%rowtype;
  v_cutoff       date;
  v_age          int;
  v_fee          bigint;
  v_reg          public.registrations%rowtype;
  v_session_id   uuid;
  v_new_profile  boolean := false;
  v_has_existing boolean := false;
  v_code         text;
  v_event_ids    uuid[];
  v_event_id     uuid;
  v_existing     public.registrations%rowtype;
  v_attempts     int := 0;
begin
  -- ---- championship ---------------------------------------------------------
  select * into v_ch from public.championships where id = p_championship_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'CHAMPIONSHIP_NOT_FOUND', 'message', 'The selected championship does not exist.'));
  end if;

  if v_ch.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'REGISTRATION_CLOSED', 'message', 'Registration for this championship is not open.'));
  end if;

  if v_ch.registration_opens_at is not null and now() < v_ch.registration_opens_at then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_OPEN_YET', 'message', 'Registration for this championship has not opened yet.'));
  end if;

  if v_ch.registration_closes_at is not null and now() > v_ch.registration_closes_at then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'DEADLINE_PASSED', 'message', 'The registration deadline for this championship has passed.'));
  end if;

  -- ---- resolve athlete profile ---------------------------------------------
  if p_athlete_session_token is not null then
    select s.id into v_session_id
    from public.athlete_sessions s
    where s.token_hash = public.hash_secret(p_athlete_session_token)
      and s.revoked_at is null
      and s.expires_at > now();

    if not found then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'SESSION_EXPIRED', 'message', 'Your verification session has expired. Please verify again.'));
    end if;

    select * into v_profile
    from public.athlete_profiles p
    where p.id = (select athlete_profile_id from public.athlete_sessions where id = v_session_id)
    for update;
  else
    -- New athlete: basic fields are required to build the profile.
    if p_personal is null
       or nullif(trim(coalesce(p_personal->>'full_name', '')), '') is null
       or nullif(coalesce(p_personal->>'date_of_birth', ''), '') is null
       or nullif(coalesce(p_personal->>'gender', ''), '') is null
       or nullif(coalesce(p_personal->>'mobile_e164', ''), '') is null
       or nullif(trim(coalesce(p_personal->>'state', '')), '') is null then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'MISSING_FIELDS', 'message', 'Please fill in all required personal details.'));
    end if;

    -- Duplicate protection: same mobile number + date of birth almost always
    -- means the same person. Never reveal the existing profile — require the
    -- OTP verification flow instead.
    perform 1 from public.athlete_profiles p
    where p.mobile_e164 = p_personal->>'mobile_e164'
      and p.date_of_birth = (p_personal->>'date_of_birth')::date
    limit 1;
    if found then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'VERIFICATION_REQUIRED',
        'message', 'An athlete with this mobile number and date of birth may already exist. Please verify with the one-time password sent to that number to continue.'));
    end if;

    insert into public.athlete_profiles (
      athlete_id, full_name, date_of_birth, gender,
      mobile_country_code, mobile_number, mobile_e164, email,
      state, district, address, representing,
      emergency_contact_name, emergency_contact_phone
    ) values (
      public.generate_athlete_id(),
      trim(p_personal->>'full_name'),
      (p_personal->>'date_of_birth')::date,
      p_personal->>'gender',
      coalesce(p_personal->>'mobile_country_code', '+91'),
      p_personal->>'mobile_number',
      p_personal->>'mobile_e164',
      nullif(trim(coalesce(p_personal->>'email', '')), ''),
      trim(p_personal->>'state'),
      nullif(trim(coalesce(p_personal->>'district', '')), ''),
      nullif(trim(coalesce(p_personal->>'address', '')), ''),
      nullif(trim(coalesce(p_personal->>'representing', '')), ''),
      nullif(trim(coalesce(p_personal->>'emergency_contact_name', '')), ''),
      nullif(trim(coalesce(p_personal->>'emergency_contact_phone', '')), '')
    ) returning * into v_profile;

    v_new_profile := true;
  end if;

  -- ---- apply profile corrections (returning athletes) ------------------------
  if not v_new_profile and p_personal is not null then
    update public.athlete_profiles set
      full_name               = coalesce(nullif(trim(coalesce(p_personal->>'full_name', '')), ''), full_name),
      date_of_birth           = coalesce(nullif(coalesce(p_personal->>'date_of_birth', ''), '')::date, date_of_birth),
      gender                  = coalesce(nullif(coalesce(p_personal->>'gender', ''), ''), gender),
      mobile_country_code     = coalesce(nullif(coalesce(p_personal->>'mobile_country_code', ''), ''), mobile_country_code),
      mobile_number           = coalesce(nullif(coalesce(p_personal->>'mobile_number', ''), ''), mobile_number),
      mobile_e164             = coalesce(nullif(coalesce(p_personal->>'mobile_e164', ''), ''), mobile_e164),
      email                   = coalesce(nullif(trim(coalesce(p_personal->>'email', '')), ''), email),
      state                   = coalesce(nullif(trim(coalesce(p_personal->>'state', '')), ''), state),
      district                = coalesce(nullif(trim(coalesce(p_personal->>'district', '')), ''), district),
      address                 = coalesce(nullif(trim(coalesce(p_personal->>'address', '')), ''), address),
      representing            = coalesce(nullif(trim(coalesce(p_personal->>'representing', '')), ''), representing),
      emergency_contact_name  = coalesce(nullif(trim(coalesce(p_personal->>'emergency_contact_name', '')), ''), emergency_contact_name),
      emergency_contact_phone = coalesce(nullif(trim(coalesce(p_personal->>'emergency_contact_phone', '')), ''), emergency_contact_phone)
    where id = v_profile.id
    returning * into v_profile;
  end if;

  -- ---- already registered for this championship? -----------------------------
  select * into v_existing
  from public.registrations r
  where r.championship_id = p_championship_id
    and r.athlete_profile_id = v_profile.id
    and r.status in ('pending', 'confirmed')
  for update;

  v_has_existing := found;

  if v_has_existing and (v_existing.status = 'confirmed' or v_existing.payment_status = 'paid') then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'ALREADY_REGISTERED',
      'message', 'You are already registered for this championship.'));
  end if;

  -- ---- category ---------------------------------------------------------------
  if p_category_id is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'CATEGORY_REQUIRED', 'message', 'Please choose an age category.'));
  end if;

  select * into v_cat
  from public.championship_categories c
  where c.id = p_category_id and c.championship_id = p_championship_id and c.is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'CATEGORY_INVALID', 'message', 'The selected category is not available.'));
  end if;

  if v_cat.gender <> 'any' and v_cat.gender <> v_profile.gender then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'GENDER_NOT_ELIGIBLE', 'message', 'The selected category is not open to your gender.'));
  end if;

  -- Age is evaluated on a configurable cutoff date (defaults to championship start)
  if coalesce(v_ch.form_config->>'age_calculation_mode', 'championship_start') = 'fixed'
     and nullif(coalesce(v_ch.form_config->>'age_calculation_date', ''), '') is not null then
    v_cutoff := (v_ch.form_config->>'age_calculation_date')::date;
  else
    v_cutoff := coalesce(v_ch.starts_on, current_date);
  end if;

  v_age := public.age_on(v_profile.date_of_birth, v_cutoff);
  if v_age < v_cat.min_age or v_age > v_cat.max_age then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'AGE_NOT_ELIGIBLE',
      'message', format('Athlete is %s years old on %s, which does not fit the "%s" category (%s-%s).',
                        v_age, to_char(v_cutoff, 'DD Mon YYYY'), v_cat.name, v_cat.min_age, v_cat.max_age)));
  end if;

  -- ---- events ------------------------------------------------------------------
  v_event_ids := coalesce(p_event_ids, '{}');
  if array_length(v_event_ids, 1) is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'EVENTS_REQUIRED', 'message', 'Please select at least one event.'));
  end if;

  v_fee := v_ch.base_fee_paise + v_cat.fee_paise;

  foreach v_event_id in array v_event_ids loop
    select * into v_event
    from public.championship_events e
    where e.id = v_event_id and e.championship_id = p_championship_id and e.is_active;
    if not found then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'EVENT_INVALID', 'message', 'One of the selected events is not available.'));
    end if;
    if v_event.gender <> 'any' and v_event.gender <> v_profile.gender then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'EVENT_GENDER_NOT_ELIGIBLE',
        'message', format('The event "%s" is not open to your gender.', v_event.name)));
    end if;
    if v_event.category_ids is not null and not (v_cat.id = any (v_event.category_ids)) then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'EVENT_CATEGORY_NOT_ELIGIBLE',
        'message', format('The event "%s" is not offered in the "%s" category.', v_event.name, v_cat.name)));
    end if;
    v_fee := v_fee + v_event.fee_paise;
  end loop;

  -- ---- create or refresh the registration --------------------------------------
  if v_has_existing then
    -- An unpaid pending registration exists: refresh it in place so the
    -- athlete keeps the same bib number and no duplicates are created.
    update public.registrations set
      category_id   = v_cat.id,
      category_name = v_cat.name,
      fee_paise     = v_fee::int,
      form_snapshot = coalesce(p_personal, form_snapshot),
      request_ip    = coalesce(p_request_ip, request_ip),
      payment_status = 'pending'
    where id = v_existing.id
    returning * into v_reg;

    delete from public.registration_events where registration_id = v_reg.id;
  else
    -- Generate a bib number; retry on the (extremely unlikely) collision.
    loop
      v_attempts := v_attempts + 1;
      begin
        v_code := public.generate_bib_number(p_championship_id);
        insert into public.registrations (
          registration_code, athlete_profile_id, championship_id,
          category_id, category_name, fee_paise, currency,
          form_snapshot, request_ip
        ) values (
          v_code, v_profile.id, p_championship_id,
          v_cat.id, v_cat.name, v_fee::int, v_ch.currency,
          coalesce(p_personal, '{}'::jsonb), p_request_ip
        ) returning * into v_reg;
        exit;
      exception when unique_violation then
        if v_attempts >= 5 then raise; end if;
      end;
    end loop;
  end if;

  foreach v_event_id in array v_event_ids loop
    select * into v_event from public.championship_events where id = v_event_id;
    insert into public.registration_events (registration_id, event_id, event_name, fee_paise)
    values (v_reg.id, v_event.id, v_event.name, v_event.fee_paise)
    on conflict (registration_id, event_id) do nothing;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'registration_id', v_reg.id,
    'registration_code', v_reg.registration_code,
    'fee_paise', v_reg.fee_paise,
    'currency', v_reg.currency,
    'athlete_id', v_profile.athlete_id,
    'profile_id', v_profile.id,
    'is_new_profile', v_new_profile
  );
end $$;
