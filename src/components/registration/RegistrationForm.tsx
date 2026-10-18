import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { StepIndicator } from '@/components/ui/step-indicator'
import { PersonalStep } from './PersonalStep'
import { ParticipationStep } from './ParticipationStep'
import { ReviewStep } from './ReviewStep'
import { PaymentPanel } from './PaymentPanel'
import { DocumentUpload } from './DocumentUpload'
import { OtpVerifyPanel } from './OtpVerifyPanel'
import { ApiError, register } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useConfig } from '@/context/ConfigContext'
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft'
import { formatMoney, toE164 } from '@/lib/format'
import { REGISTRATION_STEPS } from '@/lib/constants'
import {
  participationStepSchema,
  personalStepSchema,
  reviewStepSchema,
  validateWith,
  type ParticipationStepValues,
  type PersonalStepValues,
  type ReviewStepValues,
} from '@/lib/validation'
import { saveConfirmation } from '@/lib/receipt'
import type { Championship, Confirmation, RegisterResponse } from '@/lib/types'

const EMPTY_PERSONAL: PersonalStepValues = {
  full_name: '',
  date_of_birth: '',
  gender: '',
  mobile_country_code: '+91',
  mobile_number: '',
  email: '',
  state: '',
  district: '',
  address: '',
  representing: '',
}

const EMPTY_PARTICIPATION: ParticipationStepValues = {
  category_id: '',
  event_ids: [],
  emergency_contact_name: '',
  emergency_contact_phone: '',
}

const EMPTY_REVIEW: ReviewStepValues = { accept_terms: false, confirm_details: false }

export interface RegistrationFormProps {
  championship: Championship
}

/**
 * Multi-step registration orchestrator. It validates for fast feedback only —
 * the Edge Function and Postgres recompute fees and eligibility authoritatively.
 */
export function RegistrationForm({ championship }: RegistrationFormProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const { config } = useConfig()

  const [stepIndex, setStepIndex] = useState(0)
  const [personal, setPersonal] = useState<PersonalStepValues>(EMPTY_PERSONAL)
  const [participation, setParticipation] = useState<ParticipationStepValues>(EMPTY_PARTICIPATION)
  const [review, setReview] = useState<ReviewStepValues>(EMPTY_REVIEW)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  const [result, setResult] = useState<RegisterResponse | null>(null)
  const [athleteSessionToken, setAthleteSessionToken] = useState<string | null>(null)
  const [postWarning, setPostWarning] = useState<string | null>(null)
  const [alreadyRegistered, setAlreadyRegistered] = useState(false)
  const [verification, setVerification] = useState<{ mobileE164: string; dateOfBirth: string } | null>(null)

  // ---- draft persistence ----------------------------------------------------
  useEffect(() => {
    const draft = loadDraft(championship.id)
    if (draft) {
      setPersonal({ ...EMPTY_PERSONAL, ...draft.personal })
      setParticipation({ ...EMPTY_PARTICIPATION, ...draft.participation })
      setStepIndex(Math.min(Math.max(draft.stepIndex, 0), REGISTRATION_STEPS.length - 1))
    }
    setHydrated(true)
  }, [championship.id])

  useEffect(() => {
    if (!hydrated || result) return
    saveDraft({
      championshipId: championship.id,
      personal,
      participation,
      stepIndex,
      updatedAt: new Date().toISOString(),
    })
  }, [hydrated, result, championship.id, personal, participation, stepIndex])

  const formConfig = championship.form_config ?? {}
  const category = useMemo(
    () => championship.championship_categories.find((item) => item.id === participation.category_id) ?? null,
    [championship.championship_categories, participation.category_id],
  )
  const selectedEvents = useMemo(
    () => championship.championship_events.filter((event) => participation.event_ids.includes(event.id)),
    [championship.championship_events, participation.event_ids],
  )

  const submit = useCallback(
    async (sessionToken?: string | null) => {
      setSubmitting(true)
      setFormError(null)
      setAlreadyRegistered(false)
      try {
        const payload: Record<string, unknown> = {
          championshipId: championship.id,
          categoryId: participation.category_id,
          eventIds: participation.event_ids,
          personal: {
            ...personal,
            emergency_contact_name: participation.emergency_contact_name,
            emergency_contact_phone: participation.emergency_contact_phone,
          },
        }
        if (sessionToken) payload.athleteSessionToken = sessionToken

        const response = await register(payload)
        setResult(response)
        if (response.athlete_session_token) setAthleteSessionToken(response.athlete_session_token)
        setVerification(null)
        clearDraft()
        if (!response.payment.configured) {
          toast.info('Registration saved', response.message ?? 'Complete payment to confirm your entry.')
        }
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.code === 'VERIFICATION_REQUIRED') {
            setVerification({
              mobileE164: toE164(personal.mobile_country_code, personal.mobile_number),
              dateOfBirth: personal.date_of_birth,
            })
            return
          }
          if (err.code === 'ORDER_FAILED') {
            const payload = err.payload as
              | { registration?: RegisterResponse['registration']; athlete_session_token?: string | null }
              | null
            if (payload?.registration) {
              setResult({
                ok: true,
                registration: payload.registration,
                payment: { configured: false },
                athlete_session_token: payload.athlete_session_token ?? null,
                athlete_session_expires_at: null,
              })
              if (payload.athlete_session_token) setAthleteSessionToken(payload.athlete_session_token)
              setPostWarning(
                'Your registration was saved and your bib number is reserved, but the payment order could not be created. Please try the payment again below.',
              )
              clearDraft()
              return
            }
          }
          if (err.code === 'ALREADY_REGISTERED' || err.code === 'ALREADY_REGISTRATION') {
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
    },
    [championship.id, participation, personal, toast],
  )

  const goNext = () => {
    setFormError(null)
    if (stepIndex === 0) {
      const result = validateWith(personalStepSchema, personal)
      const conditional: Record<string, string> = {}
      if (formConfig.require_email && !personal.email.trim()) conditional.email = 'Please enter your email address.'
      if (formConfig.require_address && !personal.address.trim()) conditional.address = 'Please enter your address.'
      if (formConfig.require_representing && !personal.representing.trim()) {
        conditional.representing = 'Please enter who you represent.'
      }
      if (!result.success || Object.keys(conditional).length > 0) {
        setErrors({ ...(result.success ? {} : result.errors), ...conditional })
        return
      }
      setErrors({})
      setStepIndex(1)
      return
    }
    if (stepIndex === 1) {
      const result = validateWith(participationStepSchema, participation)
      const conditional: Record<string, string> = {}
      if (formConfig.require_emergency && !participation.emergency_contact_name.trim()) {
        conditional.emergency_contact_name = 'Please provide an emergency contact.'
      }
      if (!result.success || Object.keys(conditional).length > 0) {
        setErrors({ ...(result.success ? {} : result.errors), ...conditional })
        return
      }
      setErrors({})
      setStepIndex(2)
    }
  }

  const handleSubmit = () => {
    const result = validateWith(reviewStepSchema, review)
    if (!result.success) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    void submit(athleteSessionToken)
  }

  const handleVerified = (token: string) => {
    setAthleteSessionToken(token)
    setVerification(null)
    toast.success('Identity verified', 'Finishing your registration…')
    void submit(token)
  }

  const handlePaymentSuccess = (confirmation: Confirmation) => {
    saveConfirmation(confirmation)
    toast.success('Payment verified', 'Your registration is confirmed.')
    navigate('/registration/success')
  }

  // ---- verification gate ----------------------------------------------------
  if (verification) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Verify to continue</CardTitle>
        </CardHeader>
        <CardContent>
          <OtpVerifyPanel
            purpose="profile_match"
            mobileE164={verification.mobileE164}
            dateOfBirth={verification.dateOfBirth}
            title="An athlete with these details may already exist"
            description="To prevent duplicate profiles, please verify with the one-time password sent to the registered mobile number. Your existing Athlete ID will be reused."
            onVerified={handleVerified}
            onCancel={() => setVerification(null)}
          />
        </CardContent>
      </Card>
    )
  }

  // ---- post-registration view ----------------------------------------------
  if (result) {
    const registration = result.registration
    return (
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Registration saved</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert tone="success" title="Your entry has been recorded">
              Keep your Athlete ID and Registration ID safely. The Registration ID doubles as your bib number.
            </Alert>

            {postWarning && <Alert tone="warning" title="Payment needs attention">{postWarning}</Alert>}

            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Athlete ID</dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-slate-900">{registration.athlete_id}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Registration ID / Bib number
                </dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-slate-900">{registration.registration_code}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Championship</dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">{championship.name}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Fee</dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">
                  {formatMoney(registration.fee_paise, registration.currency)}
                </dd>
              </div>
            </dl>

            {registration.is_new_profile && (
              <p className="text-sm text-slate-600">
                A new athlete profile was created. Use your Athlete ID to retrieve your details next time.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent>
            {result.payment.configured ? (
              <PaymentPanel
                championshipName={championship.name}
                organizerName={config?.site?.organizer_name}
                registrationCode={registration.registration_code}
                mobileE164={toE164(personal.mobile_country_code, personal.mobile_number)}
                amountPaise={result.payment.amount_paise}
                currency={result.payment.currency}
                order={{
                  razorpay_order_id: result.payment.razorpay_order_id,
                  razorpay_key_id: result.payment.razorpay_key_id,
                  amount_paise: result.payment.amount_paise,
                  currency: result.payment.currency,
                }}
                prefill={{
                  name: personal.full_name,
                  email: personal.email || undefined,
                  contact: toE164(personal.mobile_country_code, personal.mobile_number),
                }}
                onSuccess={handlePaymentSuccess}
              />
            ) : config?.payments_configured ? (
              <>
                <Alert tone="warning" className="mb-4">
                  {result.message ??
                    'Online payment is available, but no order was created yet. Start a payment attempt below.'}
                </Alert>
                <PaymentPanel
                  championshipName={championship.name}
                  organizerName={config?.site?.organizer_name}
                  registrationCode={registration.registration_code}
                  mobileE164={toE164(personal.mobile_country_code, personal.mobile_number)}
                  amountPaise={registration.fee_paise}
                  currency={registration.currency}
                  prefill={{
                    name: personal.full_name,
                    email: personal.email || undefined,
                    contact: toE164(personal.mobile_country_code, personal.mobile_number),
                  }}
                  onSuccess={handlePaymentSuccess}
                />
              </>
            ) : (
              <Alert tone="warning" title="Online payment is not configured yet">
                {result.message ??
                  'Your registration is saved, but this deployment has no online payment set up. Please contact the organiser to complete your payment.'}
              </Alert>
            )}
          </CardContent>
        </Card>

        {formConfig.allow_photo_upload && athleteSessionToken && (
          <Card>
            <CardHeader>
              <CardTitle>Optional: upload a photo or document</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentUpload
                athleteSessionToken={athleteSessionToken}
                registrationId={registration.id}
                label="Athlete photo / certificate"
              />
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
  return (
    <div className="space-y-6">
      <StepIndicator currentIndex={stepIndex} />

      {formError && <Alert tone="danger" title="We could not complete that">{formError}</Alert>}
      {alreadyRegistered && (
        <Alert tone="warning" title="You are already registered">
          This athlete is already registered for {championship.name}. You can check the status using your Registration
          ID and mobile number, or retrieve your details with your Athlete ID.
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

      <div className="animate-fade-in-up" key={stepIndex}>
        {stepIndex === 0 && (
          <PersonalStep
            values={personal}
            errors={errors}
            formConfig={formConfig}
            onChange={(patch) => setPersonal((current) => ({ ...current, ...patch }))}
          />
        )}
        {stepIndex === 1 && (
          <ParticipationStep
            values={participation}
            errors={errors}
            championship={championship}
            gender={personal.gender}
            dateOfBirth={personal.date_of_birth}
            onChange={(patch) => setParticipation((current) => ({ ...current, ...patch }))}
          />
        )}
        {stepIndex === 2 && (
          <ReviewStep
            values={review}
            errors={errors}
            onChange={(patch) => setReview((current) => ({ ...current, ...patch }))}
            championship={championship}
            category={category}
            events={selectedEvents}
            personal={personal}
            participation={participation}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setErrors({})
            setStepIndex((index) => Math.max(0, index - 1))
          }}
          disabled={stepIndex === 0 || submitting}
        >
          Back
        </Button>
        {stepIndex < REGISTRATION_STEPS.length - 1 ? (
          <Button type="button" variant="accent" onClick={goNext}>
            Continue
          </Button>
        ) : (
          <Button type="button" variant="accent" onClick={handleSubmit} loading={submitting}>
            Submit registration
          </Button>
        )}
      </div>
    </div>
  )
}
