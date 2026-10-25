// Validates a registration and stages it as a DRAFT.
//
// Nothing permanent is created here: no athlete profile, no Athlete ID, no bib
// number, no registration row. Only a `registration_drafts` row is written,
// keyed by a bearer token. The profile, the Athlete ID, the bib and the
// registration are all created by promote_draft when payment is captured, so
// someone who fills in the form and abandons the payment gate leaves nothing
// behind but a draft that is pruned.
//
// The browser never decides the fee or the amount: both come from Postgres.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import {
  clientIp,
  enforceRateLimit,
  isDateOnly,
  isEmail,
  isE164,
  readJson,
  str,
} from '../_shared/helpers.ts'
import { normalizeMobile } from '../_shared/athlete-lookup.ts'
import { newDraftToken } from '../_shared/draft.ts'
import { cashfreeConfigured } from '../_shared/cashfree.ts'

interface PersonalInput {
  full_name: string
  date_of_birth: string
  gender: string
  mobile_country_code: string
  mobile_number: string
  mobile_e164: string
  email: string
  state: string
  district: string
  address: string
  representing: string
  emergency_contact_name: string
  emergency_contact_phone: string
}

function sanitizePersonal(raw: Record<string, unknown>): PersonalInput {
  const countryCode = str(raw.mobile_country_code) || '+91'
  const mobile = str(raw.mobile_number)
  const explicitE164 = str(raw.mobile_e164)
  return {
    full_name: str(raw.full_name),
    date_of_birth: str(raw.date_of_birth),
    gender: str(raw.gender).toLowerCase(),
    mobile_country_code: countryCode,
    mobile_number: mobile,
    mobile_e164: normalizeMobile(explicitE164 || `${countryCode}${mobile}`),
    email: str(raw.email),
    state: str(raw.state),
    district: str(raw.district),
    address: str(raw.address),
    representing: str(raw.representing),
    emergency_contact_name: str(raw.emergency_contact_name),
    emergency_contact_phone: str(raw.emergency_contact_phone),
  }
}

/** Returns an error message, or null when the supplied fields are acceptable. */
function validatePersonal(p: PersonalInput, requireAll: boolean): string | null {
  const has = (v: string) => v.trim().length > 0
  const mobileProvided = /^\+?\d{8,15}$/.test(p.mobile_e164)

  if (requireAll || has(p.full_name)) {
    if (p.full_name.length < 2 || p.full_name.length > 120) {
      return 'Please enter the athlete\u2019s full name (2-120 characters).'
    }
  }
  if (requireAll || has(p.date_of_birth)) {
    if (!p.date_of_birth) return 'Please enter the date of birth.'
    if (!isDateOnly(p.date_of_birth)) return 'Please enter a valid date of birth.'
    const dob = new Date(`${p.date_of_birth}T00:00:00Z`)
    const ageYears = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000)
    if (ageYears < 3 || ageYears > 100) return 'Please check the date of birth.'
  }
  if (requireAll || has(p.gender)) {
    if (!['male', 'female', 'other'].includes(p.gender)) return 'Please select a gender.'
  }
  if (requireAll || mobileProvided) {
    if (!isE164(p.mobile_e164)) return 'Please enter a valid mobile number with country code.'
  }
  if (has(p.email) && !isEmail(p.email)) return 'Please enter a valid email address.'
  if (requireAll || has(p.state)) {
    if (!has(p.state)) return 'Please select a state.'
  }
  return null
}

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const championshipId = str(body.championshipId)
    const categoryId = str(body.categoryId)
    const draftToken = str(body.draftToken)

    const eventIds = Array.isArray(body.eventIds)
      ? (body.eventIds as unknown[]).map((v) => str(v)).filter(Boolean)
      : []

    if (!championshipId || !categoryId) {
      return errorJson(req, 'MISSING_FIELDS', 'Please choose a championship and an age category.', 400)
    }
    if (eventIds.length === 0) {
      return errorJson(req, 'EVENTS_REQUIRED', 'Please select at least one event.', 400)
    }
    if (eventIds.length > 15) {
      return errorJson(req, 'TOO_MANY_EVENTS', 'Please select a maximum of 15 events.', 400)
    }

    const rawPersonal = (body.personal && typeof body.personal === 'object'
      ? (body.personal as Record<string, unknown>)
      : {}) as Record<string, unknown>

    const personal = sanitizePersonal(rawPersonal)
    const hasPersonal = Object.keys(rawPersonal).length > 0
    // Every draft submission carries the athlete's own details: there is no
    // pre-existing profile to fall back on before payment.
    if (!hasPersonal) {
      return errorJson(req, 'MISSING_FIELDS', 'Please fill in the athlete\u2019s personal details.', 400)
    }
    const personalError = validatePersonal(personal, true)
    if (personalError) return errorJson(req, 'INVALID_FIELDS', personalError, 400)

    const supabase = serviceClient()
    const ip = clientIp(req)
    await enforceRateLimit(supabase, `register:ip:${ip}`, 30, 3600)
    if (personal.mobile_e164) {
      await enforceRateLimit(supabase, `register:mobile:${personal.mobile_e164}`, 12, 3600)
    }

    const draftTokenPair = await newDraftToken()
    if (!draftTokenPair) {
      return errorJson(req, 'SERVER_ERROR', 'We could not save your registration. Please try again.', 500)
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc('create_registration_draft', {
      p_championship_id: championshipId,
      p_personal: personal,
      p_category_id: categoryId,
      p_event_ids: eventIds,
      p_request_ip: ip,
      p_token_hash: draftTokenPair.hash,
    })

    if (rpcError) {
      console.error('create_registration_draft failed', rpcError)
      return errorJson(req, 'SERVER_ERROR', 'We could not save your registration. Please try again.', 500)
    }

    const result = rpcResult as Record<string, unknown>
    if (result?.ok !== true) {
      const err = (result?.error ?? {}) as { code?: string; message?: string }
      const code = err.code ?? 'REGISTRATION_FAILED'
      const status = code === 'ALREADY_REGISTERED' ? 409 : 400
      return errorJson(req, code, err.message ?? 'We could not save your registration.', status)
    }

    const draftId = result.draft_id as string
    const feePaise = Number(result.fee_paise)
    const currency = (result.currency as string) ?? 'INR'
    const applicationNumber = (result.application_number as string | null) ?? null

    // No Athlete ID and no bib yet: both are issued only once payment is
    // captured. The draft token is what the next steps authenticate with.
    const draftPayload = {
      id: draftId,
      application_number: applicationNumber,
      championship_id: championshipId,
      category_name: (result.category_name as string | null) ?? null,
      fee_paise: feePaise,
      currency,
      expires_at: (result.expires_at as string | null) ?? null,
    }

    // Prefill the Razorpay checkout with what the athlete just typed, so the
    // gateway does not ask for the same name/email/phone again.
    const prefill = {
      name: personal.full_name ?? '',
      email: personal.email ?? '',
      contact: personal.mobile_e164 ?? '',
    }

    // Honest behaviour: no order is created before the mandatory Aadhaar
    // upload is recorded. payment-retry creates the order afterwards and
    // refuses until the draft records an Aadhaar upload.
    if (!cashfreeConfigured()) {
      return json(
        req,
        {
          ok: true,
          draft: draftPayload,
          payment: { configured: false },
          draft_token: draftTokenPair.token,
          message: `Your details have been recorded. Application No: ${applicationNumber ?? 'N/A'}. Online payment is not configured yet. Please contact the organiser to complete payment.`,
        },
        200,
      )
    }

    return json(req, {
      ok: true,
      draft: draftPayload,
      payment: { configured: false, aadhaar_required: true },
      prefill,
      draft_token: draftTokenPair.token,
      application_number: applicationNumber,
    })
  }),
)
