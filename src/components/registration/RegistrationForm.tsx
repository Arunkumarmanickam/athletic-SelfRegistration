import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input, useFieldId } from '@/components/ui/input'
import { Checkbox, Select } from '@/components/ui/form-controls'
import { SearchCombobox } from '@/components/ui/search-combobox'
import { EventMultiSelect } from '@/components/ui/event-multi-select'
import { AadhaarReference } from './AadhaarReference'
import { FeeSummary } from './FeeSummary'
import { PaymentPanel } from './PaymentPanel'
import { ApiError, register, uploadAadhaar } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useConfig } from '@/context/ConfigContext'
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft'
import { COUNTRY_CODES } from '@/lib/constants'
import { isIndia, districtsOf, INDIAN_STATES } from '@/lib/geo'
import { formatAge, formatDate, formatMoney, toE164 } from '@/lib/format'
import { cn } from '@/lib/utils'
import { registrationFormSchema, validateWith, type RegistrationFormValues } from '@/lib/validation'
import { saveConfirmation } from '@/lib/receipt'
import type { Championship, Confirmation, FormConfig, RegisterResponse } from '@/lib/types'

/** Resolves the date on which age eligibility is evaluated. */
function ageCutoffDate(championship: Championship): string {
  const config: FormConfig = championship.form_config ?? {}
  if (config.age_calculation_mode === 'fixed' && config.age_calculation_date) {
    return config.age_calculation_date
  }
  return championship.starts_on ?? new Date().toISOString().slice(0, 10)
}

const EMPTY: RegistrationFormValues = {
  full_name: '',
  date_of_birth: '',
  gender: '',
  representing: '',
  event_ids: [],
  mobile_country_code: '+91',
  mobile_number: '',
  email: '',
  accept_terms: false,
}

const AADHAAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const AADHAAR_MAX_BYTES = 5 * 1024 * 1024

const fileInputClass =
  'block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-orange-700'

export interface RegistrationFormProps {
  championship: Championship
}

/**
 * Single-page registration form.
 *
 * Field order: name, date of birth (live age + category), representing
 * (district for a state-level meet, state for a national one), gender, events,
 * mobile number, mandatory Aadhaar front upload, then save & payment.
 *
 * The browser validates for fast feedback only — the Edge Function and Postgres
 * recompute eligibility and fees and enforce every rule again.
 */
export function RegistrationForm({ championship }: RegistrationFormProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const { config } = useConfig()

  const maxEvents = championship.max_events_per_athlete ?? null
  const cutoff = ageCutoffDate(championship)

  // What "representing" asks for follows where the championship is held: a
  // state meet asks for a district of that state, a national meet held in India
  // asks for the athlete's state, and any other country is free text.
  const nation = (championship.nation ?? 'India').trim()
  const championshipState = championship.state_name ?? null
  const representingMode = !isIndia(nation) ? 'region' : championshipState ? 'district' : 'state'
  const representingOptions = useMemo(
    () =>
      representingMode === 'region'
        ? []
        : representingMode === 'district'
          ? districtsOf(championshipState)
          : INDIAN_STATES,
    [representingMode, championshipState],
  )
  /** Which stored column the answer belongs to — see create_registration(). */
  const locationFields = (representing: string) =>
    representingMode === 'district'
      ? { state: championshipState ?? '', district: representing }
      : { state: representing, district: '' }

  const nameId = useFieldId('full_name')
  const dobId = useFieldId('date_of_birth')
  const genderId = useFieldId('gender')
  const reprId = useFieldId('representing')
  const countryId = useFieldId('mobile_country_code')
  const mobileId = useFieldId('mobile_number')
  const emailId = useFieldId('email')
  const aadhaarId = useFieldId('aadhaar')

  const [values, setValues] = useState<RegistrationFormValues>(EMPTY)
  const [aadhaarFile, setAadhaarFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  const [result, setResult] = useState<RegisterResponse | null>(null)
  const [draftToken, setDraftToken] = useState<string | null>(null)
  const [uploadPending, setUploadPending] = useState(false)
  const [retryFile, setRetryFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [alreadyRegistered, setAlreadyRegistered] = useState(false)

  // ---- draft persistence ----------------------------------------------------
  useEffect(() => {
    const draft = loadDraft(championship.id)
    if (draft) {
      const p = draft.personal
      const part = draft.participation
      setValues({
        full_name: p.full_name,
        date_of_birth: p.date_of_birth,
        gender: p.gender === 'female' ? 'female' : p.gender === 'male' ? 'male' : '',
        representing:
          representingMode === 'district'
            ? p.district || p.representing
            : p.state || p.representing,
        event_ids: part.event_ids ?? [],
        mobile_country_code: p.mobile_country_code || '+91',
        mobile_number: p.mobile_number,
        email: p.email ?? '',
        accept_terms: false,
      })
    }
    setHydrated(true)
  }, [championship.id, representingMode])

  useEffect(() => {
    if (!hydrated || result) return
    saveDraft({
      championshipId: championship.id,
      personal: {
        full_name: values.full_name,
        date_of_birth: values.date_of_birth,
        gender: values.gender,
        mobile_country_code: values.mobile_country_code,
        mobile_number: values.mobile_number,
        email: values.email,
        ...locationFields(values.representing),
        address: '',
        representing: values.representing,
      },
      participation: {
        category_id: '',
        event_ids: values.event_ids,
        emergency_contact_name: '',
        emergency_contact_phone: '',
      },
      stepIndex: 0,
    })
  }, [hydrated, result, championship.id, representingMode, values])

  // ---- live derivations ------------------------------------------------------
  const age = values.date_of_birth ? Number(formatAge(values.date_of_birth, cutoff)) : null

  const eligibleCategory = useMemo(() => {
    if (age === null || !Number.isFinite(age) || !values.gender) return null
    return (
      (championship.championship_categories ?? [])
        .filter((category) => category.is_active)
        .filter((category) => category.gender === 'any' || category.gender === values.gender)
        .find((category) => age >= category.min_age && age <= category.max_age) ?? null
    )
  }, [age, values.gender, championship.championship_categories])

  const selectedEvents = useMemo(
    () => (championship.championship_events ?? []).filter((event) => values.event_ids.includes(event.id)),
    [championship.championship_events, values.event_ids],
  )

  const toggleEvent = (eventId: string) => {
    setValues((current) => {
      const has = current.event_ids.includes(eventId)
      if (!has && maxEvents !== null && current.event_ids.length >= maxEvents) return current
      return {
        ...current,
        event_ids: has
          ? current.event_ids.filter((id) => id !== eventId)
          : [...current.event_ids, eventId],
      }
    })
  }

  const pickAadhaar = (file: File | null) => {
    setErrors((current) => ({ ...current, aadhaar: '' }))
    if (!file) {
      setAadhaarFile(null)
      return
    }
    if (!AADHAAR_TYPES.includes(file.type)) {
      setErrors((current) => ({ ...current, aadhaar: 'Please upload a JPG, PNG or WEBP image.' }))
      return
    }
    if (file.size > AADHAAR_MAX_BYTES) {
      setErrors((current) => ({ ...current, aadhaar: 'The image must be 5 MB or smaller.' }))
      return
    }
    setAadhaarFile(file)
  }

  const mobileE164 = toE164(values.mobile_country_code, values.mobile_number)

  const handleSubmit = async () => {
    setFormError(null)
    const parsed = validateWith(registrationFormSchema, values)
    const extra: Record<string, string> = {}
    if (!parsed.success) Object.assign(extra, parsed.errors)
    if (age !== null && values.gender && !eligibleCategory) {
      extra.date_of_birth = 'No age category in this championship matches your date of birth.'
    }
    if (maxEvents !== null && values.event_ids.length > maxEvents) {
      extra.event_ids = `You can select up to ${maxEvents} events.`
    }
    if (!aadhaarFile) extra.aadhaar = 'Please upload the front side of your Aadhaar card.'
    if (championship.terms_text && !values.accept_terms) {
      extra.accept_terms = 'Please accept the terms and conditions.'
    }
    if (Object.keys(extra).length > 0 || !eligibleCategory) {
      setErrors(extra)
      return
    }

    setErrors({})
    setSubmitting(true)
    try {
      const response = await register({
        championshipId: championship.id,
        categoryId: eligibleCategory.id,
        eventIds: values.event_ids,
        personal: {
          full_name: values.full_name,
          date_of_birth: values.date_of_birth,
          gender: values.gender,
          mobile_country_code: values.mobile_country_code,
          mobile_number: values.mobile_number,
          mobile_e164: mobileE164,
          email: values.email.trim(),
          ...locationFields(values.representing),
          address: '',
          representing: values.representing,
        },
      })

      clearDraft()
      setDraftToken(response.draft_token)
      setResult(response)

      // Mandatory Aadhaar front: uploaded against the draft, before payment.
      // Nothing permanent has been created yet.
      if (!response.draft_token) {
        setUploadPending(true)
        setUploadError('Your upload session could not be started. Please try the upload below again.')
        return
      }
      try {
        await uploadAadhaar({
          draftToken: response.draft_token,
          draftId: response.draft.id,
          file: aadhaarFile!,
        })
        toast.info('Details received', 'Aadhaar upload received. Continue to payment to confirm your entry.')
      } catch (err) {
        setUploadPending(true)
        setUploadError(err instanceof ApiError ? err.message : 'The Aadhaar upload failed. Please try again.')
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'ALREADY_REGISTERED') {
          setAlreadyRegistered(true)
          return
        }
        setFormError(err.message)
        return
      }
      setFormError('Something went wrong while saving your registration. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const retryUpload = async () => {
    if (!result) return
    if (!retryFile) {
      setUploadError('Please choose the front side of your Aadhaar card first.')
      return
    }
    if (!draftToken) {
      setUploadError(
        'Your session has expired. Please fill in your details again, or contact the organiser.',
      )
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      await uploadAadhaar({ draftToken, draftId: result.draft.id, file: retryFile })
      setUploadPending(false)
      setRetryFile(null)
      toast.success('Aadhaar uploaded', 'You can continue to payment.')
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'The upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const handlePaymentSuccess = (confirmation: Confirmation) => {
    saveConfirmation(confirmation)
    toast.success('Payment verified', 'Your registration is confirmed.')
    navigate('/registration/success')
  }

  // ---- post-registration view ----------------------------------------------
  if (result) {
    const draft = result.draft
    const paymentWithOrder = result.payment.configured ? result.payment : null

    return (
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Details saved</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert tone="warning" title="Not registered yet — payment is still pending">
              Your details are saved but your entry is not confirmed. Your bib number and Athlete ID will be
              issued once your payment succeeds.
            </Alert>

            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Championship</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-900">{championship.name}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Age category</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-900">{draft.category_name ?? '—'}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Fee</dt>
                <dd className="mt-1 text-lg font-semibold text-slate-900">
                  {formatMoney(draft.fee_paise, draft.currency)}
                </dd>
              </div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-orange-600">Bib number</dt>
                <dd className="mt-1 text-sm font-semibold text-orange-800">Issued after payment</dd>
              </div>
            </dl>

            <p className="text-sm text-slate-600">
              Complete the payment below to confirm your entry. Nothing is registered until the payment succeeds,
              so you can simply close this page if you change your mind.
            </p>
          </CardContent>
        </Card>

        {uploadPending && (
          <Card>
            <CardHeader>
              <CardTitle>Aadhaar front upload required</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert tone="warning" title="Upload required before payment">
                {uploadError ?? 'Please upload the front side of your Aadhaar card to continue to payment.'}
              </Alert>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className={fileInputClass}
                onChange={(event) => setRetryFile(event.target.files?.[0] ?? null)}
              />
              {retryFile && <p className="text-xs text-slate-500">Selected: {retryFile.name}</p>}
              <Button variant="accent" onClick={() => void retryUpload()} loading={uploading} disabled={uploading}>
                Upload Aadhaar
              </Button>
            </CardContent>
          </Card>
        )}

        {!uploadPending && (
          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardContent>
              {paymentWithOrder ? (
                <PaymentPanel
                  championshipName={championship.name}
                  organizerName={config?.site?.organizer_name}
                  draftToken={draftToken}
                  mobileE164={mobileE164}
                  amountPaise={paymentWithOrder.amount_paise}
                  currency={paymentWithOrder.currency}
                  prefill={
                    result.prefill ?? {
                      name: values.full_name,
                      email: values.email,
                      contact: mobileE164,
                    }
                  }
                  order={{
                    razorpay_order_id: paymentWithOrder.razorpay_order_id,
                    razorpay_key_id: paymentWithOrder.razorpay_key_id,
                    amount_paise: paymentWithOrder.amount_paise,
                    currency: paymentWithOrder.currency,
                  }}
                  onSuccess={handlePaymentSuccess}
                />
              ) : config?.payments_configured ? (
                <PaymentPanel
                  championshipName={championship.name}
                  organizerName={config?.site?.organizer_name}
                  draftToken={draftToken}
                  mobileE164={mobileE164}
                  amountPaise={draft.fee_paise}
                  currency={draft.currency}
                  prefill={{
                    name: values.full_name,
                    email: values.email,
                    contact: mobileE164,
                  }}
                  onSuccess={handlePaymentSuccess}
                />
              ) : (
                <Alert tone="warning" title="Online payment is not configured yet">
                  {result.message ??
                    'Your details are saved, but this deployment has no online payment set up. Please contact the organiser to complete your payment.'}
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap gap-3">
          <Link to="/status">
            <Button variant="outline">Check registration status</Button>
          </Link>
          <Link to="/">
            <Button variant="ghost">Back to home</Button>
          </Link>
        </div>
      </div>
    )
  }

  // ---- form view ------------------------------------------------------------
  const representingLabel =
    representingMode === 'district'
      ? `District (you represent) — ${championshipState}`
      : representingMode === 'state'
        ? 'State (you represent)'
        : 'State / Province (you represent)'
  const representingHint =
    representingMode === 'district'
      ? `Start typing to find your district in ${championshipState}.`
      : representingMode === 'state'
        ? 'The Indian state this entry represents.'
        : 'The region this entry represents.'
  const representingPlaceholder =
    representingMode === 'district' ? 'e.g. Coimbatore' : representingMode === 'state' ? 'e.g. Tamil Nadu' : 'Region'

  return (
    <div className="space-y-6">
      {formError && <Alert tone="danger" title="We could not complete that">{formError}</Alert>}
      {alreadyRegistered && (
        <Alert tone="warning" title="You are already registered">
          This athlete is already registered for {championship.name}. Check the status with your reference and mobile
          number, or retrieve your details with your Athlete ID.
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/status">
              <Button size="sm" variant="outline">
                Check status
              </Button>
            </Link>
            <Link to="/returning">
              <Button size="sm" variant="outline">
                Retrieve my details
              </Button>
            </Link>
          </div>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Registration form</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field label="Full name" htmlFor={nameId} required error={errors.full_name}>
            <Input
              id={nameId}
              name="full_name"
              autoComplete="name"
              value={values.full_name}
              invalid={Boolean(errors.full_name)}
              onChange={(event) => setValues((current) => ({ ...current, full_name: event.target.value }))}
              placeholder="As it should appear on results and the bib"
            />
          </Field>

          <Field label="Aadhaar card — front side" htmlFor={aadhaarId} required error={errors.aadhaar}>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,300px)_minmax(0,1fr)] sm:items-start">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <AadhaarReference className="w-full" />
                <p className="mt-2 text-center text-[11px] text-slate-500">Front side — for reference only</p>
              </div>
              <div className="space-y-3">
                <input
                  id={aadhaarId}
                  name="aadhaar"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className={fileInputClass}
                  onChange={(event) => pickAadhaar(event.target.files?.[0] ?? null)}
                />
                {aadhaarFile && <p className="text-xs text-slate-500">Selected: {aadhaarFile.name}</p>}
                <Alert tone="info" className="text-xs">
                  Make sure that your Aadhar Card&apos;s Date of Birth is exactly the same as the date of birth entered
                  below. The card is only checked to confirm your date of birth and is not stored.
                </Alert>
              </div>
            </div>
          </Field>

          <Field
            label="Date of birth"
            htmlFor={dobId}
            required
            error={errors.date_of_birth}
            hint="Used to place the athlete in the correct age category."
          >
            <Input
              id={dobId}
              name="date_of_birth"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={values.date_of_birth}
              invalid={Boolean(errors.date_of_birth)}
              onChange={(event) => setValues((current) => ({ ...current, date_of_birth: event.target.value }))}
            />
          </Field>

          {values.date_of_birth && (
            <div
              className={cn(
                'rounded-lg border px-4 py-3 text-sm',
                eligibleCategory ? 'border-slate-200 bg-slate-50' : 'border-amber-300 bg-amber-50',
              )}
            >
              <p className="text-slate-600">
                Age on {formatDate(cutoff)}:{' '}
                <span className="font-semibold text-slate-900">
                  {age !== null && Number.isFinite(age) ? `${age} years` : '—'}
                </span>
              </p>
              {values.gender && eligibleCategory && (
                <p className="mt-1 text-slate-700">
                  Your age category: <span className="font-semibold">{eligibleCategory.name}</span> (
                  {eligibleCategory.min_age}–{eligibleCategory.max_age} years)
                </p>
              )}
              {values.gender && !eligibleCategory && (
                <p className="mt-1 font-medium text-amber-800">
                  No age category in this championship matches your date of birth and gender. Please check the date of
                  birth.
                </p>
              )}
              {!values.gender && <p className="mt-1 text-slate-500">Select your gender to see your age category.</p>}
            </div>
          )}

          <Field label={representingLabel} htmlFor={reprId} required error={errors.representing} hint={representingHint}>
            <SearchCombobox
              id={reprId}
              name="representing"
              value={values.representing}
              invalid={Boolean(errors.representing)}
              onChange={(value) => setValues((current) => ({ ...current, representing: value }))}
              options={representingOptions}
              placeholder={representingPlaceholder}
            />
          </Field>

          <Field label="Gender" htmlFor={genderId} required error={errors.gender}>
            <div id={genderId} role="radiogroup" aria-label="Gender" className="flex flex-wrap gap-6 pt-1">
              {[
                { value: 'male', label: 'Men' },
                { value: 'female', label: 'Women' },
              ].map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <input
                    type="radio"
                    name="gender"
                    className="h-4 w-4 border-slate-300 text-orange-600 focus:ring-orange-500"
                    value={option.value}
                    checked={values.gender === option.value}
                    onChange={() => setValues((current) => ({ ...current, gender: option.value }))}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </Field>

          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-slate-800">
                Events <span className="text-red-600">*</span>
              </span>
              <span className="text-xs text-slate-500">
                {values.event_ids.length} selected
                {maxEvents !== null ? ` · maximum ${maxEvents}` : ''}
                {maxEvents !== null && values.event_ids.length >= maxEvents ? ' · untick one to change' : ''}
              </span>
            </div>
            <div className="mt-2">
              <EventMultiSelect
                events={championship.championship_events ?? []}
                selectedIds={values.event_ids}
                onToggle={toggleEvent}
                gender={values.gender}
                categoryId={eligibleCategory?.id ?? ''}
                invalid={Boolean(errors.event_ids)}
                maxSelected={maxEvents}
              />
            </div>
            {errors.event_ids && (
              <p className="mt-1 text-xs font-medium text-red-600" role="alert">
                {errors.event_ids}
              </p>
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Country code" htmlFor={countryId} required error={errors.mobile_country_code}>
              <Select
                id={countryId}
                name="mobile_country_code"
                value={values.mobile_country_code}
                invalid={Boolean(errors.mobile_country_code)}
                onChange={(event) => setValues((current) => ({ ...current, mobile_country_code: event.target.value }))}
              >
                {COUNTRY_CODES.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Mobile number" htmlFor={mobileId} required error={errors.mobile_number}>
              <Input
                id={mobileId}
                name="mobile_number"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={values.mobile_number}
                invalid={Boolean(errors.mobile_number)}
                onChange={(event) =>
                  setValues((current) => ({ ...current, mobile_number: event.target.value.replace(/[^\d]/g, '') }))
                }
                placeholder="9876543210"
              />
            </Field>
          </div>

          <Field
            label="Email"
            htmlFor={emailId}
            error={errors.email}
            hint="Optional. Used on your payment receipt and the Razorpay checkout."
          >
            <Input
              id={emailId}
              name="email"
              type="email"
              autoComplete="email"
              value={values.email}
              invalid={Boolean(errors.email)}
              onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))}
              placeholder="name@example.com"
            />
          </Field>

          <FeeSummary championship={championship} category={eligibleCategory} events={selectedEvents} />


          {championship.terms_text && (
            <div className="space-y-2">
              <Checkbox
                label="I accept the terms and conditions"
                checked={values.accept_terms}
                onChange={(event) =>
                  setValues((current) => ({ ...current, accept_terms: event.target.checked }))
                }
              />
              {errors.accept_terms && (
                <p className="text-xs font-medium text-red-600" role="alert">
                  {errors.accept_terms}
                </p>
              )}
              <div className="max-h-32 overflow-y-auto whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                {championship.terms_text}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="accent" onClick={() => void handleSubmit()} loading={submitting} disabled={submitting}>
              Save &amp; continue to payment
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
