// Public registration status lookup.
// Requires BOTH the registration code (bib number) and the registered mobile
// number, and returns only status information — never personal details.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, maskName, readJson, str } from '../_shared/helpers.ts'
import { normalizeMobile } from '../_shared/athlete-lookup.ts'

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const registrationCode = str(body.registrationCode).toUpperCase()
    const mobileE164 = normalizeMobile(str(body.mobileE164))

    if (!registrationCode || !mobileE164) {
      return errorJson(
        req,
        'MISSING_FIELDS',
        'Please enter your registration ID / bib number and the registered mobile number.',
        400,
      )
    }

    const supabase = serviceClient()
    const ip = clientIp(req)
    await enforceRateLimit(supabase, `status-lookup:ip:${ip}`, 30, 3600)
    await enforceRateLimit(supabase, `status-lookup:code:${registrationCode}`, 15, 3600)

    const { data: registration } = await supabase
      .from('registrations')
      .select(
        'id, registration_code, bib_number, status, payment_status, fee_paise, currency, registered_at, confirmed_at, championships (name, starts_on, location), championship_categories (name), athlete_profiles (full_name, mobile_e164), registration_events (event_name)',
      )
      .ilike('registration_code', registrationCode)
      .maybeSingle()

    const profile = (registration as unknown as { athlete_profiles?: { full_name: string; mobile_e164: string } } | null)
      ?.athlete_profiles

    if (!registration || !profile || profile.mobile_e164 !== mobileE164) {
      // Same message whether the code does not exist or the mobile does not match.
      return errorJson(
        req,
        'NOT_FOUND',
        'No registration matches those details. Please check the registration ID and mobile number.',
        404,
      )
    }

    const { data: payments } = await supabase
      .from('payments')
      .select('status, razorpay_payment_id, amount_paise, currency, verified_at, created_at')
      .eq('registration_id', (registration as unknown as { id?: string }).id ?? '')
      .order('created_at', { ascending: false })
      .limit(5)

    return json(req, {
      registration: {
        registration_code: registration.registration_code,
        bib_number: registration.bib_number ?? null,
        athlete_name_masked: maskName(profile.full_name),
        status: registration.status,
        payment_status: registration.payment_status,
        fee_paise: registration.fee_paise,
        currency: registration.currency,
        registered_at: registration.registered_at,
        confirmed_at: registration.confirmed_at,
        championship: registration.championships,
        category: registration.championship_categories,
        events: ((registration.registration_events as { event_name: string }[] | null) ?? []).map(
          (e) => e.event_name,
        ),
      },
      payments: payments ?? [],
    })
  }),
)
