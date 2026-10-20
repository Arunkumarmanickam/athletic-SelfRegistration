// Recovers a Razorpay payment that came back as a browser redirect.
//
// Card and in-app UPI return through checkout.js's handler callback, but net
// banking (and several UPI/bank flows) send the browser away to the bank and
// back. Razorpay then returns the result either as a POST to `callback_url`
// (which this SPA cannot read) or as query parameters on the return URL:
//
//   ?razorpay_payment_id=pay_xxx&razorpay_order_id=order_xxx&razorpay_signature=xxx
//
// Without this, a net-banking athlete lands back on the site with nothing
// happening: no verification, no confirmation, no receipt. We read those
// parameters, run the same server-side verification the checkout handler uses,
// store the confirmation and replace the URL so a refresh cannot replay it.

import { verifyPayment } from './api'
import { saveConfirmation } from './receipt'

/** Query parameter names Razorpay uses for a redirect return. */
const PAYMENT_PARAMS = ['razorpay_payment_id', 'razorpay_order_id', 'razorpay_signature'] as const

export interface RecoveryResult {
  /** The registration that was just confirmed, or null when nothing was found. */
  confirmed: boolean
  /** A human-readable error when a payment came back but could not be verified. */
  error: string | null
}

/**
 * Detects and verifies a redirect-returned payment.
 *
 * Returns `{ confirmed: false, error: null }` when the URL carries no payment
 * parameters, which is the normal case for every in-page payment.
 */
export async function recoverRedirectedPayment(search: string): Promise<RecoveryResult> {
  const params = new URLSearchParams(search)
  const paymentId = params.get('razorpay_payment_id') ?? ''
  const orderId = params.get('razorpay_order_id') ?? ''
  const signature = params.get('razorpay_signature') ?? ''

  // A bank may also bounce back with an error instead of a payment.
  const failed = params.get('error') ?? params.get('error[code]') ?? params.get('error_code') ?? ''
  if (!paymentId || !orderId) {
    return { confirmed: false, error: failed ? describeRedirectError(params) : null }
  }

  try {
    const result = await verifyPayment({
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
    })
    saveConfirmation(result.confirmation)
    return { confirmed: true, error: null }
  } catch (err) {
    return {
      confirmed: false,
      error:
        err instanceof Error && err.message
          ? err.message
          : 'We could not confirm your payment. If money was deducted, please contact the organiser with your payment reference.',
    }
  }
}

function describeRedirectError(params: URLSearchParams): string {
  const code = params.get('error[code]') ?? params.get('error_code') ?? ''
  const description = params.get('error[description]') ?? params.get('error_description') ?? ''
  const detail = description || code
  return detail
    ? `Your payment could not be completed: ${detail}`
    : 'Your payment could not be completed. Please try again.'
}

/** Removes payment parameters from the current URL without adding a history entry. */
export function stripPaymentParams(search: string): string {
  const params = new URLSearchParams(search)
  for (const name of PAYMENT_PARAMS) params.delete(name)
  for (const name of ['error', 'error[code]', 'error[description]', 'error_code', 'error_description']) {
    params.delete(name)
  }
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}
