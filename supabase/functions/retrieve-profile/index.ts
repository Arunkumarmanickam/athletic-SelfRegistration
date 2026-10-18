// Returns the verified athlete's saved profile and their registration history.
// Requires a valid athlete session token (issued only after OTP verification),
// so an Athlete ID alone can never expose personal details.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, readJson, sessionToken } from '../_shared/helpers.ts'
import { resolveAthleteSession } from '../_shared/athlete-session.ts'

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const token = sessionToken(req, body)

    const supabase = serviceClient()
    await enforceRateLimit(supabase, `retrieve-profile:${clientIp(req)}`, 60, 3600)

    if (!token) {
      return errorJson(req, 'UNAUTHORIZED', 'Please verify your identity before viewing saved details.', 401)
    }

    const context = await resolveAthleteSession(token)
    if (!context) {
      return errorJson(
        req,
        'SESSION_EXPIRED',
        'Your verification session has expired. Please verify again with a new one-time password.',
        401,
      )
    }

    const { data: registrations, error } = await supabase
      .from('registrations')
      .select(
        `id, registration_code, status, payment_status, fee_paise, currency, registered_at, confirmed_at,
         championship_id,
         championships (id, name, slug, starts_on, ends_on, location),
         championship_categories (name),
         registration_events (event_name)`,
      )
      .eq('athlete_profile_id', context.profile.id)
      .order('registered_at', { ascending: false })

    if (error) {
      console.error('registration history query failed', error)
      return errorJson(req, 'SERVER_ERROR', 'Could not load your registrations.', 500)
    }

    return json(req, {
      profile: context.profile,
      registrations: registrations ?? [],
    })
  }),
)
