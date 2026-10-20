// Recovers a payment that came back as a browser redirect.
//
// Card and in-app UPI return through checkout.js's handler callback, but net
// banking (and several UPI/bank flows) send the browser away to the bank and
// back. Razorpay then POSTs the result to `callback_url` — which points at the
// `payment-callback` Edge Function, because a static site answers POST with
// 405. That function verifies the payment server-side and redirects the browser
// here with one of:
//
//   ?receipt=<single-use token>   payment captured, exchange for the receipt
//   ?payment_callback=paid        captured, but the token could not be stored
//   ?payment_callback=failed&payment_error=<message>
//
// Nothing in the URL is trusted: the token is exchanged server-side and can be
// used once.

import { fetchReceiptByToken } from './api'
import { saveConfirmation } from './receipt'

const RETURN_PARAMS = ['receipt', 'payment_callback', 'payment_error'] as const

export interface RecoveryResult {
  /** The registration that was just confirmed, or null when nothing was found. */
  confirmed: boolean
  /** A human-readable error when a payment came back but could not be verified. */
  error: string | null
  /** True when the payment is confirmed but the receipt needs the status lookup. */
  needsLookup: boolean
}

/**
 * Detects and resolves a redirect-returned payment.
 *
 * Returns `{ confirmed: false, error: null, needsLookup: false }` when the URL
 * carries nothing relevant, which is the normal case for in-page payments.
 */
export async function recoverRedirectedPayment(search: string): Promise<RecoveryResult> {
  const params = new URLSearchParams(search)
  const token = params.get('receipt') ?? ''
  const status = params.get('payment_callback') ?? ''
  const message = params.get('payment_error') ?? ''

  if (token) {
    try {
      const result = await fetchReceiptByToken(token)
      saveConfirmation(result.confirmation)
      return { confirmed: true, error: null, needsLookup: false }
    } catch (err) {
      return {
        confirmed: false,
        needsLookup: false,
        error:
          err instanceof Error && err.message
            ? err.message
            : 'We could not load your receipt. You can look up your registration with your Registration ID and mobile number.',
      }
    }
  }

  if (status === 'failed') {
    return {
      confirmed: false,
      needsLookup: false,
      error: message || 'Your payment could not be completed. Please try again.',
    }
  }

  if (status === 'paid') {
    // Payment confirmed but no token was issued; send them to the lookup with
    // a clear explanation rather than an empty receipt page.
    return { confirmed: false, needsLookup: true, error: null }
  }

  return { confirmed: false, needsLookup: false, error: null }
}

/** Removes payment-return parameters from the URL without adding a history entry. */
export function stripPaymentParams(search: string): string {
  const params = new URLSearchParams(search)
  for (const name of RETURN_PARAMS) params.delete(name)
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}
