import type { PublicConfig } from './types'

type SiteContact = Pick<PublicConfig['site'], 'support_phone' | 'support_phones'>

/**
 * Splits whatever the organiser typed into individual numbers.
 *
 * Older settings stored every number in a single comma-separated
 * `support_phone` string (e.g. "9600663369,9442582787"). Treat commas,
 * semicolons and line breaks as separators so both shapes render correctly.
 */
export function splitPhones(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => splitPhones(entry))
  return String(value ?? '')
    .split(/[,;\n]+/)
    .map((phone) => phone.trim())
    .filter(Boolean)
}

/**
 * Every support phone number the organiser has published.
 *
 * `support_phones` is the list the admin settings screen writes. It falls back
 * to the legacy `support_phone` field so settings saved before the list existed
 * still display.
 */
export function supportPhones(site?: SiteContact | null): string[] {
  const list = splitPhones(site?.support_phones)
  if (list.length > 0) return list

  return splitPhones(site?.support_phone)
}

/** `tel:` link for a display-formatted number, e.g. "+91 98765 43210". */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}
