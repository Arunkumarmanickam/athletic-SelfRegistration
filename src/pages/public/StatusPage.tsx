import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input, useFieldId } from '@/components/ui/input'
import { Select } from '@/components/ui/form-controls'
import { ApiError, lookupRegistrationStatus } from '@/lib/api'
import { COUNTRY_CODES } from '@/lib/constants'
import {
  formatDate,
  formatDateTime,
  formatMoney,
  paymentStatusTone,
  registrationStatusTone,
  titleCase,
  toE164,
} from '@/lib/format'

type LookupResult = Awaited<ReturnType<typeof lookupRegistrationStatus>>

export function StatusPage() {
  const location = useLocation()

  const [registrationCode, setRegistrationCode] = useState('')
  const [countryCode, setCountryCode] = useState('+91')
  const [mobileNumber, setMobileNumber] = useState('')
  const [loading, setLoading] = useState(false)
  // A redirect-based payment that came back but could not be verified is
  // reported here by PaymentReturnGate.
  const [error, setError] = useState<string | null>(
    (location.state as { paymentError?: string } | null)?.paymentError ?? null,
  )
  const [result, setResult] = useState<LookupResult | null>(null)

  const codeField = useFieldId('registration_code')
  const mobileField = useFieldId('status_mobile')

  const mobileE164 = toE164(countryCode, mobileNumber)

  const handleLookup = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setResult(null)

    if (registrationCode.trim().length < 3) {
      setError('Please enter your Registration ID / bib number.')
      return
    }
    if (mobileE164.length < 8) {
      setError('Please enter the mobile number you registered with.')
      return
    }

    setLoading(true)
    try {
      const response = await lookupRegistrationStatus({
        registrationCode: registrationCode.trim(),
        mobileE164,
      })
      setResult(response)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not look up that registration. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Check registration status</h1>
      <p className="mt-2 text-sm text-slate-600">
        Enter your Registration ID (for example <span className="font-mono">R000013</span>) or your bib number (for
        example <span className="font-mono">W7001</span>), together with the mobile number you registered with. For
        your privacy, both must match.
      </p>

      <Card className="mt-6">
        <CardContent className="pt-5">
          <form onSubmit={handleLookup} className="grid gap-5 sm:grid-cols-2" noValidate>
            <Field
              label="Registration ID or bib number"
              htmlFor={codeField}
              required
              className="sm:col-span-2"
              hint="Either works. Example: R000013 or W7001"
            >
              <Input
                id={codeField}
                value={registrationCode}
                onChange={(event) => setRegistrationCode(event.target.value)}
                autoComplete="off"
                placeholder="M60103"
              />
            </Field>
            <Field label="Mobile country code" htmlFor={`${mobileField}-cc`} required>
              <Select id={`${mobileField}-cc`} value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
                {COUNTRY_CODES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Registered mobile number" htmlFor={mobileField} required>
              <Input
                id={mobileField}
                type="tel"
                inputMode="numeric"
                value={mobileNumber}
                onChange={(event) => setMobileNumber(event.target.value.replace(/[^\d]/g, ''))}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" variant="accent" loading={loading}>
                Check status
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Alert tone="danger" className="mt-5" title="No match found">
          {error}
        </Alert>
      )}

      {result && (
        <div className="mt-6 space-y-5">
          {result.multiple && (
            <Alert tone="info" title="More than one registration uses this mobile number">
              The details below are the {result.registrations.length} registrations that match what you entered. Each has
              its own bib number.
            </Alert>
          )}

          {result.registrations.map((registration) => (
            <Card key={registration.registration_code}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle>Registration {registration.registration_code}</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={registrationStatusTone(registration.status)}>{titleCase(registration.status)}</Badge>
                    <Badge tone={paymentStatusTone(registration.payment_status)}>
                      Payment: {titleCase(registration.payment_status)}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  {[
                    ['Athlete', registration.athlete_name_masked],
                    ['Bib number', registration.bib_number ?? 'Issued after payment'],
                    ['Championship', registration.championship?.name ?? '—'],
                    ['Category', registration.category?.name ?? '—'],
                    ['Events', registration.events.join(', ') || '—'],
                    ['Fee', formatMoney(registration.fee_paise, registration.currency)],
                    ['Registered on', formatDate(registration.registered_at)],
                    [
                      'Confirmed on',
                      registration.confirmed_at ? formatDateTime(registration.confirmed_at) : 'Not confirmed yet',
                    ],
                    [
                      'Championship dates',
                      registration.championship?.starts_on ? formatDate(registration.championship.starts_on) : '—',
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                      <dd className="text-slate-800">{value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle>Need to finish a payment?</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600">
                An entry only appears here once its payment has succeeded — that is when your bib number and Athlete ID
                are issued. If you left the payment step unfinished, simply{' '}
                <Link to="/register" className="font-semibold text-orange-700 underline-offset-2 hover:underline">
                  register again
                </Link>{' '}
                and complete the payment. Nothing was registered the first time, so nothing is duplicated.
              </p>
            </CardContent>
          </Card>

          {result.registrations.map((registration) => (
            <Card key={`pay-${registration.registration_code}`}>
              <CardHeader>
                <CardTitle>Payment history — {registration.registration_code}</CardTitle>
              </CardHeader>
              <CardContent>
                {registration.payments.length === 0 ? (
                  <p className="text-sm text-slate-600">No payment attempts have been recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
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
                        {registration.payments.map((payment, index) => (
                          <tr
                            key={`${payment.razorpay_payment_id ?? 'attempt'}-${index}`}
                            className="border-b border-slate-100"
                          >
                            <td className="py-2 pr-3 text-slate-700">{formatDateTime(payment.created_at)}</td>
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
          ))}

          <div className="flex flex-wrap gap-3">
            <Link to="/returning">
              <Button variant="outline">Retrieve my athlete details</Button>
            </Link>
            <Link to="/contact">
              <Button variant="ghost">Contact the organiser</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
