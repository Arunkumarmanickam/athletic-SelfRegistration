// Cashfree Payment Gateway helpers.
//
// Secrets stay on the server: the browser only ever receives a
// `payment_session_id`, which is safe to hand to the Cashfree JS SDK.
//
// Cashfree is not a drop-in replacement for Razorpay. It has no checkout
// `handler` callback and no order signature: the athlete is redirected back to
// `order_meta.return_url`, and the payment is confirmed by asking Cashfree for
// the order status. That is why `payment-callback` accepts a GET.
//
// Environment:
//   CASHFREE_APP_ID      Cashfree App ID (TEST… for sandbox)
//   CASHFREE_SECRET_KEY  Cashfree Secret Key (cfsk_ma_test_… for sandbox)
//   CASHFREE_ENV         "sandbox" (default) or "production"

export type CashfreeMode = 'sandbox' | 'production'

const API_VERSION = '2023-08-01'

export interface CashfreeOrder {
  order_id: string
  cf_order_id: number | string
  payment_session_id: string
  order_status: string
  order_amount: number
  order_currency: string
}

export interface CashfreePayment {
  cf_payment_id: number | string
  order_id: string
  payment_status: string
  payment_amount: number
  payment_currency: string
  payment_method?: unknown
}

export function cashfreeConfigured(): boolean {
  return Boolean(Deno.env.get('CASHFREE_APP_ID') && Deno.env.get('CASHFREE_SECRET_KEY'))
}

export function cashfreeMode(): CashfreeMode {
  return (Deno.env.get('CASHFREE_ENV') ?? 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox'
}

function apiBase(): string {
  return cashfreeMode() === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg'
}

function apiHeaders(): Record<string, string> {
  const appId = Deno.env.get('CASHFREE_APP_ID')
  const secretKey = Deno.env.get('CASHFREE_SECRET_KEY')
  if (!appId || !secretKey) throw new Error('Cashfree credentials are not configured')
  return {
    'Content-Type': 'application/json',
    'x-api-version': API_VERSION,
    'x-client-id': appId,
    'x-client-secret': secretKey,
  }
}

/** Cashfree accepts a phone number, not an E.164 string. */
function normalisePhone(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  const last10 = digits.slice(-10)
  return last10.length === 10 ? last10 : '9999999999'
}

/**
 * Creates a Cashfree order. The amount is always the server-calculated fee,
 * never a value supplied by the browser.
 */
export async function createCashfreeOrder(input: {
  orderId: string
  amountPaise: number
  currency: string
  customerId: string
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  returnUrl: string
  note?: string
}): Promise<CashfreeOrder> {
  const customerDetails: Record<string, string> = {
    customer_id: input.customerId,
    customer_phone: normalisePhone(input.customerPhone),
  }
  if (input.customerName?.trim()) customerDetails.customer_name = input.customerName.trim()
  if (input.customerEmail?.trim()) customerDetails.customer_email = input.customerEmail.trim()

  const response = await fetch(`${apiBase()}/orders`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({
      order_id: input.orderId,
      // Cashfree expects a decimal amount in the order currency, not paise.
      order_amount: Number((input.amountPaise / 100).toFixed(2)),
      order_currency: input.currency,
      customer_details: customerDetails,
      order_meta: { return_url: input.returnUrl },
      order_note: input.note,
      // Restrict to UPI only - avoids card/netbanking OTP/3DS flows.
      payment_methods: { upi: {} },
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.payment_session_id) {
    console.error('cashfree order creation failed', response.status, payload)
    throw new Error('Could not create the payment order. Please try again.')
  }
  return payload as CashfreeOrder
}

/** Returns the Cashfree order, or null when it cannot be read. */
export async function fetchCashfreeOrder(orderId: string): Promise<CashfreeOrder | null> {
  if (!cashfreeConfigured()) return null
  const response = await fetch(`${apiBase()}/orders/${encodeURIComponent(orderId)}`, {
    headers: apiHeaders(),
  })
  if (!response.ok) {
    console.error('cashfree order lookup failed', response.status, await response.text().catch(() => ''))
    return null
  }
  return (await response.json()) as CashfreeOrder
}

/** Returns every payment attempt made against an order, newest first. */
export async function fetchCashfreePayments(orderId: string): Promise<CashfreePayment[]> {
  if (!cashfreeConfigured()) return []
  const response = await fetch(`${apiBase()}/orders/${encodeURIComponent(orderId)}/payments`, {
    headers: apiHeaders(),
  })
  if (!response.ok) {
    console.error('cashfree payment lookup failed', response.status, await response.text().catch(() => ''))
    return []
  }
  const payload = await response.json().catch(() => null)
  return Array.isArray(payload) ? (payload as CashfreePayment[]) : []
}

/** True only when Cashfree reports the order as paid. */
export function cashfreeOrderPaid(order: CashfreeOrder | null): boolean {
  return (order?.order_status ?? '').toUpperCase() === 'PAID'
}

/**
 * Resolves the successful payment for a paid order. Returns null when the
 * order is not paid. `paymentId` may be null in the rare case Cashfree reports
 * the order as paid before the payment record is readable — the capture is
 * still valid, it just has no payment reference yet.
 */
export async function cashfreePaidPayment(
  order: CashfreeOrder | null,
): Promise<{ paymentId: string | null; method: string | null; amountPaise: number | null } | null> {
  if (!order || !cashfreeOrderPaid(order)) return null

  const payments = await fetchCashfreePayments(order.order_id)
  const paid = payments.find((p) => (p.payment_status ?? '').toUpperCase() === 'SUCCESS') ?? null

  if (!paid) {
    return { paymentId: null, method: null, amountPaise: null }
  }

  const method = typeof paid.payment_method === 'string'
    ? paid.payment_method
    : paid.payment_method && typeof paid.payment_method === 'object'
      ? Object.keys(paid.payment_method as Record<string, unknown>)[0] ?? null
      : null

  return {
    paymentId: String(paid.cf_payment_id),
    method,
    amountPaise: Math.round(Number(paid.payment_amount) * 100),
  }
}

/** Public URL Cashfree returns the browser to after checkout. */
export function cashfreeReturnUrl(): string {
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
  return `${base}/functions/v1/payment-callback?order_id={order_id}`
}
