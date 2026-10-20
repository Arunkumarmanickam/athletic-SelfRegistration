// Public registration status lookup.
//
// An athlete proves ownership with the mobile number they registered with, plus
// an identifier: EITHER the registration code (R######) OR the bib number
// (M3501, W7001). The receipt leads with the bib, so both must work — matching
// only the code made a correct lookup report "no match found".
//
// One mobile number may legitimately hold several registrations (a family
// sharing a phone, or one person entering two championships). The identifier is
// what selects between them, so the lookup returns EVERY registration that
// matches the identifier and belongs to that mobile. The client shows them all
// instead of silently picking one; if more than one matches we flag it so the
// caller can ask the athlete to be specific.
//
// Only status information is returned — never personal details beyond a masked
// name.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, maskName, readJson, str } from '../_shared/helpers.ts'
import { normalizeMobile } from '../_shared/athlete-lookup.ts'

const SELECT_COLUMNS =
  'id, registration_code, bib_number, status, payment_status, fee_paise, currency, registered_at, confirmed_at, championships (name, starts_on, location), championship_categories (name), athlete_profiles (full_name, mobile_e164), registration_events (event_name)'

interface Row {
  id: string
  registration_code: string
  bib_number: string | null
  status: string
  payment_status: string
  fee_paise: number
  currency: string
  registered_at: string | null
  confirmed_at: string | null
  championships: unknown
  championship_categories: unknown
  athlete_profiles?: { full_name: string; mobile_e164: string } | null
  registration_events?: { event_name: string }[] | null
}

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const identifier = str(body.registrationCode).toUpperCase()
    const mobileE164 = normalizeMobile(str(body.mobileE164))

    if (!identifier || !mobileE164) {
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
    await enforceRateLimit(supabase, `status-lookup:code:${identifier}`, 15, 3600)

    // A bib and a registration code are each unique only WITHIN a championship,
    // so the same value can exist in another championship. We therefore fetch
    // every candidate and filter on the mobile below, rather than assuming one.
    const escape = identifier.replace(/[%,()]/g, '')
    const { data, error } = await supabase
      .from('registrations')
      .select(SELECT_COLUMNS)
      .or(`registration_code.ilike.${escape},bib_number.ilike.${escape}`)
      .order('registered_at', { ascending: false })
      .limit(10)

    if (error) {
      console.error('status lookup failed', error)
      return errorJson(req, 'SERVER_ERROR', 'We could not look up that registration. Please try again.', 500)
    }

    // Ownership check: the registration must belong to the mobile supplied.
    // A wrong mobile (or an unknown identifier) yields the same message either
    // way, so the endpoint cannot be used to discover whether a code exists.
    const rows = ((data ?? []) as Row[]).filter(
      (row) => row.athlete_profiles?.mobile_e164 === mobileE164,
    )

    if (rows.length === 0) {
      return errorJson(
        req,
        'NOT_FOUND',
        'No registration matches those details. Please check the registration ID / bib number and mobile number.',
        404,
      )
    }

    const registrations = await Promise.all(
      rows.map(async (row) => {
        const { data: payments } = await supabase
          .from('payments')
          .select('status, razorpay_payment_id, amount_paise, currency, verified_at, created_at')
          .eq('registration_id', row.id)
          .order('created_at', { ascending: false })
          .limit(5)

        return {
          registration_code: row.registration_code,
          bib_number: row.bib_number ?? null,
          athlete_name_masked: maskName(row.athlete_profiles?.full_name ?? ''),
          status: row.status,
          payment_status: row.payment_status,
          fee_paise: row.fee_paise,
          currency: row.currency,
          registered_at: row.registered_at,
          confirmed_at: row.confirmed_at,
          championship: row.championships,
          category: row.championship_categories,
          events: (row.registration_events ?? []).map((e) => e.event_name),
          payments: payments ?? [],
        }
      }),
    )

    // `registration` stays a single object for the common case; `registrations`
    // exposes every match when one mobile holds several entries.
    return json(req, {
      registration: registrations[0],
      registrations,
      multiple: registrations.length > 1,
      payments: registrations[0].payments,
    })
  }),
)
