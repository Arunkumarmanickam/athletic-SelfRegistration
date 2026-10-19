-- ---------------------------------------------------------------------------
-- Bib numbers at registration time (not after payment).
--
-- Rationale: the payment gateway is not configured yet, and organisers need
-- real bib numbers to test the full flow and prepare bib printing. The bib is
-- therefore issued the moment a registration row is created (and on refresh of
-- an unpaid pending registration that somehow lacks one). Payment verification
-- still calls assign_bib, which is idempotent — it returns the bib that was
-- already issued and never re-issues.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- assign_bib: issues the M|W + age category + sequence bib. Idempotent and
-- race-safe (locked row + unique index). No longer requires payment.
-- ---------------------------------------------------------------------------
create or replace function public.assign_bib(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg      public.registrations%rowtype;
  v_gender   text;
  v_min_age  integer;
  v_bib      text;
  v_attempts integer := 0;
begin
  select * into v_reg
  from public.registrations
  where id = p_registration_id
  for update;

  if not found then
    return null;
  end if;
  if v_reg.bib_number is not null then
    return v_reg.bib_number;
  end if;

  select p.gender into v_gender
  from public.athlete_profiles p
  where p.id = v_reg.athlete_profile_id;

  select c.min_age into v_min_age
  from public.championship_categories c
  where c.id = v_reg.category_id;

  loop
    v_attempts := v_attempts + 1;
    begin
      v_bib := public.generate_bib_number(
        v_reg.championship_id,
        coalesce(v_gender, 'male'),
        coalesce(v_min_age, 0)
      );

      update public.registrations
      set bib_number = v_bib
      where id = v_reg.id
        and bib_number is null
      returning bib_number into v_bib;

      if v_bib is not null then
        return v_bib;
      end if;

      -- A concurrent call won the race: return its bib.
      select bib_number into v_bib from public.registrations where id = v_reg.id;
      return v_bib;
    exception when unique_violation then
      if v_attempts >= 5 then raise; end if;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- create_registration: single-page rules.
--   * level-aware required fields (district for state level, state for national)
--   * per-athlete event cap
--   * registration_code = pre-payment reference (R######)
--   * bib_number issued immediately at registration (M/W + category + sequence)
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
  v_bib          text;
  v_repr         text;
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

  -- The "representing" answer depends on the championship level.
  v_repr := nullif(trim(coalesce(
    p_personal->>'representing',
    case when v_ch.level = 'state' then p_personal->>'district' else p_personal->>'state' end,
    ''
  )), '');

  -- ---- resolve athlete profile ---------------------------------------------
  if p_athlete_session_token is not null then
    select s.id into v_session_id
    from public.athlete_sessions s
    where s.token_hash = public.hash_secret(p_athlete_session_token)
      and s.revoked_at is null
      and s.expires_at > now();

    if not found then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'SESSION_EXPIRED', 'message', 'Your session has expired. Please verify again.'));
    end if;

    select * into v_profile
    from public.athlete_profiles p
    where p.id = (select athlete_profile_id from public.athlete_sessions where id = v_session_id)
    for update;
  else
    -- New athlete: basic fields are required, plus the level's representing
    -- field (district for a state-level meet, state for a national meet).
    if p_personal is null
       or nullif(trim(coalesce(p_personal->>'full_name', '')), '') is null
       or nullif(coalesce(p_personal->>'date_of_birth', ''), '') is null
       or nullif(coalesce(p_personal->>'gender', ''), '') is null
       or nullif(coalesce(p_personal->>'mobile_e164', ''), '') is null
       or (v_ch.level = 'state'
           and nullif(trim(coalesce(p_personal->>'district', '')), '') is null)
       or (v_ch.level = 'national'
           and nullif(trim(coalesce(p_personal->>'state', '')), '') is null) then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'MISSING_FIELDS', 'message', 'Please fill in all required details.'));
    end if;

    -- Duplicate protection: same mobile number + date of birth is the same
    -- person (this is also the identity check used when retrieving details,
    -- so no OTP is involved). Reuse the existing profile and its permanent
    -- Athlete ID instead of creating a duplicate.
    select * into v_profile
    from public.athlete_profiles p
    where p.mobile_e164 = p_personal->>'mobile_e164'
      and p.date_of_birth = (p_personal->>'date_of_birth')::date
    order by p.created_at
    limit 1
    for update;

    if found then
      v_new_profile := false;
    else
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
        nullif(trim(coalesce(p_personal->>'state', '')), ''),
        nullif(trim(coalesce(p_personal->>'district', '')), ''),
        nullif(trim(coalesce(p_personal->>'address', '')), ''),
        v_repr,
        nullif(trim(coalesce(p_personal->>'emergency_contact_name', '')), ''),
        nullif(trim(coalesce(p_personal->>'emergency_contact_phone', '')), '')
      ) returning * into v_profile;

      v_new_profile := true;
    end if;
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
      representing            = coalesce(v_repr, representing),
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

  -- ---- events --------------------------------------------------------------------
  v_event_ids := coalesce(p_event_ids, '{}');
  if array_length(v_event_ids, 1) is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'EVENTS_REQUIRED', 'message', 'Please select at least one event.'));
  end if;

  if v_ch.max_events_per_athlete is not null
     and coalesce(array_length(v_event_ids, 1), 0) > v_ch.max_events_per_athlete then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'TOO_MANY_EVENTS',
      'message', format('You may enter at most %s events in this championship.', v_ch.max_events_per_athlete)));
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
    -- athlete keeps the same reference and bib, and no duplicates are created.
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
    loop
      v_attempts := v_attempts + 1;
      begin
        v_code := public.generate_reference_code();
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

  -- Bib numbers are issued at registration time so organisers can print bibs
  -- and athletes see theirs immediately, even before payment. Idempotent.
  v_bib := public.assign_bib(v_reg.id);

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
    'bib_number', coalesce(v_bib, v_reg.bib_number),
    'fee_paise', v_reg.fee_paise,
    'currency', v_reg.currency,
    'athlete_id', v_profile.athlete_id,
    'profile_id', v_profile.id,
    'is_new_profile', v_new_profile
  );
end $$;

-- ---------------------------------------------------------------------------
-- Backfill: issue bibs for registrations created before this change.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select id from public.registrations
    where bib_number is null and status in ('pending', 'confirmed')
    order by registered_at
  loop
    perform public.assign_bib(r.id);
  end loop;
end $$;
