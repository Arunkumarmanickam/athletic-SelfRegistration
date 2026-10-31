-- ---------------------------------------------------------------------------
-- Per-gender age eligibility for events
--
-- A championship event used to carry one shared `category_ids` list, so the
-- same age brackets applied to men and women. The organiser's programme has
-- different ranges per gender (for example 100m is open to men 30+ to 85+ but
-- women 30+ to 90+), which a single list cannot represent.
--
-- `male_category_ids` and `female_category_ids` are added alongside the old
-- column:
--
--   * null or empty  -> no restriction for that gender (all categories)
--   * non-empty      -> only those categories are eligible
--   * both null      -> fall back to the legacy `category_ids` list
--
-- The legacy column is intentionally kept so existing championships and the
-- standard defaults keep working unchanged.
-- ---------------------------------------------------------------------------

alter table public.championship_events
  add column if not exists male_category_ids uuid[],
  add column if not exists female_category_ids uuid[];

comment on column public.championship_events.male_category_ids is
  'Age categories open to men. Null/empty means every category. Null with a null female list falls back to category_ids.';
comment on column public.championship_events.female_category_ids is
  'Age categories open to women. Null/empty means every category. Null with a null male list falls back to category_ids.';

-- ---------------------------------------------------------------------------
-- create_registration_draft: enforce the gender-specific category list
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
     -- A district meet needs only the common details; the academy/club is
     -- optional and becomes "Individual" in promote_draft.
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

    -- Prefer the list for the athlete's gender; fall back to the legacy shared
    -- list when neither gender-specific list has been configured.
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

-- ---------------------------------------------------------------------------
-- state-meet-2026 programme
--
-- Applies the organiser's exact event list and per-gender age ranges to the
-- 44th Coimbatore District Masters Athletic Championship only. The standard
-- defaults and every other championship are left untouched.
-- ---------------------------------------------------------------------------
do $$
declare
  v_championship_id uuid;
begin
  select id into v_championship_id
  from public.championships
  where slug = 'state-meet-2026';

  if v_championship_id is null then
    raise notice 'state-meet-2026 not found; skipping event programme';
    return;
  end if;

  -- Add the two events that are new to the programme. Inactive extras keep
  -- their existing rows; they are only reordered below.
  insert into public.championship_events
    (championship_id, name, gender, fee_paise, is_active, sort_order)
  values
    (v_championship_id, '80m Hurdles', 'any', 0, true, 10),
    (v_championship_id, '300m Hurdles', 'any', 0, true, 12)
  on conflict (championship_id, name) do nothing;

  -- Rename the walk. The old name is not reused anywhere else.
  update public.championship_events
  set name = '5k Walking'
  where championship_id = v_championship_id
    and name = '5000m Race Walk';

  -- Event order and active flags for the final 22 rows (19 active + 3 extras).
  update public.championship_events e
  set sort_order = v.sort_order,
      is_active = v.is_active
  from (values
    ('100m', 1, true),
    ('200m', 2, true),
    ('400m', 3, true),
    ('800m', 4, true),
    ('1500m', 5, true),
    ('5000m', 6, true),
    ('5k Walking', 7, true),
    ('110m Hurdles', 8, true),
    ('100m Hurdles', 9, true),
    ('80m Hurdles', 10, true),
    ('400m Hurdles', 11, true),
    ('300m Hurdles', 12, true),
    ('Long Jump', 13, true),
    ('Triple Jump', 14, true),
    ('High Jump', 15, true),
    ('Shot Put', 16, true),
    ('Discus Throw', 17, true),
    ('Javelin Throw', 18, true),
    ('Hammer Throw', 19, true),
    ('3000m', 20, false),
    ('3000m Race Walk', 21, false),
    ('10000m', 22, false)
  ) as v(name, sort_order, is_active)
  where e.championship_id = v_championship_id and e.name = v.name;

  -- Per-gender age ranges. Range endpoints are the lower bound of the named
  -- bracket, so 30-85 includes 30+ through 85+ (30-34 ... 85-89).
  create temporary table if not exists _state_meet_ranges (
    event_name text primary key,
    men_from   int,
    men_to     int,
    women_from int,
    women_to   int
  ) on commit drop;

  insert into _state_meet_ranges (event_name, men_from, men_to, women_from, women_to) values
    ('100m',          30, 85, 30, 90),
    ('200m',          30, 85, 30, 80),
    ('400m',          30, 80, 30, 60),
    ('800m',          30, 80, 30, 60),
    ('1500m',         30, 80, 30, 60),
    ('5000m',         30, 80, 30, 60),
    ('5k Walking',    30, 80, 30, 60),
    ('110m Hurdles',  30, 45, null, null),
    ('100m Hurdles',  50, 65, 30, 35),
    ('80m Hurdles',   70, 75, 40, 60),
    ('400m Hurdles',  30, 55, 30, 45),
    ('300m Hurdles',  60, 75, 50, 65),
    ('Long Jump',     30, 85, 30, 80),
    ('Triple Jump',   30, 75, 30, 80),
    ('High Jump',     30, 75, 30, 80),
    ('Shot Put',      30, 85, 30, 80),
    ('Discus Throw',  30, 85, 30, 80),
    ('Javelin Throw', 30, 85, 30, 80),
    ('Hammer Throw',  30, 85, 30, 80);

  update public.championship_events e
  set male_category_ids = coalesce((
        select array_agg(c.id order by c.sort_order)
        from public.championship_categories c
        where c.championship_id = e.championship_id
          and c.is_active
          and c.name ~ '^[0-9]+\+$'
          and substring(c.name from '^([0-9]+)\+$')::int between r.men_from and r.men_to
      ), '{}'),
      female_category_ids = coalesce((
        select array_agg(c.id order by c.sort_order)
        from public.championship_categories c
        where c.championship_id = e.championship_id
          and c.is_active
          and c.name ~ '^[0-9]+\+$'
          and substring(c.name from '^([0-9]+)\+$')::int between r.women_from and r.women_to
      ), '{}')
  from _state_meet_ranges r
  where e.championship_id = v_championship_id and e.name = r.event_name;

  -- The three extras are not part of the programme. Leave them unrestricted so
  -- the organiser can simply tick Active later if they decide to run them.
  update public.championship_events
  set male_category_ids = null,
      female_category_ids = null
  where championship_id = v_championship_id
    and name in ('3000m', '3000m Race Walk', '10000m');
end $$;
