-- ---------------------------------------------------------------------------
-- 20261018000009_rename_categories_plus_style.sql
--
-- Masters-style category labels. The organiser wants the categories shown as
-- "30+", "35+", ... "95+", "100+" rather than "30-34", "35-39", ...
--
-- Only the displayed NAME changes: each "+" category still covers the same
-- 5-year window (30+ = 30-34, 35+ = 35-39, ... 95+ = 95-99, 100+ = 100 and
-- above). That keeps the automatic age -> category matching unchanged.
--
-- Idempotent: after the first run the old "NN-NN" names no longer exist, so a
-- second run updates nothing.
-- ---------------------------------------------------------------------------

update public.championship_categories c
set name = v.new_name,
    updated_at = now()
from public.championships ch
cross join (values
  ('30-34',  '30+'),
  ('35-39',  '35+'),
  ('40-44',  '40+'),
  ('45-49',  '45+'),
  ('50-54',  '50+'),
  ('55-59',  '55+'),
  ('60-64',  '60+'),
  ('65-69',  '65+'),
  ('70-74',  '70+'),
  ('75-79',  '75+'),
  ('80-84',  '80+'),
  ('85-89',  '85+'),
  ('90-94',  '90+'),
  ('95-99',  '95+'),
  ('100+',   '100+')
) as v(old_name, new_name)
where c.championship_id = ch.id
  and ch.slug = 'state-meet-2026'
  and c.name = v.old_name;
