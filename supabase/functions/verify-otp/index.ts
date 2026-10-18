// Verifies a one-time password and issues a short-lived athlete session token.
// OTP codes are stored only as SHA-256 hashes; brute-force attempts are capped
// per challenge and rate limited per IP.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, randomToken, readJson, str } from '../_shared/helpers.ts'
import { findProfileForOtp, normalizeMobile } from '../_shared/athlete-lookup.ts'

const GENERIC_FAILURE = 'The one-time password is invalid or has expired. Please request a new one.'

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const athleteId = str(body.athleteId).toUpperCase()
    const mobileE164 = normalizeMobile(str(body.mobileE164))
    const dateOfBirth = str(body.dateOfBirth)
    const otp = str(body.otp)
    const purpose = str(body.purpose) === 'profile_match' ? 'profile_match' : 'profile_lookup'

    const supabase = serviceClient()
    const ip = clientIp(req)
    await enforceRateLimit(supabase, `otp-verify:ip:${ip}`, 40, 3600)

    if (!/^\d{4,8}$/.test(otp)) return errorJson(req, 'OTP_INVALID', GENERIC_FAILURE, 400)

    const profile = await findProfileForOtp(supabase, { athleteId, mobileE164, dateOfBirth })
    if (!profile) return errorJson(req, 'OTP_INVALID', GENERIC_FAILURE, 400)

    const { data: challenge } = await supabase
      .from('otp_challenges')
      .select('id, code_hash, attempts, max_attempts, expires_at')
      .eq('athlete_profile_id', profile.id)
      .eq('purpose', purpose)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!challenge) return errorJson(req, 'OTP_INVALID', GENERIC_FAILURE, 400)

    if (Number(challenge.attempts) >= Number(challenge.max_attempts)) {
      // Lock the challenge; a new OTP must be requested.
      await supabase
        .from('otp_challenges')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', challenge.id)
      return errorJson(
        req,
        'OTP_INVALID',
        'Too many incorrect attempts. Please request a new one-time password.',
        400,
      )
    }

    const { data: candidateHash } = await supabase.rpc('hash_secret', { p_value: otp })

    if (!candidateHash || candidateHash !== challenge.code_hash) {
      await supabase
        .from('otp_challenges')
        .update({ attempts: Number(challenge.attempts) + 1 })
        .eq('id', challenge.id)
      return errorJson(req, 'OTP_INVALID', GENERIC_FAILURE, 400)
    }

    const now = new Date().toISOString()
    await supabase.from('otp_challenges').update({ consumed_at: now }).eq('id', challenge.id)

    // Short-lived session used for the remaining registration / retrieval steps.
    const token = randomToken(32)
    const tokenHash = (await supabase.rpc('hash_secret', { p_value: token })).data as string
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

    const { error: sessionError } = await supabase.from('athlete_sessions').insert({
      athlete_profile_id: profile.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    })

    if (sessionError) {
      console.error('session insert failed', sessionError)
      return errorJson(req, 'SERVER_ERROR', 'Could not complete verification. Please try again.', 500)
    }

    return json(req, {
      ok: true,
      athlete_session_token: token,
      expires_at: expiresAt,
      message: 'Verification successful.',
    })
  }),
)
