// PhonePe Standard Checkout redirect helper.
//
// There is no client-side SDK to load: the server creates the order and returns
// a hosted-checkout URL. This module only validates that the URL really belongs
// to PhonePe before navigating, so a tampered API response cannot turn the
// payment button into an open redirect.

const CHECKOUT_HOSTS = ['phonepe.com', 'phon.pe']

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return CHECKOUT_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

/** True only for an https URL on a phonepe.com host. */
export function isPhonePeCheckoutUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && isAllowedHost(url.hostname)
  } catch {
    return false
  }
}

/**
 * Sends the browser to PhonePe's hosted checkout. On success the page navigates
 * away and never returns here; PhonePe then redirects back to the
 * `payment-callback` Edge Function, which verifies the order server-side.
 */
export function startPhonePeCheckout(raw: string): { ok: boolean; error?: string } {
  if (!isPhonePeCheckoutUrl(raw)) {
    return {
      ok: false,
      error: 'The payment link could not be verified. Please try again or contact the organiser.',
    }
  }
  window.location.assign(raw)
  return { ok: true }
}
