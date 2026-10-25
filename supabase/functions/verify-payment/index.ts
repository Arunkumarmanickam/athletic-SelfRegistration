// Verifies a Cashfree payment server-side.
//
// Cashfree's checkout has no signed `handler` response: the browser is
// redirected back to `payment-callback`, which calls this same verification.
// This endpoint remains available so a client can confirm an order explicitly.
//
// A frontend "success" message is never trusted. Confirmation requires:
//   1. the order recorded in our database,
//   2. Cashfree reporting the order as PAID,
//   3. a matching server-side amount, and
//   4. a SUCCESS payment for that order (when Cashfree exposes it).
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, readJson, str } from '../_shared/helpers.ts'
import { cashfreePaidPayment, fetchCashfreeOrder } from '../_shared/cashfree.ts'
import { loadConfirmation, markPaymentCaptured, notifyConfirmedRegistration } from '../_shared/payments.ts'

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    // `razorpayOrderId` is accepted for compatibility with older clients; it
    // now carries the Cashfree order id.
    const orderId = str(body.cashfreeOrderId) || str(body.orderId) || str(body.razorpayOrderId)

    const supabase = serviceClient()
    await enforceRateLimit(supabase, `verify-payment:${clientIp(req)}`, 60, 3600)

    if (!orderId) {
      return errorJson(req, 'MISSING_FIELDS', 'Incomplete payment confirmation data.', 400)
    }

    const { data: order } = await supabase
      .from('payment_orders')
      .select('id, draft_id, status, amount_paise, currency')
      .eq('razorpay_order_id', orderId)
      .maybeSingle()

    if (!order) return errorJson(req, 'PAYMENT_NOT_FOUND', 'We could not find that payment order.', 404)

    // Idempotent: already-verified payments simply return the confirmation.
    if (order.status === 'captured') {
      const { data: registration } = await supabase
        .from('registrations')
        .select('id')
        .eq('draft_id', order.draft_id)
        .maybeSingle()
      if (registration) {
        const confirmation = await loadConfirmation(supabase, registration.id)
        return json(req, { ok: true, status: 'paid', already_verified: true, confirmation })
      }
    }

    // Ask Cashfree about the order rather than trusting the browser.
    const remote = await fetchCashfreeOrder(orderId)
    if (!remote) {
      return errorJson(
        req,
        'PAYMENT_NOT_FOUND',
        'We could not read that payment order from the gateway. Please contact the organiser.',
        502,
      )
    }

    if ((remote.order_status ?? '').toUpperCase() !== 'PAID') {
      return errorJson(
        req,
        'PAYMENT_NOT_COMPLETED',
        `Payment is not completed yet (status: ${remote.order_status || 'unknown'}). Please retry or contact the organiser.`,
        409,
      )
    }

    if (Math.round(Number(remote.order_amount) * 100) !== Number(order.amount_paise)) {
      return errorJson(req, 'AMOUNT_MISMATCH', 'The paid amount does not match the registration fee.', 400)
    }

    const paid = await cashfreePaidPayment(remote)
    if (paid?.amountPaise != null && paid.amountPaise !== Number(order.amount_paise)) {
      return errorJson(req, 'AMOUNT_MISMATCH', 'The paid amount does not match the registration fee.', 400)
    }

    const result = await markPaymentCaptured(supabase, {
      orderId,
      paymentId: paid?.paymentId ?? null,
      method: paid?.method ?? null,
    })

    if (!result.ok) {
      if (result.error === 'AMOUNT_MISMATCH') {
        return errorJson(
          req,
          'AMOUNT_MISMATCH',
          'The paid amount does not match the registration fee. Please contact the organiser.',
          409,
        )
      }
      return errorJson(req, 'PAYMENT_FAILED', 'We could not confirm this payment. Please contact the organiser.', 409)
    }

    const confirmation = await loadConfirmation(supabase, result.registrationId!)

    // Best-effort confirmation email: awaited so logs are useful, but failures
    // never affect the verified payment result.
    if (!result.alreadyCaptured) {
      await notifyConfirmedRegistration(supabase, result.registrationId!, paid?.paymentId ?? null)
    }

    return json(req, { ok: true, status: 'paid', already_verified: result.alreadyCaptured, confirmation })
  }),
)
