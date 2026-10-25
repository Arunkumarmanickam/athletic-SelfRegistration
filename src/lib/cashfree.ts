// Cashfree Checkout (JS SDK v3) loader.
//
// The secret key never reaches the browser: the client only receives the
// `payment_session_id` from a server-created order. With `redirectTarget:
// '_self'` every payment method returns through Cashfree's `return_url`, which
// points at the `payment-callback` Edge Function — so this file never decides
// whether a payment succeeded.

export type CashfreeMode = 'sandbox' | 'production'

export interface CashfreeCheckoutOptions {
  paymentSessionId: string
  redirectTarget?: '_self' | '_blank' | '_modal'
}

interface CashfreeCheckoutResult {
  error?: { message?: string; type?: string } | null
  redirect?: boolean
}

interface CashfreeInstance {
  checkout: (options: CashfreeCheckoutOptions) => Promise<CashfreeCheckoutResult | undefined>
}

type CashfreeFactory = (config: { mode: CashfreeMode }) => CashfreeInstance

declare global {
  interface Window {
    Cashfree?: CashfreeFactory
  }
}

let loader: Promise<boolean> | null = null

export function loadCashfreeCheckout(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (window.Cashfree) return Promise.resolve(true)
  if (loader) return loader

  loader = new Promise<boolean>((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js'
    script.async = true
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })

  return loader
}

/**
 * Opens Cashfree checkout. Resolves `{ ok: true }` when the redirect has been
 * started; on a redirect-based flow the page navigates away and the promise
 * may never settle, which is expected.
 */
export async function openCashfreeCheckout(options: {
  paymentSessionId: string
  mode: CashfreeMode
}): Promise<{ ok: boolean; error?: string }> {
  if (!window.Cashfree) return { ok: false, error: 'The payment window could not be opened.' }

  try {
    const cashfree = window.Cashfree({ mode: options.mode })
    const result = await cashfree.checkout({
      paymentSessionId: options.paymentSessionId,
      redirectTarget: '_self',
    })
    if (result?.error) {
      return { ok: false, error: result.error.message ?? 'The payment could not be started.' }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'The payment could not be started.' }
  }
}
