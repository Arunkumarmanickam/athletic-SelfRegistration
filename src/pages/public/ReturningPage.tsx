import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input, useFieldId } from '@/components/ui/input'
import { Select } from '@/components/ui/form-controls'
import { DocumentUpload } from '@/components/registration/DocumentUpload'
import { ApiError, retrieveProfile, verifyAthlete } from '@/lib/api'
import { COUNTRY_CODES } from '@/lib/constants'
import { formatDate, formatMoney, genderLabel, registrationStatusTone, paymentStatusTone, titleCase, toE164 } from '@/lib/format'
import type { AthleteProfile, AthleteRegistrationSummary } from '@/lib/types'

function RegistrationsList({ registrations }: { registrations: AthleteRegistrationSummary[] }) {
  if (registrations.length === 0) {
    return <p className="text-sm text-slate-600">No championship registrations were found for this Athlete ID.</p>
  }
  return (
    <ul className="space-y-4">
      {registrations.map((registration) => (
        <li key={registration.id} className="rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-slate-900">{registration.championships?.name ?? 'Championship'}</p>
              <p className="text-xs text-slate-500">
                {registration.championship_categories?.name ? `${registration.championship_categories.name} · ` : ''}
                Reference {registration.registration_code}
                {registration.bib_number ? ` · Bib ${registration.bib_number}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={registrationStatusTone(registration.status)}>{titleCase(registration.status)}</Badge>
              <Badge tone={paymentStatusTone(registration.payment_status)}>
                Payment: {titleCase(registration.payment_status)}
              </Badge>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Registered</dt>
              <dd className="text-slate-800">{formatDate(registration.registered_at)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Fee</dt>
              <dd className="text-slate-800">{formatMoney(registration.fee_paise, registration.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Events</dt>
              <dd className="text-slate-800">
                {(registration.registration_events ?? []).map((event) => event.event_name).join(', ') || '—'}
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  )
}

export function ReturningPage() {
  const [method, setMethod] = useState<'athlete_id' | 'mobile'>('athlete_id')
  const [athleteId, setAthleteId] = useState('')
  const [countryCode, setCountryCode] = useState('+91')
  const [mobileNumber, setMobileNumber] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [identityError, setIdentityError] = useState<string | null>(null)

  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [profile, setProfile] = useState<AthleteProfile | null>(null)
  const [registrations, setRegistrations] = useState<AthleteRegistrationSummary[]>([])
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const idField = useFieldId('athlete_id')
  const mobileField = useFieldId('returning_mobile')
  const dobField = useFieldId('returning_dob')

  useEffect(() => {
    if (!sessionToken) return
    let cancelled = false
    setLoadingProfile(true)
    setProfileError(null)
    retrieveProfile(sessionToken)
      .then((result) => {
        if (cancelled) return
        setProfile(result.profile)
        setRegistrations(result.registrations)
      })
      .catch((err) => {
        if (cancelled) return
        setProfileError(
          err instanceof ApiError ? err.message : 'We could not load your details. Please verify again.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoadingProfile(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionToken])

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault()
    setIdentityError(null)

    if (!dateOfBirth) {
      setIdentityError('Please enter the date of birth used at registration.')
      return
    }

    const payload: { athleteId?: string; mobileE164?: string; dateOfBirth: string } = { dateOfBirth }
    if (method === 'athlete_id') {
      const value = athleteId.trim()
      if (value.length < 4) {
        setIdentityError('Please enter your Athlete ID (for example ATH-2026-000001).')
        return
      }
      payload.athleteId = value.toUpperCase()
    } else {
      const e164 = toE164(countryCode, mobileNumber)
      if (e164.length < 8) {
        setIdentityError('Please enter the mobile number you registered with.')
        return
      }
      payload.mobileE164 = e164
    }

    setVerifying(true)
    try {
      const result = await verifyAthlete(payload)
      setSessionToken(result.athlete_session_token)
    } catch (err) {
      setIdentityError(err instanceof ApiError ? err.message : 'We could not verify your details. Please try again.')
    } finally {
      setVerifying(false)
    }
  }

  const reset = () => {
    setSessionToken(null)
    setProfile(null)
    setRegistrations([])
    setProfileError(null)
    setAthleteId('')
    setDateOfBirth('')
    setMobileNumber('')
  }

  const loaded = Boolean(sessionToken) && !loadingProfile

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Retrieve your details</h1>

      {!loaded && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Verify it's you</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {identityError && <Alert tone="danger" title="Verification unsuccessful">{identityError}</Alert>}

            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Verification method">
              <label className={`cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium ${method === 'athlete_id' ? 'border-orange-400 bg-orange-50 text-orange-800' : 'border-slate-300 text-slate-700'}`}>
                <input
                  type="radio"
                  name="verify_method"
                  className="sr-only"
                  checked={method === 'athlete_id'}
                  onChange={() => setMethod('athlete_id')}
                />
                I have my Athlete ID
              </label>
              <label className={`cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium ${method === 'mobile' ? 'border-orange-400 bg-orange-50 text-orange-800' : 'border-slate-300 text-slate-700'}`}>
                <input
                  type="radio"
                  name="verify_method"
                  className="sr-only"
                  checked={method === 'mobile'}
                  onChange={() => setMethod('mobile')}
                />
                I don&apos;t have my Athlete ID
              </label>
            </div>

            <form onSubmit={handleVerify} className="space-y-5" noValidate>
              {method === 'athlete_id' ? (
                <Field label="Athlete ID" htmlFor={idField} required hint="Example: ATH-2026-000001">
                  <Input
                    id={idField}
                    value={athleteId}
                    onChange={(event) => setAthleteId(event.target.value)}
                    autoComplete="off"
                    placeholder="ATH-2026-000001"
                  />
                </Field>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Mobile country code" htmlFor={`${mobileField}-cc`} required>
                    <Select
                      id={`${mobileField}-cc`}
                      value={countryCode}
                      onChange={(event) => setCountryCode(event.target.value)}
                    >
                      {COUNTRY_CODES.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Mobile number" htmlFor={mobileField} required>
                    <Input
                      id={mobileField}
                      type="tel"
                      inputMode="numeric"
                      value={mobileNumber}
                      onChange={(event) => setMobileNumber(event.target.value.replace(/[^\d]/g, ''))}
                    />
                  </Field>
                </div>
              )}

              <Field label="Date of birth" htmlFor={dobField} required hint="The date of birth used at registration.">
                <Input
                  id={dobField}
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={dateOfBirth}
                  onChange={(event) => setDateOfBirth(event.target.value)}
                />
              </Field>

              <Button type="submit" variant="accent" loading={verifying}>
                Verify and continue
              </Button>
            </form>

            <p className="text-xs text-slate-500">
              For your privacy, this step never confirms whether an Athlete ID exists. The message is the same whether
              or not the details match a registered athlete, and no personal details are shown before verification.
            </p>
          </CardContent>
        </Card>
      )}

      {loadingProfile && (
        <div className="mt-6 flex justify-center py-12">
          <Spinner label="Loading your details" />
        </div>
      )}

      {profileError && (
        <div className="mt-6">
          <Alert tone="danger" title="Could not load your details">
            {profileError}
            <div className="mt-3">
              <Button variant="outline" onClick={reset}>
                Try again
              </Button>
            </div>
          </Alert>
        </div>
      )}

      {profile && (
        <div className="mt-6 space-y-5">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Your Athlete profile</CardTitle>
                <Badge tone="info">{profile.athlete_id}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ['Full name', profile.full_name],
                  ['Date of birth', formatDate(profile.date_of_birth)],
                  ['Gender', genderLabel(profile.gender)],
                  ['Mobile', profile.mobile_e164],
                  ['Email', profile.email || '—'],
                  ['State', profile.state],
                  ['District', profile.district || '—'],
                  ['Address', profile.address || '—'],
                  ['Representing', profile.representing || '—'],
                  [
                    'Emergency contact',
                    profile.emergency_contact_name
                      ? `${profile.emergency_contact_name}${profile.emergency_contact_phone ? ` · ${profile.emergency_contact_phone}` : ''}`
                      : '—',
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                    <dd className="text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs text-slate-500">
                To correct any of these details, please contact the organiser. Changes are recorded in an audit
                trail.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your registrations</CardTitle>
            </CardHeader>
            <CardContent>
              <RegistrationsList registrations={registrations} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upload a document</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentUpload athleteSessionToken={sessionToken ?? ''} />
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Link to="/register">
              <Button variant="accent">Register for a championship</Button>
            </Link>
            <Link to="/status">
              <Button variant="outline">Check a registration status</Button>
            </Link>
            <Button variant="ghost" onClick={reset}>
              Verify another athlete
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
