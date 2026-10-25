import type { Confirmation, PublicConfig } from '@/lib/types'
import { formatDate, formatDateTime, formatMoney, titleCase } from '@/lib/format'
import { amountInWords } from '@/lib/amountWords'

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-800">{value}</dd>
    </div>
  )
}

interface ReceiptInvoiceProps {
  confirmation: Confirmation
  site?: PublicConfig['site']
}

/**
 * The printable receipt, laid out as an invoice/bill: organiser header,
 * billed-to block, itemised event entries, totals and payment record.
 *
 * Kept free of app chrome so `window.print()` (or "Save as PDF") produces the
 * document on its own, on white, with no navigation or buttons.
 */
export function ReceiptInvoice({ confirmation, site }: ReceiptInvoiceProps) {
  const { registration, payments } = confirmation
  const champion = registration.championships
  const category = registration.championship_categories
  const profile = registration.athlete_profiles
  const events = registration.registration_events ?? []
  const organizer = site?.organizer_name?.trim() || 'Championship organiser'
  const contact = [site?.support_email, site?.support_phone].filter(Boolean).join(' · ')

  const capturedPayment = payments.find((payment) => payment.status === 'captured') ?? payments[0] ?? null
  const paid = registration.payment_status === 'paid' || capturedPayment?.status === 'captured'

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
          label: events.length ? `Event entries — ${events.map((event) => event.event_name).join(', ')}` : 'Registration fee',
          note: events.length ? `${events.length} event${events.length === 1 ? '' : 's'}` : 'Championship entry',
          amount: registration.fee_paise,
        },
      ]
  const lineTotal = lines.reduce((sum, line) => sum + line.amount, 0)
  const adjustment = registration.fee_paise - lineTotal
  if (adjustment !== 0) {
    lines.push({ label: 'Other charges / adjustment', note: '', amount: adjustment })
  }
  const currency = registration.currency || 'INR'
  const issuedAt = registration.confirmed_at ?? capturedPayment?.verified_at ?? registration.registered_at
  const dates = champion?.starts_on
    ? `${formatDate(champion.starts_on)}${
        champion.ends_on && champion.ends_on !== champion.starts_on ? ` – ${formatDate(champion.ends_on)}` : ''
      }`
    : '—'

  return (
    <article className="print-sheet overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
      <div className="h-1.5 bg-orange-500" />
      <div className="px-6 py-4 sm:px-8 sm:py-5">
        {/* Organiser + receipt identity */}
        <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold tracking-wide text-orange-400">
              {organizer
                .split(/\s+/)
                .slice(0, 2)
                .map((word) => word[0]?.toUpperCase() ?? '')
                .join('') || 'AR'}
            </span>
            <div className="min-w-0">
              <p className="text-lg font-bold leading-tight break-words text-slate-900">{organizer}</p>
              {site?.address && (
                <p className="mt-1 max-w-xs text-xs leading-relaxed break-words text-slate-500">{site.address}</p>
              )}
              {contact && <p className="mt-1 text-xs break-words text-slate-500">{contact}</p>}
            </div>
          </div>

          <div className="min-w-0 text-left sm:max-w-[52%] sm:text-right">
            <p className="text-[9px] font-semibold uppercase leading-tight tracking-[0.12em] break-words text-orange-600">
              Payment receipt / invoice
            </p>
            <p className="mt-1.5 font-mono text-xl font-bold tracking-tight break-all text-slate-900">
              {registration.registration_code}
            </p>
            <p className="mt-1 text-xs break-words text-slate-500">Issued {formatDateTime(issuedAt)}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 sm:justify-end">
              <span className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap text-emerald-700">
                {paid ? 'Paid' : titleCase(registration.payment_status)}
              </span>
              <span className="rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap text-slate-600">
                {titleCase(registration.status)}
              </span>
            </div>
          </div>
        </header>

        <div className="my-3 border-t border-slate-200" />

        {/* Parties and registration facts */}
        <section className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Billed to</p>
            <p className="text-base font-bold text-slate-900">{profile?.full_name ?? '—'}</p>
            <dl className="mt-2 grid gap-2">
              <Detail label="Athlete ID" value={profile?.athlete_id ?? '—'} />
              {profile?.mobile_e164 && <Detail label="Mobile" value={profile.mobile_e164} />}
              {profile?.email && <Detail label="Email" value={profile.email} />}
              {(profile?.state || profile?.district) && (
                <Detail
                  label="Representing"
                  value={[profile?.district, profile?.state].filter(Boolean).join(', ')}
                />
              )}
            </dl>
          </div>

          <div className="sm:text-right">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Registration details
            </p>
            <p className="text-2xl font-bold leading-none tracking-tight text-slate-900">
              Bib {registration.bib_number ?? '—'}
            </p>
            <dl className="mt-2 grid gap-2">
              <Detail label="Championship" value={champion?.name ?? '—'} />
              <Detail label="Category" value={category?.name ?? '—'} />
              <Detail label="Events" value={String(events.length)} />
              <Detail label="Championship dates" value={dates} />
              {champion?.location && <Detail label="Venue" value={champion.location} />}
            </dl>
          </div>
        </section>

        {/* Itemised entries */}
        <section className="mt-4">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-slate-200 bg-slate-50 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                <th className="w-8 py-2 pl-3 font-semibold">#</th>
                <th className="py-2 font-semibold">Particulars</th>
                <th className="py-2 text-right font-semibold">Amount</th>
                <th className="w-4" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={`${line.label}-${index}`} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 pl-3 text-xs text-slate-400">{index + 1}</td>
                  <td className="py-1.5 pr-3">
                    <p className="font-medium text-slate-800">{line.label}</p>
                    {line.note && <p className="text-xs text-slate-500">{line.note}</p>}
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-right font-medium tabular-nums text-slate-800">
                    {formatMoney(line.amount, currency)}
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-2 flex flex-col items-end">
            <div className="w-full max-w-[280px] space-y-1 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatMoney(registration.fee_paise, currency)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Tax / processing fee</span>
                <span className="tabular-nums">{formatMoney(0, currency)}</span>
              </div>
              <div className="mt-1 flex justify-between rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white">
                <span>Total {paid ? 'paid' : 'due'}</span>
                <span className="tabular-nums">{formatMoney(registration.fee_paise, currency)}</span>
              </div>
            </div>
            <p className="mt-2 max-w-[340px] text-right text-xs italic text-slate-500">
              Amount in words: {amountInWords(registration.fee_paise)}
            </p>
          </div>
        </section>

        {/* Payment record */}
        <section className="mt-4 rounded-lg border border-slate-200 p-3">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Payment record</p>
          {capturedPayment ? (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Detail label="Amount" value={formatMoney(capturedPayment.amount_paise, capturedPayment.currency)} />
              <Detail label="Status" value={titleCase(capturedPayment.status)} />
              <Detail label="Method" value={capturedPayment.method ? titleCase(capturedPayment.method) : '—'} />
              <Detail
                label="Verified on"
                value={capturedPayment.verified_at ? formatDateTime(capturedPayment.verified_at) : '—'}
              />
              <Detail label="Cashfree payment ID" value={capturedPayment.razorpay_payment_id ?? '—'} />
              <Detail label="Order reference" value={capturedPayment.razorpay_order_id} />
              <Detail label="Registered on" value={formatDateTime(registration.registered_at)} />
              <Detail
                label="Confirmed on"
                value={registration.confirmed_at ? formatDateTime(registration.confirmed_at) : 'Not confirmed yet'}
              />
            </dl>
          ) : (
            <p className="text-sm text-slate-600">No payment record is attached to this registration.</p>
          )}

          {payments.length > 1 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                    <th className="py-2 pr-3 font-semibold">Date</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 text-right font-semibold">Amount</th>
                    <th className="py-2 font-semibold">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment, index) => (
                    <tr
                      key={`${payment.razorpay_payment_id ?? payment.razorpay_order_id}-${index}`}
                      className="border-b border-slate-100 text-slate-700"
                    >
                      <td className="py-2 pr-3">{payment.verified_at ? formatDateTime(payment.verified_at) : '—'}</td>
                      <td className="py-2 pr-3">{titleCase(payment.status)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatMoney(payment.amount_paise, payment.currency)}
                      </td>
                      <td className="py-2 font-mono text-xs">{payment.razorpay_payment_id ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="mt-4 flex flex-col gap-6 border-t border-slate-200 pt-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="max-w-sm">
            <p className="text-xs leading-relaxed break-words text-slate-500">
              This is a computer-generated receipt for a payment verified by our server with the payment gateway. Please
              carry the bib number above on event day. For any correction, contact the organiser quoting the receipt
              number.
            </p>
          </div>
          <div className="shrink-0 text-center">
            <div className="mx-auto mb-1 h-8 w-36 border-b border-slate-300" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Authorised signatory
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">For {organizer}</p>
          </div>
        </footer>
      </div>
    </article>
  )
}
