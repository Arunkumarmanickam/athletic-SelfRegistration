// Verifies a returning athlete using knowledge factors only — no OTP, no SMS.
//
// The athlete supplies their Athlete ID + date of birth (or registered mobile
// number + date of birth). When the details match a profile, a short-lived
// athlete session token is issued for viewing/editing the profile, uploading
// documents and retrying payment.
//
// Privacy rules:
//   * The failure response is identical whether or not the athlete exists,
//     so Athlete IDs cannot be probed.
//   * Nothing about the profile is returned before a successful match.
//   * Requests are rate limited per IP and per profile.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, readJson, str } from '../_shared/helpers.ts'
import { PROFILE_COLUMNS, issueAthleteSession } from '../_shared/athlete-session.ts'
import { normalizeMobile } from '../_shared/athlete-lookup.ts'
import type { AthleteProfileRow } from '../_shared/athlete-session.ts'

const GENERIC_FAILURE = 'The details you entered do not match a registered athlete. Please check them and try again.'

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const athleteId = str(body.athleteId).toUpperCase()
    const mobileE164 = normalizeMobile(str(body.mobileE164))
    const dateOfBirth = str(body.dateOfBirth)

    const supabase = serviceClient()
    const ip = clientIp(req)
    await enforceRateLimit(supabase, `verify-athlete:ip:${ip}`, 30, 3600)

    if (!dateOfBirth || (!athleteId && !mobileE164)) {
      return errorJson(
        req,
        'MISSING_FIELDS',
        'Please provide your date of birth, plus your Athlete ID or registered mobile number.',
        400,
      )
    }

    let query = supabase
      .from('athlete_profiles')
      .select(PROFILE_COLUMNS)
      .eq('date_of_birth', dateOfBirth)

    if (athleteId) {
      query = query.eq('athlete_id', athleteId)
    } else {
      query = query.eq('mobile_e164', mobileE164)
    }

    const { data: profile, error } = await query.limit(1).maybeSingle()

    if (error) {
      console.error('verify-athlete lookup failed', error)
      return errorJson(req, 'SERVER_ERROR', 'We could not verify your details. Please try again.', 500)
    }

    if (!profile) {
      // Same response whether the ID exists or not — nothing is revealed.
      return errorJson(req, 'VERIFICATION_FAILED', GENERIC_FAILURE, 400)
    }

    await enforceRateLimit(supabase, `verify-athlete:target:${(profile as AthleteProfileRow).id}`, 20, 3600)

    const session = await issueAthleteSession((profile as AthleteProfileRow).id, 60)
    if (!session) {
      return errorJson(req, 'SERVER_ERROR', 'We could not verify your details. Please try again.', 500)
    }

    return json(req, {
      ok: true,
      athlete_session_token: session.token,
      expires_at: session.expiresAt,
      message: 'Identity verified.',
    })
  }),
)
