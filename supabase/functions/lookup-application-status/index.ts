import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, readJson, str } from '../_shared/helpers.ts'

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const applicationNumber = str(body.applicationNumber || body.application_number).toUpperCase()
    const mobile = str(body.mobileE164 || body.mobile_e164 || body.mobile)

    const supabase = serviceClient()
    await enforceRateLimit(supabase, `lookup-app:${clientIp(req)}`, 60, 3600)

    if (!applicationNumber || !mobile) {
      return errorJson(req, 'MISSING_FIELDS', 'Please enter Application Number and mobile number.', 400)
    }

    // Check if already promoted
    const { data: reg } = await supabase
      .from('registrations')
      .select(
        'id, registration_code, bib_number, status, payment_status, fee_paise, currency, registered_at, confirmed_at, championships (id, name, slug, starts_on, ends_on, location), championship_categories (name), athlete_profiles (athlete_id, full_name, email, mobile_e164, state, district), registration_events (event_name, fee_paise)',
      )
      .eq('form_snapshot->>mobile_e164', mobile)
      .or(`registration_code.eq.${applicationNumber.replace(/[^A-Za-z0-9]/g, '')},bib_number.eq.${applicationNumber.replace(/[^A-Za-z0-9]/g, '')}`)
      .maybeSingle()

    if (reg) {
      const { data: payments } = await supabase
        .from('payments')
        .select('status, razorpay_payment_id, amount_paise, currency, verified_at, created_at')
        .eq('registration_id', (reg as any).id)
        .order('created_at', { ascending: false })

      return json(req, {
        ok: true,
        type: 'registration',
        registration: reg,
        payments: payments ?? [],
      })
    }

    // Look up draft
    const { data: draft } = await supabase
      .from('registration_drafts')
      .select('id, application_number, championship_id, category_name, fee_paise, currency, personal, event_ids, expires_at, created_at, aadhaar_verified_at')
      .eq('application_number', applicationNumber)
      .eq('personal->>mobile_e164', mobile)
      .maybeSingle()

    if (!draft) {
      return errorJson(req, 'NOT_FOUND', 'No application found with these details.', 404)
    }

    // Check payment orders
    const { data: orders } = await supabase
      .from('payment_orders')
      .select('id, razorpay_order_id, status, amount_paise, currency, failure_reason, created_at, updated_at')
      .eq('draft_id', (draft as any).id)
      .order('created_at', { ascending: false })

    let paymentStatus = 'pending'
    if (orders && orders.length > 0) {
      const latest = orders[0]
      if (latest.status === 'captured') paymentStatus = 'paid'
      else if (latest.status === 'failed') paymentStatus = 'failed'
      else if (latest.status === 'created' || latest.status === 'authorized') paymentStatus = 'processing'
    }

    // Get championship info
    const { data: champ } = await supabase
      .from('championships')
      .select('name, starts_on, location')
      .eq('id', (draft as any).championship_id)
      .maybeSingle()

    return json(req, {
      ok: true,
      type: 'draft',
      application: {
        application_number: (draft as any).application_number,
        championship: champ,
        category_name: (draft as any).category_name,
        fee_paise: (draft as any).fee_paise,
        currency: (draft as any).currency,
        created_at: (draft as any).created_at,
        expires_at: (draft as any).expires_at,
        aadhaar_verified: Boolean((draft as any).aadhaar_verified_at),
        payment_status: paymentStatus,
      },
      orders: orders ?? [],
    })
  }),
)
