// Creates a fresh Cashfree order for a pre-payment registration draft.
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
  cashfreeConfigured,
  cashfreeMode,
  cashfreeReturnUrl,
  createCashfreeOrder,
} from '../_shared/cashfree.ts'

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

    // Mandatory Aadhaar upload must have been recorded before creating an order.
    if (!draft.aadhaar_verified_at) {
      return errorJson(req, 'AADHAAR_REQUIRED', 'Please upload your Aadhaar front before making payment.', 400)
    }

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

    if (!cashfreeConfigured()) {
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

    // Cashfree order ids must be unique and at most 50 characters; the draft id
    // plus the attempt number satisfies both.
    const orderId = `cdf${draft.id.replace(/-/g, '')}${attemptNumber}`

    let paymentSessionId: string
    try {
      const order = await createCashfreeOrder({
        orderId,
        amountPaise: Number(draft.fee_paise),
        currency: draft.currency,
        customerId: draft.id,
        customerName: draft.personal?.full_name ?? null,
        customerEmail: draft.personal?.email ?? null,
        customerPhone: draft.personal?.mobile_e164 ?? null,
        returnUrl: cashfreeReturnUrl(),
        note: `Draft ${draft.id}, attempt ${attemptNumber}`,
      })
      paymentSessionId = order.payment_session_id
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
        // Field names are kept for compatibility with the existing client and
        // database columns: `razorpay_order_id` now holds the Cashfree order id,
        // and `razorpay_key_id` holds the Cashfree payment_session_id.
        razorpay_order_id: orderId,
        razorpay_key_id: paymentSessionId,
        cashfree_mode: cashfreeMode(),
        amount_paise: Number(draft.fee_paise),
        currency: draft.currency,
      },
    })
  }),
)
