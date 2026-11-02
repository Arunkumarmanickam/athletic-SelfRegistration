// Creates a fresh PhonePe order for a pre-payment registration draft.
//
// Used when a previous checkout failed, was cancelled or was abandoned. The
// draft token is the bearer credential, so a code alone cannot be used to probe
// or spam the payment gateway. The order is stored in `payment_orders` against
// the draft: no registration exists yet, and none is created until the payment
// is captured.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, readJson, str } from '../_shared/helpers.ts'
import { resolveDraft } from '../_shared/draft.ts'
import {
  createPhonePeOrder,
  phonepeConfigured,
  phonepeReturnUrl,
} from '../_shared/phonepe.ts'

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const draftToken = str(body.draftToken)

    if (!draftToken) {
      return errorJson(req, 'SESSION_EXPIRED', 'Your registration session has expired. Please start again.', 401)
    }

    const supabase = serviceClient()
    const ip = clientIp(req)
    await enforceRateLimit(supabase, `payment-retry:ip:${ip}`, 30, 3600)

    // Pull application number too
    const supabaseDraft = serviceClient()
    const hashDraft = await (async () => {
      const { hashToken } = await import('../_shared/draft.ts')
      // @ts-ignore
      return await hashToken(draftToken)
    })().catch(() => null)
    let appNo: string | null = null
    if (hashDraft) {
      const { data: drow } = await supabaseDraft
        .from('registration_drafts')
        .select('application_number')
        .eq('token_hash', hashDraft)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()
      appNo = (drow?.application_number as string | null) ?? null
    }

    const draft = await resolveDraft(draftToken)
    if (draft) {
      ;(draft as any).application_number = appNo
    }
    if (!draft) {
      return errorJson(
        req,
        'SESSION_EXPIRED',
        'Your registration has expired. Please fill in your details again.',
        401,
      )
    }

    await enforceRateLimit(supabase, `payment-retry:draft:${draft.id}`, 12, 3600)

    const { data: championship } = await supabase
      .from('championships')
      .select('id, name, status, registration_closes_at')
      .eq('id', draft.championship_id)
      .maybeSingle()

    if (championship?.status !== 'open') {
      return errorJson(req, 'REGISTRATION_CLOSED', 'Registration for this championship is not open.', 409)
    }
    if (championship.registration_closes_at && new Date(championship.registration_closes_at) < new Date()) {
      return errorJson(req, 'DEADLINE_PASSED', 'The registration deadline has passed.', 409)
    }

    if (!phonepeConfigured()) {
      return errorJson(
        req,
        'PAYMENTS_NOT_CONFIGURED',
        'Online payment is not configured for this deployment yet. Please contact the organiser.',
        503,
      )
    }

    const { count } = await supabase
      .from('payment_orders')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draft.id)
    const attemptNumber = (count ?? 0) + 1

    // PhonePe merchant order ids allow only letters, digits, "_" and "-", up to
    // 63 characters. The draft id (32 hex chars) plus the attempt number stays
    // well inside that; the random suffix keeps concurrent double-clicks from
    // colliding on the same id.
    const randomSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
    const orderId = `cdmaa_${draft.id.replace(/-/g, '')}_${attemptNumber}_${randomSuffix}`

    let redirectUrl: string
    try {
      const order = await createPhonePeOrder({
        merchantOrderId: orderId,
        amountPaise: Number(draft.fee_paise),
        redirectUrl: phonepeReturnUrl(orderId),
        expireAfterSeconds: 1800,
        message: `CDMAA registration ${String((draft as any).application_number ?? orderId)}`,
      })
      redirectUrl = String(order.redirectUrl)
    } catch (error) {
      console.error('retry order failed', error)
      return errorJson(req, 'ORDER_FAILED', 'Could not create a new payment order. Please try again.', 502)
    }

    const { error: insertError } = await supabase.from('payment_orders').insert({
      draft_id: draft.id,
      razorpay_order_id: orderId,
      amount_paise: Number(draft.fee_paise),
      currency: draft.currency,
      status: 'created',
      attempt_number: attemptNumber,
    })
    if (insertError) {
      console.error('retry order insert failed', insertError)
      return errorJson(req, 'SERVER_ERROR', 'Could not start the payment. Please try again.', 500)
    }

    // Abandon any earlier, still-open attempt against this draft.
    await supabase
      .from('payment_orders')
      .update({ status: 'failed', failure_reason: 'Superseded by a new attempt' })
      .eq('draft_id', draft.id)
      .eq('status', 'created')
      .neq('razorpay_order_id', orderId)

    return json(req, {
      ok: true,
      draft: {
        id: draft.id,
        application_number: (draft as any).application_number ?? null,
        fee_paise: Number(draft.fee_paise),
        currency: draft.currency,
      },
      application_number: (draft as any).application_number ?? null,
      // Prefill the checkout with the details the athlete already gave us, so
      // they are not asked for their own name/email/phone a second time.
      prefill: {
        name: draft.personal?.full_name ?? '',
        email: draft.personal?.email ?? '',
        contact: draft.personal?.mobile_e164 ?? '',
      },
      payment: {
        configured: true,
        gateway: 'phonepe',
        // Field names are kept for compatibility with the existing client and
        // database columns: `razorpay_order_id` now holds the PhonePe merchant
        // order id (our own reference, used for every status lookup).
        razorpay_order_id: orderId,
        /** PhonePe hosted-checkout URL the browser is sent to. */
        redirect_url: redirectUrl,
        amount_paise: Number(draft.fee_paise),
        currency: draft.currency,
      },
    })
  }),
)
