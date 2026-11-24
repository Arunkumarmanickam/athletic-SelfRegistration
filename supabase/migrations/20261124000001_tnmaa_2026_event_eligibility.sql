-- ---------------------------------------------------------------------------
-- 44th TNMAA Championship 2026 event programme
--
-- Applies the organiser's spreadsheet (44th_TNMAA_Championship_2026_Events.xlsx)
-- to the current championship only. The sheet uses separate women's and men's
-- age groups; these are stored in female_category_ids / male_category_ids and
-- enforced by create_registration_draft().
--
-- "All Age Groups" is stored as null (no restriction, including future
-- categories). Ranges are inclusive on both ends. "& above" uses 1000 as an
-- open-ended upper bound so the 100+ bracket is included.
-- ---------------------------------------------------------------------------

do $$
declare
  v_championship_id uuid;
begin
  select id into v_championship_id
  from public.championships
  where slug = 'state-meet-2026';

  if v_championship_id is null then
    raise notice 'state-meet-2026 not found; skipping event eligibility programme';
    return;
  end if;

  -- Normalise the renamed event first. If both spellings already exist the
  -- correctly-cased row is kept and the old one is deactivated below.
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

  create temporary table _tnmaa_event_rules (
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

  -- Events open to every active category for both genders.
  insert into _tnmaa_event_rules
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

  -- Inclusive range restrictions. 1000 means "and above".
  insert into _tnmaa_event_rules
    (event_name, gender, sort_order, men_from, men_to, women_from, women_to)
  values
    ('80m Hurdles', 'any', 7, 70, 95, 40, 75),
    ('300m Hurdles', 'any', 11, 60, 75, 50, 65),
    ('400m Hurdles', 'any', 12, 30, 55, 30, 45),
    ('200m Hurdles', 'any', 10, 80, 1000, 70, 1000);

  -- Women 30+ & 35+ only.
  insert into _tnmaa_event_rules
    (event_name, gender, sort_order, men_from, men_to, women_exact)
  values
    ('100m Hurdles', 'any', 8, 50, 65, '{30,35}'::integer[]);

  -- Men only; the women's column in the sheet is "--".
  insert into _tnmaa_event_rules
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
  from _tnmaa_event_rules r
  on conflict (championship_id, name) do update
  set gender              = excluded.gender,
      is_active           = true,
      sort_order          = excluded.sort_order,
      category_ids        = null,
      male_category_ids   = excluded.male_category_ids,
      female_category_ids = excluded.female_category_ids,
      updated_at          = now();

  -- Anything not in the organiser's programme stays as a row (so history is
  -- intact) but is no longer selectable and has no stale eligibility lists.
  update public.championship_events e
     set is_active           = false,
         category_ids        = null,
         male_category_ids   = null,
         female_category_ids = null,
         updated_at          = now()
   where e.championship_id = v_championship_id
     and not exists (
       select 1
       from _tnmaa_event_rules r
       where r.event_name = e.name
     );
end $$;
