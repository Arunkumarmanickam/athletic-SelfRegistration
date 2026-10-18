import { Link } from 'react-router-dom'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { useConfig } from '@/context/ConfigContext'
import { loadConfirmation } from '@/lib/receipt'
import {
  formatDate,
  formatDateTime,
  formatMoney,
  paymentStatusTone,
  registrationStatusTone,
  titleCase,
} from '@/lib/format'

/**
 * Printable receipt shown after a payment is verified on the server.
 *
 * It reads the confirmation that `verify-payment` returned and the browser
 * stashed in sessionStorage, so a refresh keeps the receipt but closing the tab
 * clears it. If the record is missing (for example the athlete opened this URL
 * directly) we send them to the status page instead of inventing data.
 */
export function SuccessPage() {
  const { config } = useConfig()
  const confirmation = loadConfirmation()

  if (!confirmation) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <Card className="print-plain">
          <CardHeader>
            <CardTitle>Receipt not available in this tab</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              For your privacy, a receipt is only kept for the current browser tab. If you have just paid, you can look
              up your registration again with your Registration ID (bib number) and registered mobile number.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/status">
                <Button variant="accent">Look up my registration</Button>
              </Link>
              <Link to="/returning">
                <Button variant="outline">Retrieve my athlete details</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { registration, payments } = confirmation
  const champion = registration.championships
  const category = registration.championship_categories
  const profile = registration.athlete_profiles
  const events = (registration.registration_events ?? []).map((event) => event.event_name)
  const capturedPayment =
    payments.find((payment) => payment.status === 'captured') ?? payments[0] ?? null
  const organizer = config?.site?.organizer_name?.trim()

  const detailRows: [string, string][] = [
    ['Athlete', profile?.full_name ?? '—'],
    ['Athlete ID', profile?.athlete_id ?? '—'],
    ['Registration reference', registration.registration_code],
    ['Bib number', registration.bib_number ?? 'Issued after payment'],
    ['Championship', champion?.name ?? '—'],
    ['Category', category?.name ?? '—'],
    ['Events', events.join(', ') || '—'],
    [
      'Championship dates',
      champion?.starts_on
        ? `${formatDate(champion.starts_on)}${champion.ends_on && champion.ends_on !== champion.starts_on ? ` – ${formatDate(champion.ends_on)}` : ''}`
        : '—',
    ],
    ['Venue', champion?.location ?? '—'],
    ['Registered on', formatDateTime(registration.registered_at)],
    [
      'Confirmed on',
      registration.confirmed_at ? formatDateTime(registration.confirmed_at) : 'Not confirmed yet',
    ],
    ['Fee', formatMoney(registration.fee_paise, registration.currency)],
  ]

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 print-full sm:py-14">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print-hide">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-orange-600">Payment received</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">Registration confirmed</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => window.print()}>
            Print receipt
          </Button>
          <Link to="/status">
            <Button variant="ghost">Check status</Button>
          </Link>
        </div>
      </div>

      <Alert tone="success" title="Thank you — your entry is confirmed" className="print-plain print-hide">
        A confirmation has been recorded against your Athlete ID. Keep this receipt safe; you may need your
        Registration ID (bib number) on event day.
      </Alert>

      <Card className="mt-5 print-plain">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Receipt for {registration.registration_code}</CardTitle>
              {organizer && <p className="mt-1 text-sm text-slate-600">{organizer}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={registrationStatusTone(registration.status)}>
                {titleCase(registration.status)}
              </Badge>
              <Badge tone={paymentStatusTone(registration.payment_status)}>
                Payment: {titleCase(registration.payment_status)}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            {detailRows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="mt-0.5 font-medium text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card className="mt-5 print-plain">
        <CardHeader>
          <CardTitle>Payment</CardTitle>
        </CardHeader>
        <CardContent>
          {capturedPayment ? (
            <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              {(
                [
                  ['Amount paid', formatMoney(capturedPayment.amount_paise, capturedPayment.currency)],
                  ['Status', titleCase(capturedPayment.status)],
                  ['Method', capturedPayment.method ? titleCase(capturedPayment.method) : '—'],
                  [
                    'Verified on',
                    capturedPayment.verified_at ? formatDateTime(capturedPayment.verified_at) : '—',
                  ],
                  ['Razorpay payment ID', capturedPayment.razorpay_payment_id ?? '—'],
                  ['Order reference', capturedPayment.razorpay_order_id],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                  <dd className="mt-0.5 break-all font-mono text-xs text-slate-800 sm:text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-slate-600">No payment record is attached to this confirmation.</p>
          )}

          {payments.length > 1 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment, index) => (
                    <tr key={`${payment.razorpay_payment_id ?? payment.razorpay_order_id}-${index}`} className="border-b border-slate-100">
                      <td className="py-2 pr-3 text-slate-700">
                        {payment.verified_at ? formatDateTime(payment.verified_at) : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={paymentStatusTone(payment.status)}>{titleCase(payment.status)}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-slate-700">
                        {formatMoney(payment.amount_paise, payment.currency)}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs text-slate-600">
                        {payment.razorpay_payment_id ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-5 text-xs text-slate-500">
        This receipt confirms a payment verified by our server with the payment gateway. Retain it for your records.
        For any correction, contact the organiser with the Registration ID above.
      </p>

      <div className="mt-6 flex flex-wrap gap-3 print-hide">
        <Link to="/register">
          <Button variant="accent">Register for another championship</Button>
        </Link>
        <Link to="/">
          <Button variant="outline">Back to home</Button>
        </Link>
      </div>
    </div>
  )
}
