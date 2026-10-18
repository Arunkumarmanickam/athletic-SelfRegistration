// Verifies a Razorpay checkout result server-side.
//
// A frontend "success" message is never trusted. Confirmation requires:
//   1. a valid HMAC signature computed with the secret key,
//   2. the order recorded in our database,
//   3. a matching server-side amount, and
//   4. Razorpay reporting the payment as captured/authorized for that order.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, readJson, str } from '../_shared/helpers.ts'
import { fetchRazorpayPayment, verifyCheckoutSignature } from '../_shared/razorpay.ts'
import { loadConfirmation, markPaymentCaptured, notifyConfirmedRegistration } from '../_shared/payments.ts'

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const orderId = str(body.razorpayOrderId)
    const paymentId = str(body.razorpayPaymentId)
    const signature = str(body.razorpaySignature)

    const supabase = serviceClient()
    await enforceRateLimit(supabase, `verify-payment:${clientIp(req)}`, 60, 3600)

    if (!orderId || !paymentId || !signature) {
      return errorJson(req, 'MISSING_FIELDS', 'Incomplete payment confirmation data.', 400)
    }

    const { data: payment } = await supabase
      .from('payments')
      .select('id, registration_id, status, amount_paise, currency')
      .eq('razorpay_order_id', orderId)
      .maybeSingle()

    if (!payment) return errorJson(req, 'PAYMENT_NOT_FOUND', 'We could not find that payment order.', 404)

    // Idempotent: already-verified payments simply return the confirmation.
    if (payment.status === 'captured') {
      const confirmation = await loadConfirmation(supabase, payment.registration_id)
      return json(req, { ok: true, status: 'paid', already_verified: true, confirmation })
    }

    const signatureValid = await verifyCheckoutSignature(orderId, paymentId, signature)
    if (!signatureValid) {
      console.error('invalid payment signature', { orderId, paymentId })
      await supabase
        .from('payments')
        .update({ failure_reason: 'Signature verification failed', signature_verified: false })
        .eq('id', payment.id)
      return errorJson(
        req,
        'INVALID_SIGNATURE',
        'Payment verification failed. If money was deducted, please contact the organiser with your payment reference.',
        400,
      )
    }

    // Second factor: ask Razorpay about this payment directly.
    const remote = await fetchRazorpayPayment(paymentId)
    if (remote) {
      const remoteOrder = String(remote.order_id ?? '')
      const remoteStatus = String(remote.status ?? '')
      const remoteAmount = Number(remote.amount ?? -1)
      if (remoteOrder !== orderId) {
        return errorJson(req, 'PAYMENT_MISMATCH', 'Payment does not match this registration order.', 400)
      }
      if (!['captured', 'authorized'].includes(remoteStatus)) {
        return errorJson(
          req,
          'PAYMENT_NOT_COMPLETED',
          `Payment is not completed yet (status: ${remoteStatus || 'unknown'}). Please retry or contact the organiser.`,
          409,
        )
      }
      if (remoteAmount !== Number(payment.amount_paise)) {
        return errorJson(req, 'AMOUNT_MISMATCH', 'The paid amount does not match the registration fee.', 400)
      }
    }

    const method = remote ? String(remote.method ?? '') : null
    const result = await markPaymentCaptured(supabase, { orderId, paymentId, method })

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
      await notifyConfirmedRegistration(supabase, result.registrationId!, paymentId)
    }

    return json(req, { ok: true, status: 'paid', already_verified: result.alreadyCaptured, confirmation })
  }),
)
