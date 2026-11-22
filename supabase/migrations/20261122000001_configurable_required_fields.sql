-- ---------------------------------------------------------------------------
-- Honour the organiser's per-field "Required" setting in create_registration_draft
--
-- The admin can now make gender, mobile, email, representing and events
-- optional. The draft RPC previously required gender, mobile and events (and
-- district/state for state/national meets) unconditionally, so an athlete who
-- left an optional field blank was rejected with "Please fill in all required
-- details" even though the form showed no * for it.
--
-- Full name and date of birth remain required: age categories and athlete
-- identity depend on them. Gender-less athletes are recorded as "other" by the
-- API and are not restricted to a gender-specific category or event.
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
  v_event_cats     uuid[];
  v_draft          public.registration_drafts%rowtype;
  v_max            int;
  v_app_no         text;
  v_df             jsonb;
  v_require_gender boolean;
  v_require_mobile boolean;
  v_require_rep    boolean;
  v_require_events boolean;
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

  -- Configurable required flags. A missing flag means "required" so existing
  -- championships keep their current behaviour.
  v_df := coalesce(v_ch.form_config -> 'default_fields', '{}'::jsonb);
  v_require_gender := coalesce((v_df -> 'gender' ->> 'required')::boolean, true);
  v_require_mobile := coalesce((v_df -> 'mobile' ->> 'required')::boolean, true);
  v_require_rep := coalesce((v_df -> 'representing' ->> 'required')::boolean, true);
  v_require_events := coalesce((v_df -> 'events' ->> 'required')::boolean, true);

  -- ---- required fields (level-aware) ----------------------------------------
  if p_personal is null
     or nullif(trim(coalesce(p_personal->>'full_name', '')), '') is null
     or nullif(coalesce(p_personal->>'date_of_birth', ''), '') is null
     or (v_require_gender and nullif(v_gender, '') is null)
     or (v_require_mobile and nullif(coalesce(p_personal->>'mobile_e164', ''), '') is null)
     -- A district meet needs only the common details; the academy/club is
     -- optional and becomes "Individual" in promote_draft.
     or (v_require_rep and v_ch.level = 'state'
         and nullif(trim(coalesce(p_personal->>'district', '')), '') is null)
     or (v_require_rep and v_ch.level = 'national'
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

  -- "other"/blank means gender was optional and not supplied: no restriction.
  if v_cat.gender <> 'any' and v_cat.gender <> v_gender and v_gender not in ('', 'other') then
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
  if v_require_events and array_length(v_event_ids, 1) is null then
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
    if v_event.gender <> 'any' and v_event.gender <> v_gender and v_gender not in ('', 'other') then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'EVENT_GENDER_NOT_ELIGIBLE',
        'message', format('The event "%s" is not open to your gender.', v_event.name)));
    end if;

    -- Prefer the list for the athlete's gender; fall back to the legacy shared
    -- list when neither gender-specific list has been configured. With no
    -- gender supplied, only the legacy shared list is used.
    if v_gender = 'male' then
      v_event_cats := v_event.male_category_ids;
    elsif v_gender = 'female' then
      v_event_cats := v_event.female_category_ids;
    else
      v_event_cats := null;
    end if;
    if v_event_cats is null then
      v_event_cats := v_event.category_ids;
    end if;

    if v_event_cats is not null
       and array_length(v_event_cats, 1) is not null
       and not (v_cat.id = any (v_event_cats)) then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'EVENT_CATEGORY_NOT_ELIGIBLE',
        'message', format('The event "%s" is not offered in the "%s" category.', v_event.name, v_cat.name)));
    end if;
    v_fee := v_fee + v_event.fee_paise;
  end loop;

  -- ---- already registered? ---------------------------------------------------
  -- With no mobile supplied, fall back to name + date of birth so duplicate
  -- detection still works without treating every blank number as the same
  -- athlete.
  if exists (
    select 1
    from public.registrations r
    join public.athlete_profiles p on p.id = r.athlete_profile_id
    where r.championship_id = p_championship_id
      and r.status in ('pending', 'confirmed')
      and (case
             when nullif(coalesce(p_personal->>'mobile_e164', ''), '') is not null
               then p.mobile_e164 = p_personal->>'mobile_e164'
             else p.full_name = trim(coalesce(p_personal->>'full_name', ''))
           end)
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
