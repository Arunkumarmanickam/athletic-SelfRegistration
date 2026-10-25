import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input, useFieldId } from '@/components/ui/input'
import { Select } from '@/components/ui/form-controls'
import { ApiError, lookupApplicationStatus, lookupRegistrationStatus } from '@/lib/api'
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

  const state = location.state as { paymentError?: string; paymentFailed?: boolean; applicationNumber?: string; mobileE164?: string } | null
  const params = new URLSearchParams(location.search)
  const appFromUrl = params.get('application_number') ?? params.get('applicationNumber') ?? undefined
  const mobileFromUrl = params.get('mobile_e164') ?? params.get('mobile') ?? undefined
  const initialApp = state?.applicationNumber ?? appFromUrl ?? ''
  const [searchType, setSearchType] = useState<'application' | 'registration'>(
    initialApp ? 'application' : 'registration',
  )
  const [applicationNumber, setApplicationNumber] = useState(initialApp)
  const [registrationCode, setRegistrationCode] = useState('')
  const [countryCode, setCountryCode] = useState('+91')
  const [mobileNumber, setMobileNumber] = useState(() => {
    const m = state?.mobileE164 ?? mobileFromUrl
    if (!m) return ''
    if (m.startsWith('+91')) return m.slice(3)
    // crude fallback - keep as digits if possible
    return m.replace(/[^\d]/g, '')
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [appResult, setAppResult] = useState<any>(null)

  const codeField = useFieldId('registration_code')
  const mobileField = useFieldId('status_mobile')

  const mobileE164 = toE164(countryCode, mobileNumber)

  const handleLookup = async (event?: React.FormEvent) => {
    if (event) event.preventDefault()
    setError(null)
    setResult(null)
    setAppResult(null)

    if (mobileE164.length < 8) {
      setError('Please enter the mobile number you registered with.')
      return
    }

    setLoading(true)
    try {
      if (searchType === 'application') {
        if (!applicationNumber.trim()) {
          setError('Please enter your Application Number.')
          setLoading(false)
          return
        }
        const response = await lookupApplicationStatus({
          applicationNumber: applicationNumber.trim(),
          mobileE164,
        })
        setAppResult(response)
      } else {
        if (registrationCode.trim().length < 3) {
          setError('Please enter your Registration ID / bib number.')
          setLoading(false)
          return
        }
        const response = await lookupRegistrationStatus({
          registrationCode: registrationCode.trim(),
          mobileE164,
        })
        setResult(response)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not look up that registration. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Auto-lookup when redirected from payment with application number
  useState(() => {
    const app = state?.applicationNumber || appFromUrl || localStorage.getItem('cdmaa:lastApp') || ''
    const mob = state?.mobileE164 || mobileFromUrl || localStorage.getItem('cdmaa:lastMobile') || ''
    if (app) {
      setSearchType('application')
      setApplicationNumber(app.toString().toUpperCase())
    }
    if (mob) {
      if (mob.startsWith('+91')) {
        setCountryCode('+91')
        setMobileNumber(mob.slice(3).replace(/[^\d]/g, ''))
      } else if (mob.includes('+')) {
        // try to extract country code - keep as is for toE164
        // simple fallback
        setMobileNumber(mob.replace(/[^\d]/g, ''))
      } else {
        setMobileNumber(mob.replace(/[^\d]/g, ''))
      }
    }
    const fullMob = mob || (countryCode + mobileNumber)
    if (app && (fullMob.replace(/[^\d]/g, '').length >= 8 || mob)) {
      const finalMob = mob || toE164(countryCode, mobileNumber) || fullMob
      setTimeout(() => {
        void (async () => {
          setError(null)
          setResult(null)
          setAppResult(null)
          setLoading(true)
          try {
            const response = await lookupApplicationStatus({
              applicationNumber: app.trim().toUpperCase(),
              mobileE164: finalMob,
            })
            setAppResult(response)
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'We could not look up that registration. Please try again.')
          } finally {
            setLoading(false)
          }
        })()
      }, 100)
    }
    return null
  })

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Check registration status</h1>
      <p className="mt-2 text-sm text-slate-600">
        You can check by Application Number (issued before payment) or by Registration ID / Bib Number (issued only after successful payment).
      </p>

      <Card className="mt-6">
        <CardContent className="pt-5">
          <div className="mb-4 flex flex-wrap gap-2">
            <Button type="button" variant={searchType === 'application' ? 'accent' : 'outline'} size="sm" onClick={() => setSearchType('application')}>
              Search by Application Number
            </Button>
            <Button type="button" variant={searchType === 'registration' ? 'accent' : 'outline'} size="sm" onClick={() => setSearchType('registration')}>
              Search by Registration / Bib
            </Button>
          </div>
          <form onSubmit={handleLookup} className="grid gap-5 sm:grid-cols-2" noValidate>
            {searchType === 'application' ? (
              <Field label="Application Number" htmlFor={codeField} required className="sm:col-span-2" hint="Example: APP-2026-000123">
                <Input id={codeField} value={applicationNumber} onChange={(e) => setApplicationNumber(e.target.value.toUpperCase())} autoComplete="off" placeholder="APP-2026-000123" />
              </Field>
            ) : (
              <Field label="Registration ID or bib number" htmlFor={codeField} required className="sm:col-span-2" hint="Either works. Example: R000013 or W7001">
                <Input id={codeField} value={registrationCode} onChange={(e) => setRegistrationCode(e.target.value)} autoComplete="off" placeholder="M60103" />
              </Field>
            )}
            <Field label="Mobile country code" htmlFor={`${mobileField}-cc`} required>
              <Select id={`${mobileField}-cc`} value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                {COUNTRY_CODES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Registered mobile number" htmlFor={mobileField} required>
              <Input id={mobileField} type="tel" inputMode="numeric" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value.replace(/[^\d]/g, ''))} />
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
        <Alert tone="danger" className="mt-5" title="Error">
          {error}
        </Alert>
      )}

      {appResult && appResult.type === 'draft' && (
        <div className="mt-6 space-y-5">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Application {appResult.application.application_number}</CardTitle>
                <Badge tone={appResult.application.payment_status === 'paid' ? 'success' : appResult.application.payment_status === 'failed' ? 'danger' : appResult.application.payment_status === 'processing' ? 'warning' : 'info'}>
                  Payment: {titleCase(appResult.application.payment_status)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ['Championship', appResult.application.championship?.name ?? '—'],
                  ['Category', appResult.application.category_name ?? '—'],
                  ['Fee', formatMoney(appResult.application.fee_paise, appResult.application.currency)],
                  ['Aadhaar verified', appResult.application.aadhaar_verified ? 'Yes' : 'No'],
                  ['Applied on', formatDateTime(appResult.application.created_at)],
                  ['Expires at', formatDateTime(appResult.application.expires_at)],
                ].map(([label, value]: any) => (
                  <div key={label}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                    <dd className="text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
              {appResult.application.payment_status === 'processing' && (
                <Alert tone="warning" className="mt-4" title="Payment is being processed">
                  Your payment is being processed by your bank. Do not make another payment. It will update automatically once confirmed.
                </Alert>
              )}
              {appResult.application.payment_status === 'failed' && (
                <Alert tone="danger" className="mt-4" title="Payment failed or cancelled">
                  Payment was not completed. Please try again from the registration page.
                </Alert>
              )}
              {appResult.application.payment_status === 'pending' && (
                <Alert tone="info" className="mt-4" title="Payment not yet completed">
                  No successful payment recorded yet. Complete your payment to get your Registration Number and Bib Number.
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-5">
          {result.multiple && (
            <Alert tone="info" title="More than one registration uses this mobile number">
              The details below are the {result.registrations.length} registrations that match what you entered. Each has its own bib number.
            </Alert>
          )}

          {result.registrations.map((registration: any) => (
            <Card key={registration.registration_code}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle>Registration {registration.registration_code}</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={registrationStatusTone(registration.status)}>{titleCase(registration.status)}</Badge>
                    <Badge tone={paymentStatusTone(registration.payment_status)}>Payment: {titleCase(registration.payment_status)}</Badge>
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
                    ['Events', (registration.events || []).join(', ') || '—'],
                    ['Fee', formatMoney(registration.fee_paise, registration.currency)],
                    ['Registered on', formatDate(registration.registered_at)],
                    ['Confirmed on', registration.confirmed_at ? formatDateTime(registration.confirmed_at) : 'Not confirmed yet'],
                    ['Championship dates', registration.championship?.starts_on ? formatDate(registration.championship.starts_on) : '—'],
                  ].map(([label, value]: any) => (
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
                An entry only appears here once its payment has succeeded — that is when your bib number and Athlete ID are issued. If you left the payment step unfinished, simply{' '}
                <Link to="/register" className="font-semibold text-orange-700 underline-offset-2 hover:underline">
                  register again
                </Link>{' '}
                and complete the payment. Nothing was registered the first time, so nothing is duplicated.
              </p>
            </CardContent>
          </Card>

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
