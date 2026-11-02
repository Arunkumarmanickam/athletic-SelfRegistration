// PhonePe Payment Gateway (Standard Checkout) helpers.
//
// Secrets stay on the server: the browser only ever receives a hosted-checkout
// `redirectUrl`, which it navigates to. Nothing on the client can change the
// amount or mark a payment as successful.
//
// Verification is server-to-server: after the athlete returns (or a webhook
// arrives) we ask PhonePe for the order status and only capture when PhonePe
// reports the order as COMPLETED with a matching amount.
//
// Environment:
//   PHONEPE_CLIENT_ID       Client ID from the PhonePe dashboard
//   PHONEPE_CLIENT_SECRET   Client Secret from the PhonePe dashboard
//   PHONEPE_CLIENT_VERSION  Client Version from the PhonePe dashboard
//   PHONEPE_ENV             "sandbox" (default) or "production"

export type PhonePeMode = 'sandbox' | 'production'

export interface PhonePePayment {
  transactionId: string
  paymentMode?: string | null
  state?: string | null
  amount?: number | null
  errorCode?: string | null
  detailedErrorCode?: string | null
}

export interface PhonePeOrder {
  orderId?: string
  merchantOrderId?: string
  state?: string
  amount?: number | string
  expireAt?: number
  redirectUrl?: string
  paymentDetails?: PhonePePayment[]
  errorCode?: string | null
  detailedErrorCode?: string | null
}

export function phonepeConfigured(): boolean {
  return Boolean(
    Deno.env.get('PHONEPE_CLIENT_ID') &&
      Deno.env.get('PHONEPE_CLIENT_SECRET') &&
      Deno.env.get('PHONEPE_CLIENT_VERSION'),
  )
}

export function phonepeMode(): PhonePeMode {
  return (Deno.env.get('PHONEPE_ENV') ?? 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox'
}

/** Base URL for the Standard Checkout APIs (payment + order status). */
function apiBase(): string {
  return phonepeMode() === 'production'
    ? 'https://api.phonepe.com/apis/pg'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox'
}

/** The OAuth endpoint lives on a different host from the payment APIs. */
function tokenUrl(): string {
  return phonepeMode() === 'production'
    ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token'
}

interface CachedToken {
  token: string
  /** Epoch milliseconds at which the token is no longer safe to use. */
  expiresAt: number
}

// Module-level cache: reused while the Edge Function isolate stays warm.
let cachedToken: CachedToken | null = null

/**
 * Returns a valid OAuth access token, refreshing it shortly before expiry.
 * Throws when the credentials are missing or PhonePe rejects them.
 */
async function accessToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.token

  const clientId = Deno.env.get('PHONEPE_CLIENT_ID')
  const clientSecret = Deno.env.get('PHONEPE_CLIENT_SECRET')
  const clientVersion = Deno.env.get('PHONEPE_CLIENT_VERSION')
  if (!clientId || !clientSecret || !clientVersion) {
    throw new Error('PhonePe credentials are not configured')
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_version: clientVersion,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  })

  const response = await fetch(tokenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.access_token) {
    console.error('phonepe auth failed', response.status, payload)
    throw new Error('Could not authenticate with the payment gateway')
  }

  const rawExpiresAt = Number(payload.expires_at)
  const expiresAt =
    Number.isFinite(rawExpiresAt) && rawExpiresAt > 0
      ? rawExpiresAt > 1e12
        ? rawExpiresAt
        : rawExpiresAt * 1000
      : now + Number(payload.expires_in ?? 3600) * 1000

  cachedToken = { token: String(payload.access_token), expiresAt }
  return cachedToken.token
}

/**
 * Authorised request that retries once when PhonePe rejects a cached token
 * (for example after a server-side revocation or clock skew).
 */
async function authorisedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = await accessToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `O-Bearer ${token}`)
  headers.set('Accept', 'application/json')

  let response = await fetch(`${apiBase()}${path}`, { ...init, headers })
  if (response.status === 401 || response.status === 403) {
    cachedToken = null
    token = await accessToken()
    headers.set('Authorization', `O-Bearer ${token}`)
    response = await fetch(`${apiBase()}${path}`, { ...init, headers })
  }
  return response
}

function clampExpireAfter(seconds: number | undefined): number {
  const value = Math.round(Number(seconds ?? 1800))
  if (!Number.isFinite(value)) return 1800
  return Math.min(2_592_000, Math.max(300, value))
}

/**
 * Creates a hosted-checkout order. The amount is always the server-calculated
 * fee, never a value supplied by the browser.
 */
export async function createPhonePeOrder(input: {
  merchantOrderId: string
  amountPaise: number
  redirectUrl: string
  expireAfterSeconds?: number
  message?: string
}): Promise<PhonePeOrder> {
  const amount = Math.round(Number(input.amountPaise))
  if (!Number.isFinite(amount) || amount < 100) {
    throw new Error('PhonePe requires an order amount of at least 100 paise')
  }

  const response = await authorisedFetch('/checkout/v2/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchantOrderId: input.merchantOrderId,
      amount,
      expireAfter: clampExpireAfter(input.expireAfterSeconds),
      paymentFlow: {
        type: 'PG_CHECKOUT',
        message: input.message ?? 'CDMAA registration fee',
        merchantUrls: { redirectUrl: input.redirectUrl },
      },
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.redirectUrl) {
    console.error('phonepe order creation failed', response.status, payload)
    throw new Error('Could not create the payment order. Please try again.')
  }

  return payload as PhonePeOrder
}

/**
 * Returns the PhonePe order for our merchant order id, or null when it cannot
 * be read. `details=true` returns every payment attempt, not just the latest.
 */
export async function fetchPhonePeOrder(merchantOrderId: string): Promise<PhonePeOrder | null> {
  if (!phonepeConfigured()) return null

  const response = await authorisedFetch(
    `/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=true`,
  )

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.state) {
    console.error('phonepe order lookup failed', response.status, payload)
    return null
  }

  return payload as PhonePeOrder
}

/** True only when PhonePe reports the order as fully paid. */
export function phonepeOrderPaid(order: PhonePeOrder | null): boolean {
  return (order?.state ?? '').toUpperCase() === 'COMPLETED'
}

/** Order amount in paise, or null when PhonePe did not include it. */
export function phonepeOrderAmountPaise(order: PhonePeOrder | null): number | null {
  if (!order || order.amount === undefined || order.amount === null) return null
  const amount = Math.round(Number(order.amount))
  return Number.isFinite(amount) ? amount : null
}

/**
 * Resolves the successful payment attempt for a completed order.
 *
 * Returns null when the order is not paid. `transactionId` may be null in the
 * rare case PhonePe reports the order as completed before the attempt detail
 * is readable — the capture is still valid, it just has no gateway reference.
 */
export function phonepePaidPayment(
  order: PhonePeOrder | null,
): { paymentId: string | null; method: string | null; amountPaise: number | null } | null {
  if (!phonepeOrderPaid(order)) return null

  const attempts = Array.isArray(order?.paymentDetails) ? order.paymentDetails : []
  const paid = attempts.find((p) => (p.state ?? '').toUpperCase() === 'COMPLETED') ?? null

  if (!paid) {
    return { paymentId: null, method: null, amountPaise: null }
  }

  return {
    paymentId: paid.transactionId ? String(paid.transactionId) : null,
    method: paid.paymentMode ? String(paid.paymentMode) : null,
    amountPaise:
      paid.amount === undefined || paid.amount === null ? null : Math.round(Number(paid.amount)),
  }
}

/** A short human-readable reason for a failed order, for logs and admin views. */
export function phonepeFailureReason(order: PhonePeOrder | null): string {
  const attempts = Array.isArray(order?.paymentDetails) ? order.paymentDetails : []
  const failed = attempts.find((p) => (p.state ?? '').toUpperCase() === 'FAILED')
  const code = order?.errorCode ?? failed?.errorCode
  const detailed = order?.detailedErrorCode ?? failed?.detailedErrorCode
  if (code && detailed) return `Payment failed at the gateway (${code}/${detailed})`
  if (code) return `Payment failed at the gateway (${code})`
  return 'Payment was not completed'
}

/** True when a pending order has passed its expiry timestamp. */
export function phonepeOrderExpired(order: PhonePeOrder | null): boolean {
  const expireAt = Number(order?.expireAt)
  if (!Number.isFinite(expireAt) || expireAt <= 0) return false
  return expireAt < Date.now()
}

/**
 * Public URL PhonePe returns the browser to after checkout.
 *
 * PhonePe treats `redirectUrl` as an opaque URL, so the merchant order id is
 * carried in the query string and recovered by `payment-callback`.
 */
export function phonepeReturnUrl(merchantOrderId: string): string {
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
  return `${base}/functions/v1/payment-callback?order_id=${encodeURIComponent(merchantOrderId)}`
}
