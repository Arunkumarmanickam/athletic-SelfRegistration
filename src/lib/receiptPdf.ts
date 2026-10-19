// Generates the invoice receipt as a real PDF in the browser (A4, vector text)
// and downloads it. Loaded lazily so the main bundle stays lean.
import type { jsPDF as JsPdfType } from 'jspdf'
import type { Confirmation, PublicConfig } from '@/lib/types'
import { formatDate, formatDateTime, titleCase } from '@/lib/format'
import { amountInWords } from '@/lib/amountWords'

const M = 14
const RIGHT = 196
const WIDTH = RIGHT - M

const COLORS = {
  ink: [15, 23, 42] as [number, number, number],
  body: [51, 65, 85] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  faint: [148, 163, 184] as [number, number, number],
  line: [226, 232, 240] as [number, number, number],
  band: [241, 245, 249] as [number, number, number],
  orange: [234, 88, 12] as [number, number, number],
  green: [4, 120, 87] as [number, number, number],
  greenBg: [236, 253, 245] as [number, number, number],
  greenBorder: [167, 243, 208] as [number, number, number],
}

function money(paise: number, currency: string): string {
  const amount = (paise ?? 0) / 100
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
  return `${currency === 'INR' ? 'Rs.' : currency} ${formatted}`
}

function receiptLines(confirmation: Confirmation) {
  const { registration } = confirmation
  const events = registration.registration_events ?? []
  const eventFeeTotal = events.reduce((sum, event) => sum + (event.fee_paise ?? 0), 0)
  const itemised = eventFeeTotal > 0
  const lines = itemised
    ? events.map((event) => ({
        label: event.event_name,
        note: 'Event entry',
        amount: event.fee_paise ?? 0,
      }))
    : [
        {
          label: events.length
            ? `Event entries — ${events.map((event) => event.event_name).join(', ')}`
            : 'Registration fee',
          note: events.length ? `${events.length} event${events.length === 1 ? '' : 's'}` : 'Championship entry',
          amount: registration.fee_paise,
        },
      ]
  const lineTotal = lines.reduce((sum, line) => sum + line.amount, 0)
  const adjustment = registration.fee_paise - lineTotal
  if (adjustment !== 0) {
    lines.push({ label: 'Other charges / adjustment', note: '', amount: adjustment })
  }
  return lines
}

export async function buildReceiptPdf(
  confirmation: Confirmation,
  site?: PublicConfig['site'],
): Promise<JsPdfType> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })

  const { registration, payments } = confirmation
  const champion = registration.championships
  const category = registration.championship_categories
  const profile = registration.athlete_profiles
  const events = registration.registration_events ?? []
  const organizer = site?.organizer_name?.trim() || 'Championship organiser'
  const contact = [site?.support_email, site?.support_phone].filter(Boolean).join(' · ')
  const currency = registration.currency || 'INR'
  const capturedPayment =
    payments.find((payment) => payment.status === 'captured') ?? payments[0] ?? null
  const paid = registration.payment_status === 'paid' || capturedPayment?.status === 'captured'
  const issuedAt = registration.confirmed_at ?? capturedPayment?.verified_at ?? registration.registered_at
  const dates = champion?.starts_on
    ? `${formatDate(champion.starts_on)}${
        champion.ends_on && champion.ends_on !== champion.starts_on ? ` – ${formatDate(champion.ends_on)}` : ''
      }`
    : '—'

  const text = (value: string, width: number) => doc.splitTextToSize(value, width) as string[]

  // Letterhead -----------------------------------------------------------------
  doc.setFillColor(...COLORS.orange)
  doc.rect(0, 0, 210, 2.6, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...COLORS.ink)
  const orgLines = text(organizer, 105)
  doc.text(orgLines, M, 17)
  let leftY = 17 + (orgLines.length - 1) * 6 + 5

  if (site?.address) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COLORS.muted)
    const address = text(site.address, 95)
    doc.text(address, M, leftY)
    leftY += (address.length - 1) * 3.6 + 3.4
  }
  if (contact) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COLORS.muted)
    doc.text(contact, M, leftY)
    leftY += 3.6
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...COLORS.orange)
  doc.setCharSpace(0.7)
  doc.text('PAYMENT RECEIPT / INVOICE', RIGHT, 15, { align: 'right' })
  doc.setCharSpace(0)

  doc.setFontSize(17)
  doc.setTextColor(...COLORS.ink)
  doc.text(registration.registration_code, RIGHT, 22.5, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.muted)
  doc.text(`Issued ${formatDateTime(issuedAt)}`, RIGHT, 27.5, { align: 'right' })

  const badge = (label: string, xRight: number, y: number, kind: 'paid' | 'status') => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.8)
    const width = doc.getTextWidth(label) + 5
    const x = xRight - width
    if (kind === 'paid') {
      doc.setFillColor(...COLORS.greenBg)
      doc.setDrawColor(...COLORS.greenBorder)
      doc.setTextColor(...COLORS.green)
    } else {
      doc.setFillColor(...COLORS.band)
      doc.setDrawColor(...COLORS.line)
      doc.setTextColor(...COLORS.muted)
    }
    doc.setLineWidth(0.2)
    doc.roundedRect(x, y, width, 5, 0.8, 0.8, 'FD')
    doc.text(label, x + width / 2, y + 3.4, { align: 'center' })
    return x - 1.6
  }
  let badgeX = badge(titleCase(registration.status).toUpperCase(), RIGHT, 31, 'status')
  badgeX = badge(paid ? 'PAID' : titleCase(registration.payment_status).toUpperCase(), badgeX, 31, 'paid')

  const dividerY = Math.max(leftY + 2, 38) + 3
  doc.setDrawColor(...COLORS.line)
  doc.setLineWidth(0.3)
  doc.line(M, dividerY, RIGHT, dividerY)

  // Parties --------------------------------------------------------------------
  const label = (value: string, x: number, y: number, align: 'left' | 'right' = 'left') => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.4)
    doc.setTextColor(...COLORS.faint)
    doc.setCharSpace(0.35)
    doc.text(value.toUpperCase(), x, y, { align })
    doc.setCharSpace(0)
  }

  const colTop = dividerY + 7
  label('Billed to', M, colTop - 2.6)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11.5)
  doc.setTextColor(...COLORS.ink)
  doc.text(profile?.full_name ?? '—', M, colTop + 3.6)

  const leftField = (field: string, value: string, y: number) => {
    label(field, M, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.6)
    doc.setTextColor(...COLORS.body)
    const lines = text(value, 84)
    doc.text(lines, M, y + 4)
    return y + 4 + (lines.length - 1) * 3.7 + 3.8
  }

  let leftBottom = colTop + 6
  leftBottom = leftField('Athlete ID', profile?.athlete_id ?? '—', leftBottom)
  if (profile?.mobile_e164) leftBottom = leftField('Mobile', profile.mobile_e164, leftBottom)
  if (profile?.email) leftBottom = leftField('Email', profile.email, leftBottom)
  if (profile?.state || profile?.district) {
    leftBottom = leftField('Representing', [profile?.district, profile?.state].filter(Boolean).join(', '), leftBottom)
  }

  label('Registration details', RIGHT, colTop - 2.6, 'right')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...COLORS.ink)
  doc.text(`Bib ${registration.bib_number ?? '—'}`, RIGHT, colTop + 4.4, { align: 'right' })

  const rightField = (field: string, value: string, y: number) => {
    label(field, RIGHT, y, 'right')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.6)
    doc.setTextColor(...COLORS.body)
    const lines = text(value, 88)
    doc.text(lines, RIGHT, y + 4, { align: 'right' })
    return y + 4 + (lines.length - 1) * 3.7 + 3.8
  }

  let rightBottom = colTop + 7.5
  rightBottom = rightField('Championship', champion?.name ?? '—', rightBottom)
  rightBottom = rightField('Category', category?.name ?? '—', rightBottom)
  rightBottom = rightField('Events', String(events.length), rightBottom)
  rightBottom = rightField('Championship dates', dates, rightBottom)
  if (champion?.location) rightBottom = rightField('Venue', champion.location, rightBottom)

  // Itemised entries -----------------------------------------------------------
  const lines = receiptLines(confirmation)
  let tableY = Math.max(leftBottom, rightBottom) + 7

  doc.setFillColor(...COLORS.band)
  doc.rect(M, tableY, WIDTH, 7, 'F')
  label('#', M + 3, tableY + 4.5)
  label('Particulars', M + 11, tableY + 4.5)
  label('Amount', RIGHT - 3, tableY + 4.5, 'right')
  tableY += 7

  doc.setDrawColor(...COLORS.line)
  doc.setLineWidth(0.2)
  lines.forEach((line, index) => {
    const labelLines = text(line.label, 118)
    const rowHeight = Math.max(7.2, labelLines.length * 3.8 + (line.note ? 3.6 : 0) + 3)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...COLORS.faint)
    doc.text(String(index + 1), M + 3, tableY + 4.4)

    doc.setTextColor(...COLORS.ink)
    doc.text(labelLines, M + 11, tableY + 4.4)
    if (line.note) {
      doc.setFontSize(7)
      doc.setTextColor(...COLORS.muted)
      doc.text(line.note, M + 11, tableY + 4.4 + labelLines.length * 3.8)
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...COLORS.ink)
    doc.text(money(line.amount, currency), RIGHT - 3, tableY + 4.4, { align: 'right' })

    doc.line(M, tableY + rowHeight, RIGHT, tableY + rowHeight)
    tableY += rowHeight
  })

  // Totals ---------------------------------------------------------------------
  let totalsY = tableY + 6
  const totalX = RIGHT - 72
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...COLORS.body)
  doc.text('Subtotal', totalX, totalsY)
  doc.text(money(registration.fee_paise, currency), RIGHT - 3, totalsY, { align: 'right' })
  totalsY += 5
  doc.text('Tax / processing fee', totalX, totalsY)
  doc.text(money(0, currency), RIGHT - 3, totalsY, { align: 'right' })

  totalsY += 3
  doc.setFillColor(...COLORS.ink)
  doc.roundedRect(totalX, totalsY, 72, 9.5, 1, 1, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(255, 255, 255)
  doc.text(`Total ${paid ? 'paid' : 'due'}`, totalX + 4, totalsY + 6)
  doc.text(money(registration.fee_paise, currency), RIGHT - 4, totalsY + 6, { align: 'right' })

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7)
  doc.setTextColor(...COLORS.muted)
  doc.text(text(`Amount in words: ${amountInWords(registration.fee_paise)}`, 100), RIGHT, totalsY + 15, {
    align: 'right',
  })

  // Payment record -------------------------------------------------------------
  const boxY = totalsY + 20
  const boxHeight = 38
  doc.setDrawColor(...COLORS.line)
  doc.setLineWidth(0.3)
  doc.roundedRect(M, boxY, WIDTH, boxHeight, 1.5, 1.5, 'S')

  label('Payment record', M + 4, boxY + 5.5)

  const paymentRows: [string, string][] = capturedPayment
    ? [
        ['Amount', money(capturedPayment.amount_paise, capturedPayment.currency)],
        ['Status', titleCase(capturedPayment.status)],
        ['Method', capturedPayment.method ? titleCase(capturedPayment.method) : '—'],
        ['Verified on', capturedPayment.verified_at ? formatDateTime(capturedPayment.verified_at) : '—'],
        ['Razorpay payment ID', capturedPayment.razorpay_payment_id ?? '—'],
        ['Order reference', capturedPayment.razorpay_order_id],
        ['Registered on', formatDateTime(registration.registered_at)],
        ['Confirmed on', registration.confirmed_at ? formatDateTime(registration.confirmed_at) : 'Not confirmed yet'],
      ]
    : [['Payment', 'No payment record attached']]

  const columnWidth = (WIDTH - 8) / 2
  paymentRows.forEach(([field, value], index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = M + 4 + column * (columnWidth + 4)
    const y = boxY + 11 + row * 7

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.2)
    doc.setTextColor(...COLORS.faint)
    doc.setCharSpace(0.3)
    doc.text(field.toUpperCase(), x, y)
    doc.setCharSpace(0)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COLORS.body)
    const valueLines = text(value, columnWidth)
    doc.text(valueLines[0] ?? '—', x, y + 3.6)
  })

  // Footer ---------------------------------------------------------------------
  const footerY = boxY + boxHeight + 8
  doc.setDrawColor(...COLORS.line)
  doc.setLineWidth(0.3)
  doc.line(M, footerY, RIGHT, footerY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.9)
  doc.setTextColor(...COLORS.muted)
  doc.text(
    text(
      'This is a computer-generated receipt for a payment verified by our server with the payment gateway. Please carry the bib number above on event day. For any correction, contact the organiser quoting the receipt number.',
      118,
    ),
    M,
    footerY + 5,
  )

  doc.setDrawColor(...COLORS.faint)
  doc.line(RIGHT - 45, footerY + 13, RIGHT, footerY + 13)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.2)
  doc.setTextColor(...COLORS.muted)
  doc.setCharSpace(0.35)
  doc.text('AUTHORISED SIGNATORY', RIGHT - 22.5, footerY + 17, { align: 'center' })
  doc.setCharSpace(0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(organizer, RIGHT - 22.5, footerY + 20.5, { align: 'center', maxWidth: 45 })

  return doc
}

export async function downloadReceiptPdf(
  confirmation: Confirmation,
  site?: PublicConfig['site'],
): Promise<void> {
  const doc = await buildReceiptPdf(confirmation, site)
  doc.save(`Receipt-${confirmation.registration.registration_code}.pdf`)
}
