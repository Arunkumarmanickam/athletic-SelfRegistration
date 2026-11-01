-- ---------------------------------------------------------------------------
-- Public organiser name
--
-- The client confirmed the exact association name on 1 November 2026. It is
-- shown in the home-page hero, footer, policy pages, and receipts. Keep the
-- existing contact/address fields intact.
-- ---------------------------------------------------------------------------

update public.app_settings
set value = jsonb_set(
      value,
      '{organizer_name}',
      to_jsonb('Coimbatore District Masters Athletic Association'::text),
      true
    ),
    updated_at = now()
where key = 'site';

-- Safety net for a database where the site row was removed.
insert into public.app_settings (key, value)
values (
  'site',
  jsonb_build_object(
    'organizer_name', 'Coimbatore District Masters Athletic Association',
    'support_email', '',
    'support_phone', '',
    'address', ''
  )
)
on conflict (key) do nothing;
