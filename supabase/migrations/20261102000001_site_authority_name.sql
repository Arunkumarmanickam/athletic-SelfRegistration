-- ---------------------------------------------------------------------------
-- Receipt authority name
--
-- Adds an `authority_name` field to the site settings, shown on receipts as
-- the "Authority Signatory". Defaults to the association name so existing
-- installs keep the same receipt they had before.
-- ---------------------------------------------------------------------------

update public.app_settings
set value = jsonb_set(
      value,
      '{authority_name}',
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
    'authority_name', 'Coimbatore District Masters Athletic Association',
    'support_email', '',
    'support_phone', '',
    'support_phones', '[]',
    'address', ''
  )
)
on conflict (key) do nothing;
