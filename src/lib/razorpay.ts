// Razorpay Checkout loader. The secret key never reaches the browser: the
// checkout only receives the public key id and a server-created order id.

export interface RazorpaySuccessResponse {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

export interface RazorpayCheckoutOptions {
  key: string
  amount: number
  currency: string
  name: string
  description?: string
  order_id: string
  prefill?: { name?: string; email?: string; contact?: string }
  notes?: Record<string, string>
  theme?: { color?: string }
  /**
   * Where Razorpay sends the browser after a redirect-based payment (net
   * banking, bank UPI apps). Must be on the site's own origin so the app can
   * pick the result out of the URL.
   */
  callback_url?: string
  /** Required alongside `callback_url`: redirect instead of firing the handler. */
  redirect?: boolean
  handler: (response: RazorpaySuccessResponse) => void
  modal?: { ondismiss?: () => void }
}

interface RazorpayInstance {
  open: () => void
  on: (event: string, callback: (payload: unknown) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance
  }
}

let loader: Promise<boolean> | null = null

export function loadRazorpayCheckout(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (window.Razorpay) return Promise.resolve(true)
  if (loader) return loader

  loader = new Promise<boolean>((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })

  return loader
}

export function openRazorpayCheckout(options: RazorpayCheckoutOptions): boolean {
  if (!window.Razorpay) return false
  const instance = new window.Razorpay(options)
  instance.open()
  return true
}
