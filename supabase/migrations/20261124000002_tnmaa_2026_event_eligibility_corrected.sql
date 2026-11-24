-- ---------------------------------------------------------------------------
-- Correction for 20261124000001_tnmaa_2026_event_eligibility.sql
--
-- That migration used the closed district championship slug `state-meet-2026`
-- instead of the live TNMAA slug `tnmaa-state-meet-2026`. This migration:
--
--   1. restores `state-meet-2026` to the programme defined by
--      20261101000001_event_gender_categories.sql, and
--   2. applies the organiser's spreadsheet to `tnmaa-state-meet-2026`.
--
-- The two championships are handled independently; no defaults or other
-- championships are touched.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Restore the closed district championship (state-meet-2026)
-- ---------------------------------------------------------------------------
do $$
declare
  v_championship_id uuid;
begin
  select id into v_championship_id
  from public.championships
  where slug = 'state-meet-2026';

  if v_championship_id is null then
    raise notice 'state-meet-2026 not found; skipping district restore';
    return;
  end if;

  -- These rows were introduced by the wrong-slug migration and are not part
  -- of the district programme. None has registrations; the guard keeps this
  -- safe if that ever changes.
  delete from public.championship_events e
   where e.championship_id = v_championship_id
     and e.name in ('200m Hurdles', '5000m Race Walk', 'Pole Vault')
     and not exists (
       select 1
       from public.registration_events re
       where re.event_id = e.id
          or re.event_name = e.name
     );

  create temporary table _district_rules (
    event_name   text primary key,
    sort_order   integer not null,
    is_active    boolean not null,
    gender       text,
    men_from     integer,
    men_to       integer,
    women_from   integer,
    women_to     integer,
    unrestricted boolean not null default false,
    women_empty  boolean not null default false
  ) on commit drop;

  insert into _district_rules
    (event_name, sort_order, is_active, gender, men_from, men_to, women_from, women_to, unrestricted, women_empty)
  values
    ('100m',              1, true, null, 30, 85, 30, 90, false, false),
    ('200m',              2, true, null, 30, 85, 30, 80, false, false),
    ('400m',              3, true, null, 30, 80, 30, 60, false, false),
    ('800m',              4, true, null, 30, 80, 30, 60, false, false),
    ('1500m',             5, true, null, 30, 80, 30, 60, false, false),
    ('5000m',             6, true, null, 30, 80, 30, 60, false, false),
    ('5k Walking',        7, true, null, 30, 80, 30, 60, false, false),
    ('110m Hurdles',      8, true, 'male', 30, 45, null, null, false, true),
    ('100m Hurdles',      9, true, null, 50, 65, 30, 35, false, false),
    ('80m Hurdles',      10, true, null, 70, 75, 40, 60, false, false),
    ('400m Hurdles',     11, true, null, 30, 55, 30, 45, false, false),
    ('300m Hurdles',     12, true, null, 60, 75, 50, 65, false, false),
    ('Long Jump',        13, true, null, 30, 85, 30, 80, false, false),
    ('Triple Jump',      14, true, null, 30, 75, 30, 80, false, false),
    ('High Jump',        15, true, null, 30, 75, 30, 80, false, false),
    ('Shot Put',         16, true, null, 30, 85, 30, 80, false, false),
    ('Discus Throw',     17, true, null, 30, 85, 30, 80, false, false),
    ('Javelin Throw',    18, true, null, 30, 85, 30, 80, false, false),
    ('Hammer Throw',     19, true, null, 30, 85, 30, 80, false, false),
    ('3000m',            20, false, null, null, null, null, null, true, false),
    ('3000m Race Walk',  21, false, null, null, null, null, null, true, false),
    ('10000m',           22, false, null, null, null, null, null, true, false);

  insert into public.championship_events (
    championship_id, name, gender, fee_paise, is_active, sort_order,
    category_ids, male_category_ids, female_category_ids
  )
  select
    v_championship_id,
    r.event_name,
    coalesce(r.gender, 'any'),
    0,
    r.is_active,
    r.sort_order,
    null::uuid[],
    case
      when r.unrestricted then null
      else coalesce((
        select array_agg(c.id order by c.min_age)
        from public.championship_categories c
        where c.championship_id = v_championship_id
          and c.is_active
          and c.min_age between r.men_from and r.men_to
      ), '{}'::uuid[])
    end,
    case
      when r.unrestricted then null
      when r.women_empty then '{}'::uuid[]
      else coalesce((
        select array_agg(c.id order by c.min_age)
        from public.championship_categories c
        where c.championship_id = v_championship_id
          and c.is_active
          and c.min_age between r.women_from and r.women_to
      ), '{}'::uuid[])
    end
  from _district_rules r
  on conflict (championship_id, name) do update
  set is_active           = excluded.is_active,
      sort_order          = excluded.sort_order,
      category_ids        = null,
      male_category_ids   = excluded.male_category_ids,
      female_category_ids = excluded.female_category_ids,
      updated_at          = now();

  update public.championship_events e
     set is_active           = false,
         category_ids        = null,
         male_category_ids   = null,
         female_category_ids = null,
         updated_at          = now()
   where e.championship_id = v_championship_id
     and not exists (
       select 1
       from _district_rules r
       where r.event_name = e.name
     );
end $$;

-- ---------------------------------------------------------------------------
-- 2. Apply the 44th TNMAA Championship 2026 programme (correct slug)
-- ---------------------------------------------------------------------------
do $$
declare
  v_championship_id uuid;
begin
  select id into v_championship_id
  from public.championships
  where slug = 'tnmaa-state-meet-2026';

  if v_championship_id is null then
    raise notice 'tnmaa-state-meet-2026 not found; skipping TNMAA event programme';
    return;
  end if;

  update public.championship_events
     set name = 'Pole Vault',
         updated_at = now()
   where championship_id = v_championship_id
     and name = 'Pole vault'
     and not exists (
       select 1
       from public.championship_events
       where championship_id = v_championship_id
         and name = 'Pole Vault'
     );

  create temporary table _tnmaa_event_rules_corrected (
    event_name         text primary key,
    gender             text not null,
    sort_order         integer not null,
    men_unrestricted   boolean not null default false,
    women_unrestricted boolean not null default false,
    men_from           integer,
    men_to             integer,
    women_from         integer,
    women_to           integer,
    men_exact          integer[],
    women_exact        integer[],
    women_none         boolean not null default false
  ) on commit drop;

  insert into _tnmaa_event_rules_corrected
    (event_name, gender, sort_order, men_unrestricted, women_unrestricted)
  values
    ('100m', 'any', 1, true, true),
    ('200m', 'any', 2, true, true),
    ('400m', 'any', 3, true, true),
    ('800m', 'any', 4, true, true),
    ('1500m', 'any', 5, true, true),
    ('5000m', 'any', 6, true, true),
    ('5000m Race Walk', 'any', 13, true, true),
    ('High Jump', 'any', 14, true, true),
    ('Long Jump', 'any', 15, true, true),
    ('Triple Jump', 'any', 16, true, true),
    ('Pole Vault', 'any', 17, true, true),
    ('Shot Put', 'any', 18, true, true),
    ('Discus Throw', 'any', 19, true, true),
    ('Javelin Throw', 'any', 20, true, true),
    ('Hammer Throw', 'any', 21, true, true);

  insert into _tnmaa_event_rules_corrected
    (event_name, gender, sort_order, men_from, men_to, women_from, women_to)
  values
    ('80m Hurdles', 'any', 7, 70, 95, 40, 75),
    ('300m Hurdles', 'any', 11, 60, 75, 50, 65),
    ('400m Hurdles', 'any', 12, 30, 55, 30, 45),
    ('200m Hurdles', 'any', 10, 80, 1000, 70, 1000);

  insert into _tnmaa_event_rules_corrected
    (event_name, gender, sort_order, men_from, men_to, women_exact)
  values
    ('100m Hurdles', 'any', 8, 50, 65, '{30,35}'::integer[]);

  insert into _tnmaa_event_rules_corrected
    (event_name, gender, sort_order, men_from, men_to, women_none)
  values
    ('110m Hurdles', 'male', 9, 30, 45, true);

  insert into public.championship_events (
    championship_id, name, gender, fee_paise, is_active, sort_order,
    category_ids, male_category_ids, female_category_ids
  )
  select
    v_championship_id,
    r.event_name,
    r.gender,
    0,
    true,
    r.sort_order,
    null::uuid[],
    case
      when r.men_unrestricted then null
      else coalesce((
        select array_agg(c.id order by c.min_age)
        from public.championship_categories c
        where c.championship_id = v_championship_id
          and c.is_active
          and (
            case
              when r.men_exact is not null then c.min_age = any (r.men_exact)
              else c.min_age >= r.men_from and c.min_age <= r.men_to
            end
          )
      ), '{}'::uuid[])
    end,
    case
      when r.women_unrestricted or r.women_none then null
      else coalesce((
        select array_agg(c.id order by c.min_age)
        from public.championship_categories c
        where c.championship_id = v_championship_id
          and c.is_active
          and (
            case
              when r.women_exact is not null then c.min_age = any (r.women_exact)
              else c.min_age >= r.women_from and c.min_age <= r.women_to
            end
          )
      ), '{}'::uuid[])
    end
  from _tnmaa_event_rules_corrected r
  on conflict (championship_id, name) do update
  set gender              = excluded.gender,
      is_active           = true,
      sort_order          = excluded.sort_order,
      category_ids        = null,
      male_category_ids   = excluded.male_category_ids,
      female_category_ids = excluded.female_category_ids,
      updated_at          = now();

  update public.championship_events e
     set is_active           = false,
         category_ids        = null,
         male_category_ids   = null,
         female_category_ids = null,
         updated_at          = now()
   where e.championship_id = v_championship_id
     and not exists (
       select 1
       from _tnmaa_event_rules_corrected r
       where r.event_name = e.name
     );
end $$;
