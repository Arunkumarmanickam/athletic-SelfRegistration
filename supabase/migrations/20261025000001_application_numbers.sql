-- ---------------------------------------------------------------------------
-- Application numbers for pre-payment tracking
--
-- Issue an Application Number at draft creation time so athletes can track
-- payment status even if the payment is still processing and no confirmed
-- registration/bib exists yet. Application numbers are separate from
-- Registration Numbers and Bib Numbers (all different sequences).
-- ---------------------------------------------------------------------------

create sequence if not exists public.application_number_seq;

alter table public.registration_drafts
  add column if not exists application_number text;

-- Backfill existing drafts (should be none in normal flow, but safe)
do $$
begin
  update public.registration_drafts
     set application_number = 'APP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.application_number_seq')::text, 6, '0')
   where application_number is null;
end $$;

alter table public.registration_drafts
  alter column application_number set not null;

create unique index if not exists registration_drafts_application_number_key
  on public.registration_drafts (application_number);

-- ---------------------------------------------------------------------------
-- Update create_registration_draft to generate application number
-- ---------------------------------------------------------------------------
create or replace function public.create_registration_draft(
  p_championship_id uuid,
  p_personal        jsonb,
  p_category_id     uuid,
  p_event_ids       uuid[],
  p_request_ip      text default null,
  p_token_hash      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch             public.championships%rowtype;
  v_cat            public.championship_categories%rowtype;
  v_event          public.championship_events%rowtype;
  v_cutoff         date;
  v_age            int;
  v_fee            bigint;
  v_gender         text;
  v_event_ids      uuid[];
  v_event_id       uuid;
  v_draft          public.registration_drafts%rowtype;
  v_max            int;
  v_app_no         text;
begin
  v_gender := lower(coalesce(p_personal->>'gender', ''));

  -- ---- championship ---------------------------------------------------------
  select * into v_ch from public.championships where id = p_championship_id;
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

  -- ---- required fields (level-aware) ----------------------------------------
  if p_personal is null
     or nullif(trim(coalesce(p_personal->>'full_name', '')), '') is null
     or nullif(coalesce(p_personal->>'date_of_birth', ''), '') is null
     or nullif(v_gender, '') is null
     or nullif(coalesce(p_personal->>'mobile_e164', ''), '') is null
     or (v_ch.level = 'state'
         and nullif(trim(coalesce(p_personal->>'district', '')), '') is null)
     or (v_ch.level = 'national'
         and nullif(trim(coalesce(p_personal->>'state', '')), '') is null) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'MISSING_FIELDS', 'message', 'Please fill in all required details.'));
  end if;

  -- ---- category -------------------------------------------------------------
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

  if v_cat.gender <> 'any' and v_cat.gender <> v_gender then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'GENDER_NOT_ELIGIBLE', 'message', 'The selected category is not open to your gender.'));
  end if;

  if coalesce(v_ch.form_config->>'age_calculation_mode', 'championship_start') = 'fixed'
     and nullif(coalesce(v_ch.form_config->>'age_calculation_date', ''), '') is not null then
    v_cutoff := (v_ch.form_config->>'age_calculation_date')::date;
  else
    v_cutoff := coalesce(v_ch.starts_on, current_date);
  end if;

  v_age := public.age_on((p_personal->>'date_of_birth')::date, v_cutoff);
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

  v_max := v_ch.max_events_per_athlete;
  if v_max is not null and coalesce(array_length(v_event_ids, 1), 0) > v_max then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'TOO_MANY_EVENTS',
      'message', format('You may enter at most %s events in this championship.', v_max)));
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
    if v_event.gender <> 'any' and v_event.gender <> v_gender then
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

  -- ---- already registered? ---------------------------------------------------
  if exists (
    select 1
    from public.registrations r
    join public.athlete_profiles p on p.id = r.athlete_profile_id
    where r.championship_id = p_championship_id
      and r.status in ('pending', 'confirmed')
      and p.mobile_e164 = p_personal->>'mobile_e164'
      and p.date_of_birth = (p_personal->>'date_of_birth')::date
      and (r.status = 'confirmed' or r.payment_status = 'paid')
  ) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'ALREADY_REGISTERED',
      'message', 'You are already registered for this championship.'));
  end if;

  if p_token_hash is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'MISSING_TOKEN', 'message', 'The registration could not be started. Please try again.'));
  end if;

  v_app_no := 'APP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.application_number_seq')::text, 6, '0');

  insert into public.registration_drafts (
    token_hash, championship_id, category_id, category_name,
    personal, event_ids, fee_paise, currency, request_ip, application_number
  ) values (
    p_token_hash,
    p_championship_id, v_cat.id, v_cat.name,
    p_personal, v_event_ids, v_fee::int, v_ch.currency, p_request_ip, v_app_no
  ) returning * into v_draft;

  return jsonb_build_object(
    'ok', true,
    'draft_id', v_draft.id,
    'application_number', v_draft.application_number,
    'fee_paise', v_draft.fee_paise,
    'currency', v_draft.currency,
    'category_name', v_draft.category_name,
    'expires_at', v_draft.expires_at
  );
end $$;

revoke execute on function public.create_registration_draft(uuid, jsonb, uuid, uuid[], text, text)
  from public, anon, authenticated;
grant execute on function public.create_registration_draft(uuid, jsonb, uuid, uuid[], text, text)
  to service_role;

-- Also carry application number in promote_draft response if available
create or replace function public.promote_draft(p_draft_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft        public.registration_drafts%rowtype;
  v_profile      public.athlete_profiles%rowtype;
  v_cat          public.championship_categories%rowtype;
  v_event        public.championship_events%rowtype;
  v_reg          public.registrations%rowtype;
  v_code         text;
  v_bib          text;
  v_repr         text;
  v_event_id     uuid;
  v_attempts     int := 0;
  v_new_profile  boolean := false;
  v_app_no       text;
begin
  select * into v_draft
  from public.registration_drafts
  where id = p_draft_id
  for update;

  if not found then
    select * into v_reg
    from public.registrations r
    where r.draft_id = p_draft_id
    limit 1;
    if found then
      return jsonb_build_object(
        'ok', true, 'already_promoted', true,
        'registration_id', v_reg.id,
        'registration_code', v_reg.registration_code,
        'bib_number', v_reg.bib_number,
        'fee_paise', v_reg.fee_paise,
        'currency', v_reg.currency
      );
    end if;

    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'DRAFT_NOT_FOUND', 'message', 'This registration draft no longer exists.'));
  end if;

  v_app_no := v_draft.application_number;

  select * into v_cat from public.championship_categories where id = v_draft.category_id;

  v_repr := nullif(trim(coalesce(
    v_draft.personal->>'representing',
    case when (select level from public.championships where id = v_draft.championship_id) = 'state'
         then v_draft.personal->>'district'
         else v_draft.personal->>'state' end,
    ''
  )), '');

  select * into v_profile
  from public.athlete_profiles p
  where p.mobile_e164 = v_draft.personal->>'mobile_e164'
    and p.date_of_birth = (v_draft.personal->>'date_of_birth')::date
  order by p.created_at
  limit 1
  for update;

  if found then
    v_new_profile := false;
    update public.athlete_profiles set
      full_name               = coalesce(nullif(trim(coalesce(v_draft.personal->>'full_name', '')), ''), full_name),
      gender                  = coalesce(nullif(coalesce(v_draft.personal->>'gender', ''), ''), gender),
      mobile_country_code     = coalesce(nullif(coalesce(v_draft.personal->>'mobile_country_code', ''), ''), mobile_country_code),
      mobile_number           = coalesce(nullif(coalesce(v_draft.personal->>'mobile_number', ''), ''), mobile_number),
      email                   = coalesce(nullif(trim(coalesce(v_draft.personal->>'email', '')), ''), email),
      state                   = coalesce(nullif(trim(coalesce(v_draft.personal->>'state', '')), ''), state),
      district                = coalesce(nullif(trim(coalesce(v_draft.personal->>'district', '')), ''), district),
      address                 = coalesce(nullif(trim(coalesce(v_draft.personal->>'address', '')), ''), address),
      representing            = coalesce(v_repr, representing),
      emergency_contact_name  = coalesce(nullif(trim(coalesce(v_draft.personal->>'emergency_contact_name', '')), ''), emergency_contact_name),
      emergency_contact_phone = coalesce(nullif(trim(coalesce(v_draft.personal->>'emergency_contact_phone', '')), ''), emergency_contact_phone),
      updated_at              = now()
    where id = v_profile.id
    returning * into v_profile;
  else
    insert into public.athlete_profiles (
      athlete_id, full_name, date_of_birth, gender,
      mobile_country_code, mobile_number, mobile_e164, email,
      state, district, address, representing,
      emergency_contact_name, emergency_contact_phone
    ) values (
      public.generate_athlete_id(),
      trim(v_draft.personal->>'full_name'),
      (v_draft.personal->>'date_of_birth')::date,
      v_draft.personal->>'gender',
      coalesce(v_draft.personal->>'mobile_country_code', '+91'),
      v_draft.personal->>'mobile_number',
      v_draft.personal->>'mobile_e164',
      nullif(trim(coalesce(v_draft.personal->>'email', '')), ''),
      nullif(trim(coalesce(v_draft.personal->>'state', '')), ''),
      nullif(trim(coalesce(v_draft.personal->>'district', '')), ''),
      nullif(trim(coalesce(v_draft.personal->>'address', '')), ''),
      v_repr,
      nullif(trim(coalesce(v_draft.personal->>'emergency_contact_name', '')), ''),
      nullif(trim(coalesce(v_draft.personal->>'emergency_contact_phone', '')), '')
    ) returning * into v_profile;
    v_new_profile := true;
  end if;

  loop
    v_attempts := v_attempts + 1;
    begin
      v_code := public.generate_reference_code();
      insert into public.registrations (
        registration_code, athlete_profile_id, championship_id,
        category_id, category_name, fee_paise, currency,
        form_snapshot, request_ip, draft_id,
        status, payment_status, confirmed_at, aadhaar_verified_at
      ) values (
        v_code, v_profile.id, v_draft.championship_id,
        v_draft.category_id, v_draft.category_name, v_draft.fee_paise, v_draft.currency,
        v_draft.personal, v_draft.request_ip, v_draft.id,
        'confirmed', 'paid', now(), v_draft.aadhaar_verified_at
      ) returning * into v_reg;
      exit;
    exception when unique_violation then
      if v_attempts >= 5 then raise; end if;
    end;
  end loop;

  foreach v_event_id in array v_draft.event_ids loop
    select * into v_event from public.championship_events where id = v_event_id;
    insert into public.registration_events (registration_id, event_id, event_name, fee_paise)
    values (v_reg.id, v_event.id, v_event.name, v_event.fee_paise)
    on conflict (registration_id, event_id) do nothing;
  end loop;

  v_bib := public.assign_bib(v_reg.id);

  update public.registrations
  set bib_number = coalesce(bib_number, v_bib)
  where id = v_reg.id
  returning * into v_reg;

  update public.payment_orders
  set status = 'captured', updated_at = now()
  where draft_id = v_draft.id and status in ('created', 'authorized');

  delete from public.registration_drafts where id = v_draft.id;

  return jsonb_build_object(
    'ok', true,
    'already_promoted', false,
    'application_number', v_app_no,
    'registration_id', v_reg.id,
    'registration_code', v_reg.registration_code,
    'bib_number', v_reg.bib_number,
    'athlete_id', v_profile.athlete_id,
    'profile_id', v_profile.id,
    'is_new_profile', v_new_profile,
    'fee_paise', v_reg.fee_paise,
    'currency', v_reg.currency
  );
end $$;

revoke execute on function public.promote_draft(uuid) from public, anon, authenticated;
grant execute on function public.promote_draft(uuid) to service_role;
