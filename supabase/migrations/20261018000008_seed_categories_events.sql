-- ---------------------------------------------------------------------------
-- 20261018000008_seed_categories_events.sql
--
-- Makes the "44th Coimbatore District Masters Athletic Championship -2026"
-- (slug: state-meet-2026) usable for the single-page registration form:
--
--   * opens the registration window (it was set to a future date)
--   * seeds the masters age ladder 30+ ... 100+ in 5-year brackets, open to
--     both Men and Women (the form auto-matches a category from the athlete's
--     date of birth, gender and the age cutoff)
--   * seeds the 22 track & field events from the organiser's list
--
-- Event / category fees default to 0, so the payable total is just the
-- championship base fee. Any fee, name or restriction can be edited later in
-- the admin UI.
--
-- Idempotent: re-running only fills in rows that do not exist yet, matched on
-- the unique (championship_id, name) constraints.
-- ---------------------------------------------------------------------------

-- ---- open the registration window -----------------------------------------
update public.championships
set registration_opens_at = least(coalesce(registration_opens_at, now()), now()),
    updated_at = now()
where slug = 'state-meet-2026'
  and (registration_opens_at is null or registration_opens_at > now());

-- ---- age categories: 30-34 ... 100+ (per 5 years), open to all genders -----
with target as (
  select id from public.championships where slug = 'state-meet-2026'
)
insert into public.championship_categories (
  championship_id, name, gender, min_age, max_age, fee_paise, is_active, sort_order
)
select t.id, v.name, 'any', v.min_age, v.max_age, 0, true, v.sort_order
from target t
cross join (values
  ('30-34',   30,  34,  1),
  ('35-39',   35,  39,  2),
  ('40-44',   40,  44,  3),
  ('45-49',   45,  49,  4),
  ('50-54',   50,  54,  5),
  ('55-59',   55,  59,  6),
  ('60-64',   60,  64,  7),
  ('65-69',   65,  69,  8),
  ('70-74',   70,  74,  9),
  ('75-79',   75,  79, 10),
  ('80-84',   80,  84, 11),
  ('85-89',   85,  89, 12),
  ('90-94',   90,  94, 13),
  ('95-99',   95,  99, 14),
  ('100+',   100, 110, 15)
) as v(name, min_age, max_age, sort_order)
on conflict (championship_id, name) do nothing;

-- ---- events: 22 disciplines ------------------------------------------------
-- Hurdles are gender-specific by convention (110m = Men, 100m = Women);
-- every other event is open to both and shows for the athlete's own gender.
with target as (
  select id from public.championships where slug = 'state-meet-2026'
)
insert into public.championship_events (
  championship_id, name, gender, category_ids, fee_paise, is_active, sort_order
)
select t.id, v.name, v.gender, null, 0, true, v.sort_order
from target t
cross join (values
  ('100m',            'any',    1),
  ('200m',            'any',    2),
  ('400m',            'any',    3),
  ('800m',            'any',    4),
  ('1500m',           'any',    5),
  ('3000m',           'any',    6),
  ('3000m Race Walk', 'any',    7),
  ('5000m',           'any',    8),
  ('5000m Race Walk', 'any',    9),
  ('10000m',          'any',   10),
  ('110m Hurdles',    'male',  11),
  ('100m Hurdles',    'female',12),
  ('400m Hurdles',    'any',   13),
  ('4x100m Relay',    'any',   14),
  ('4x400m Relay',    'any',   15),
  ('Discus Throw',    'any',   16),
  ('Hammer Throw',    'any',   17),
  ('High Jump',       'any',   18),
  ('Javelin Throw',   'any',   19),
  ('Long Jump',       'any',   20),
  ('Shot Put',        'any',   21),
  ('Triple Jump',     'any',   22)
) as v(name, gender, sort_order)
on conflict (championship_id, name) do nothing;
