// Stores the most recent verified-payment confirmation so the printable
// receipt page (/registration/success) survives a refresh. sessionStorage is
// cleared when the tab closes, which is the intended lifetime for a receipt.
import type { Confirmation } from './types'

const KEY = 'arp:last-confirmation:v1'

export function saveConfirmation(confirmation: Confirmation): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(confirmation))
  } catch {
    /* storage may be unavailable (private mode): the receipt is best-effort */
  }
}

export function loadConfirmation(): Confirmation | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as Confirmation
  } catch {
    return null
  }
}

export function clearConfirmation(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
