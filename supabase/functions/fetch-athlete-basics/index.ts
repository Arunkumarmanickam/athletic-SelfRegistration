// Returns a small, fixed subset of a returning athlete's saved details so the
// registration form can pre-fill them.
//
// Deliberately minimal: only the Athlete ID is needed, and only name, date of
// birth, gender and mobile are returned. No session is issued and no
// registration history is exposed. An identical generic response is used for
// unknown IDs so IDs cannot be enumerated, and lookups are rate limited both
// per IP and per Athlete ID.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, readJson, str } from '../_shared/helpers.ts'

const GENERIC_FAILURE = 'We could not find your details. Please check your Athlete ID and try again.'

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const athleteId = str(body.athleteId).trim().toUpperCase()
    const supabase = serviceClient()
    const ip = clientIp(req)

    // An Athlete ID alone is enough to ask, so guessing must be expensive.
    await enforceRateLimit(supabase, `fetch-athlete-basics:ip:${ip}`, 20, 3600)

    if (!athleteId) {
      return errorJson(req, 'MISSING_FIELDS', 'Please enter your Athlete ID.', 400)
    }
    if (athleteId.length < 4 || athleteId.length > 40 || !/^[A-Z0-9-]+$/.test(athleteId)) {
      // Same wording as a failed lookup: do not reveal which IDs are well formed.
      return errorJson(req, 'NOT_FOUND', GENERIC_FAILURE, 400)
    }

    await enforceRateLimit(supabase, `fetch-athlete-basics:id:${athleteId}`, 5, 3600)

    const { data: profile, error } = await supabase
      .from('athlete_profiles')
      .select('athlete_id, full_name, date_of_birth, gender, mobile_country_code, mobile_number')
      .eq('athlete_id', athleteId)
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('fetch-athlete-basics lookup failed', error)
      return errorJson(req, 'SERVER_ERROR', 'We could not load your details. Please try again.', 500)
    }
    if (!profile) {
      return errorJson(req, 'NOT_FOUND', GENERIC_FAILURE, 400)
    }

    return json(req, {
      ok: true,
      athlete: {
        athlete_id: profile.athlete_id,
        full_name: profile.full_name,
        date_of_birth: profile.date_of_birth,
        gender: profile.gender,
        mobile_country_code: profile.mobile_country_code || '+91',
        mobile_number: profile.mobile_number || '',
      },
    })
  }),
)
