// Razorpay integration helpers.
// Secrets stay on the server; the browser only ever receives the public key id.

export interface RazorpayOrder {
  id: string
  amount: number
  currency: string
  receipt: string | null
  status: string
}

export function razorpayConfigured(): boolean {
  return Boolean(Deno.env.get('RAZORPAY_KEY_ID') && Deno.env.get('RAZORPAY_KEY_SECRET'))
}

export function razorpayKeyId(): string {
  return Deno.env.get('RAZORPAY_KEY_ID') ?? ''
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Length-independent comparison to reduce timing signals. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

/**
 * Creates a Razorpay order. The amount is always the server-calculated fee,
 * never a value supplied by the browser.
 */
export async function createRazorpayOrder(input: {
  amountPaise: number
  currency: string
  receipt: string
  notes?: Record<string, string>
}): Promise<RazorpayOrder> {
  const keyId = Deno.env.get('RAZORPAY_KEY_ID')
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keyId || !keySecret) throw new Error('Razorpay credentials are not configured')

  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
    },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes ?? {},
      payment_capture: 1,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.id) {
    console.error('razorpay order creation failed', response.status, payload)
    throw new Error('Could not create the payment order. Please try again.')
  }
  return payload as RazorpayOrder
}

/** Verifies the checkout handshake: HMAC_SHA256(order_id|payment_id, key_secret). */
export async function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keySecret) return false
  const expected = await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`)
  return safeEqual(expected, signature)
}

/** Verifies a webhook body signature using the webhook secret. */
export async function verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')
  if (!secret || !signature) return false
  const expected = await hmacSha256Hex(secret, rawBody)
  return safeEqual(expected, signature)
}

/** Fetches a payment from Razorpay (used to double-check server-side state). */
export async function fetchRazorpayPayment(paymentId: string): Promise<Record<string, unknown> | null> {
  const keyId = Deno.env.get('RAZORPAY_KEY_ID')
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keyId || !keySecret) return null

  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` },
  })
  if (!response.ok) return null
  return (await response.json()) as Record<string, unknown>
}
