// Small shared helpers: input extraction, validation primitives, rate limiting.

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}

/** Loose E.164 check: + followed by 8..15 digits. */
export function isE164(value: string): boolean {
  return /^\+?[1-9]\d{7,14}$/.test(value)
}

export function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value)
}

export function randomDigits(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b % 10).join('')
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Reads the athlete session token from the body or the request header. */
export function sessionToken(req: Request, body: Record<string, unknown> = {}): string {
  const fromBody = str(body.athleteSessionToken)
  if (fromBody) return fromBody
  return (req.headers.get('x-athlete-session') ?? '').trim()
}

/** Cryptographically random password for newly created admin accounts. */
export function randomPassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

/** Mask a mobile number for display: +9198765***** -> +919876*****78 */
export function maskMobile(e164: string): string {
  if (e164.length <= 4) return '****'
  const keepStart = Math.min(5, e164.length - 4)
  return e164.slice(0, keepStart) + '*'.repeat(e164.length - keepStart - 4) + e164.slice(-4)
}

export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts
    .map((p) => (p.length <= 1 ? p : p[0] + '*'.repeat(Math.min(p.length - 1, 5))))
    .join(' ')
}

export class RateLimitError extends Error {
  constructor() {
    super('Too many attempts. Please try again later.')
    this.name = 'RateLimitError'
  }
}

/**
 * Fixed-window rate limiter backed by Postgres. Throws RateLimitError when the
 * caller exceeded `limit` requests inside `windowSeconds`.
 */
export async function enforceRateLimit(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) {
    console.error('rate limit check failed', error)
    return // fail open: a limiter outage must not block registrations
  }
  if (data !== true) throw new RateLimitError()
}
