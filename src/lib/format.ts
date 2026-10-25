// Formatting helpers shared by the public site, admin dashboard and receipts.

export function formatMoney(paise: number, currency = 'INR'): string {
  const amount = (paise ?? 0) / 100
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatAge(dob: string | null | undefined, on?: string): string {
  if (!dob) return '—'
  const birth = new Date(`${dob}T00:00:00`)
  const target = on ? new Date(`${on}T00:00:00`) : new Date()
  if (Number.isNaN(birth.getTime())) return '—'
  let age = target.getFullYear() - birth.getFullYear()
  const monthDiff = target.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && target.getDate() < birth.getDate())) age -= 1
  return age >= 0 ? String(age) : '—'
}

export function genderLabel(gender: string | null | undefined): string {
  switch (gender) {
    case 'male':
      return 'Men'
    case 'female':
      return 'Women'
    case 'other':
      return 'Other'
    case 'any':
      return 'Any'
    default:
      return '—'
  }
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '—'
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ')
}

/**
 * How an athlete's "representing" answer reads on a receipt.
 *
 * District meets store the academy/club (or "Individual"), state meets store
 * the district, and national meets store the state or region. Historic
 * state-meet rows keep the district in `representing`, so the state is shown
 * alongside it the way receipts always have.
 */
export function representingText(
  profile:
    | { representing?: string | null; district?: string | null; state?: string | null }
    | null
    | undefined,
): string {
  if (!profile) return ''
  const representing = (profile.representing ?? '').trim()
  const district = (profile.district ?? '').trim()
  const state = (profile.state ?? '').trim()
  if (representing) {
    const isDistrict =
      Boolean(district) && representing.toLowerCase() === district.toLowerCase()
    return isDistrict && state ? `${representing}, ${state}` : representing
  }
  return [district, state].filter(Boolean).join(', ')
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'

export function paymentStatusTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case 'paid':
      return 'success'
    case 'pending':
      return 'warning'
    case 'failed':
      return 'danger'
    case 'cancelled':
    case 'refunded':
      return 'neutral'
    default:
      return 'neutral'
  }
}

/**
 * Status of a pre-payment application (a registration draft). These labels
 * deliberately avoid "registration" and "bib" language: neither exists yet.
 */
export function applicationStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'pending':
      return 'Pending payment'
    case 'failed':
      return 'Payment failed'
    case 'abandoned':
      return 'Abandoned'
    case 'started':
      return 'Not paid'
    case 'paid':
      return 'Payment captured'
    default:
      return '—'
  }
}

export function applicationStatusTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case 'pending':
      return 'warning'
    case 'failed':
      return 'danger'
    case 'abandoned':
      return 'neutral'
    case 'started':
      return 'info'
    case 'paid':
      return 'success'
    default:
      return 'neutral'
  }
}

export function registrationStatusTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case 'confirmed':
      return 'success'
    case 'pending':
      return 'warning'
    case 'cancelled':
    case 'withdrawn':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export function championshipStatusTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case 'open':
      return 'success'
    case 'draft':
      return 'info'
    case 'closed':
      return 'warning'
    case 'archived':
      return 'neutral'
    default:
      return 'neutral'
  }
}

/** Converts a date input value to a readable label, avoiding timezone drift. */
export function isoDateToDisplay(value: string): string {
  if (!value) return ''
  const [y, m, d] = value.split('-')
  if (!y || !m || !d) return value
  return `${d}-${m}-${y}`
}

/**
 * Builds an E.164 phone number from a dial code and a local number. Keeps a
 * single leading "+" and strips everything that is not a digit.
 */
export function toE164(countryCode: string, number: string): string {
  const digits = `${countryCode}${number}`.replace(/[^\d+]/g, '')
  if (!digits) return ''
  return digits.startsWith('+') ? digits : `+${digits}`
}

/** Masks an E.164 mobile for display: +919876543210 -> +91987****10 */
export function maskMobile(e164: string | null | undefined): string {
  const value = e164 ?? ''
  if (value.length <= 4) return value ? '****' : '—'
  const keepStart = Math.min(5, value.length - 4)
  return `${value.slice(0, keepStart)}${'*'.repeat(value.length - keepStart - 4)}${value.slice(-4)}`
}
