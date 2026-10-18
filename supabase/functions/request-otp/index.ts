// Requests a one-time password for a returning athlete.
//
// Privacy rules implemented here:
//   * The response is IDENTICAL whether or not the athlete exists.
//   * Nothing about the profile (name, masked mobile, ...) is ever returned.
//   * Requests are rate limited per IP and per athlete.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, randomDigits, readJson, str } from '../_shared/helpers.ts'
import { isLocalhostOrigin } from '../_shared/cors.ts'
import { findProfileForOtp, normalizeMobile } from '../_shared/athlete-lookup.ts'
import { sendSms, smsProvider } from '../_shared/notify.ts'

const GENERIC_MESSAGE =
  'If those details match a registered athlete, a one-time password has been sent to the registered mobile number.'

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const athleteId = str(body.athleteId).toUpperCase()
    const mobileE164 = normalizeMobile(str(body.mobileE164))
    const dateOfBirth = str(body.dateOfBirth)
    const purpose = str(body.purpose) === 'profile_match' ? 'profile_match' : 'profile_lookup'

    const supabase = serviceClient()
    const ip = clientIp(req)
    await enforceRateLimit(supabase, `otp-request:ip:${ip}`, 15, 3600)

    const devAllowed =
      (Deno.env.get('OTP_DEV_MODE') ?? '').toLowerCase() === 'true' && isLocalhostOrigin(req)

    // Be honest when no channel can deliver a code — the answer is the same
    // for existing and non-existing athletes, so nothing is leaked.
    if (smsProvider() === 'none' && !devAllowed) {
      return errorJson(
        req,
        'OTP_NOT_CONFIGURED',
        'SMS verification is not configured for this deployment yet. Please contact the organiser for help retrieving your registration.',
        503,
      )
    }

    if (!athleteId && !(mobileE164 && dateOfBirth)) {
      return errorJson(
        req,
        'MISSING_FIELDS',
        'Please provide your Athlete ID, or your registered mobile number and date of birth.',
        400,
      )
    }

    const profile = await findProfileForOtp(supabase, { athleteId, mobileE164, dateOfBirth })
    if (!profile) {
      // Do not reveal that the athlete does not exist.
      return json(req, { ok: true, message: GENERIC_MESSAGE, expires_in_seconds: 600 })
    }

    await enforceRateLimit(supabase, `otp-request:target:${profile.id}`, 5, 3600)

    const code = randomDigits(6)
    const { data: codeHash } = await supabase.rpc('hash_secret', { p_value: code })
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    // Only the newest challenge per purpose stays valid.
    await supabase
      .from('otp_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('athlete_profile_id', profile.id)
      .eq('purpose', purpose)
      .is('consumed_at', null)

    const { error: insertError } = await supabase.from('otp_challenges').insert({
      athlete_profile_id: profile.id,
      mobile_e164: profile.mobile_e164,
      code_hash: codeHash,
      purpose,
      expires_at: expiresAt,
      request_ip: ip,
      max_attempts: 5,
    })

    if (insertError) {
      console.error('otp challenge insert failed', insertError)
      return errorJson(req, 'SERVER_ERROR', 'Could not start verification. Please try again.', 500)
    }

    const sms = await sendSms(
      profile.mobile_e164,
      `${code} is your verification code for the athlete registration portal. It expires in 10 minutes. Do not share it with anyone.`,
    )

    if (!sms.sent && !devAllowed) {
      console.error('OTP delivery failed', sms.reason)
      return errorJson(
        req,
        'SMS_FAILED',
        'We could not send the verification message right now. Please try again shortly or contact the organiser.',
        502,
      )
    }

    const payload: Record<string, unknown> = {
      ok: true,
      message: GENERIC_MESSAGE,
      expires_in_seconds: 600,
    }
    if (devAllowed) {
      // Development convenience ONLY: the flag defaults to false and the code
      // is only returned to requests originating from localhost.
      payload.dev_otp = code
      if (!sms.sent) payload.delivery = 'dev_mode_no_sms'
    }

    return json(req, payload)
  }),
)
