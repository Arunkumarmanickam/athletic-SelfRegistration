// Public configuration endpoint.
// Returns only non-sensitive data: site/organizer settings and the details of
// championships that are currently open for registration.
import { handler } from '../_shared/handler.ts'
import { json } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit } from '../_shared/helpers.ts'

Deno.serve(
  handler(async (req) => {
    const supabase = serviceClient()
    await enforceRateLimit(supabase, `public-config:${clientIp(req)}`, 120, 60)

    const [{ data: settingsRows }, { data: championships, error }] = await Promise.all([
      supabase.from('app_settings').select('key, value'),
      supabase
        .from('championships')
        .select(
          // PostgREST rejects newline characters inside `select` (PGRST100), so this must stay on one line.
          'id, slug, name, description, location, starts_on, ends_on, registration_opens_at, registration_closes_at, status, currency, base_fee_paise, terms_text, form_config, championship_categories (id, name, gender, min_age, max_age, fee_paise, is_active, sort_order), championship_events (id, name, gender, category_ids, fee_paise, is_active, sort_order)',
        )
        .eq('status', 'open')
        .order('starts_on', { ascending: true }),
    ])

    if (error) {
      console.error('public-config query failed', error)
      return json(req, { error: { code: 'SERVER_ERROR', message: 'Could not load championship information.' } }, 500)
    }

    const settings: Record<string, unknown> = {}
    for (const row of settingsRows ?? []) settings[row.key as string] = row.value

    const openChampionships = (championships ?? []).map((c) => ({
      ...c,
      championship_categories: (c.championship_categories ?? [])
        .filter((cat) => cat.is_active)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
      championship_events: (c.championship_events ?? [])
        .filter((e) => e.is_active)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    }))

    return json(req, {
      site: settings.site ?? {},
      athlete_id_format: settings.athlete_id_format ?? null,
      payments_configured: Boolean(Deno.env.get('RAZORPAY_KEY_ID') && Deno.env.get('RAZORPAY_KEY_SECRET')),
      championships: openChampionships,
    })
  }),
)
