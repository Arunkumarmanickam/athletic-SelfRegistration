// Minimal QR rendering for the desktop payment hand-off.
//
// Desktop checkout is handed to the athlete's phone: the phone scans a QR that
// contains the PhonePe hosted-checkout URL, so the phone opens the normal mobile
// UPI flow. The QR is generated locally, so the payment link never leaves the
// browser except through the athlete's own camera.
import qrcode from 'qrcode-generator'

/**
 * Renders `value` as an inline SVG data URL. Returns null when the value is too
 * long for a QR code (a PhonePe checkout URL is well inside the limit).
 *
 * Error-correction level L is deliberate: it keeps the module count low so the
 * code stays easy to scan from a laptop screen. Screens have no physical wear,
 * so the extra redundancy of higher levels is not needed.
 */
export function qrDataUrl(value: string): string | null {
  if (!value) return null
  try {
    const qr = qrcode(0, 'L')
    qr.addData(value)
    qr.make()
    const svg = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true })
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  } catch {
    return null
  }
}
