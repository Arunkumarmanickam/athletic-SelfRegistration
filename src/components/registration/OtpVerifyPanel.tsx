import { useState } from 'react'
import { Alert, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { requestOtp, verifyOtp } from '@/lib/api'
import { useToast } from '@/context/ToastContext'

export interface OtpVerifyPanelProps {
  purpose: 'profile_lookup' | 'profile_match'
  athleteId?: string
  mobileE164?: string
  dateOfBirth?: string
  title?: string
  description?: string
  onVerified: (sessionToken: string) => void
  onCancel?: () => void
}

/**
 * Two-step OTP verification panel reused by the returning-athlete lookup and
 * the duplicate-profile match flow. The backend never reveals whether the
 * athlete exists, so the messaging here always stays generic.
 */
export function OtpVerifyPanel({
  purpose,
  athleteId,
  mobileE164,
  dateOfBirth,
  title = 'Verify your identity',
  description,
  onVerified,
  onCancel,
}: OtpVerifyPanelProps) {
  const toast = useToast()
  const [stage, setStage] = useState<'request' | 'verify'>('request')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [devOtp, setDevOtp] = useState<string | null>(null)

  const handleRequest = async () => {
    setSending(true)
    setError(null)
    try {
      const result = await requestOtp({ athleteId, mobileE164, dateOfBirth, purpose })
      setStage('verify')
      setInfo(result.message)
      setDevOtp(result.dev_otp ?? null)
      if (result.dev_otp) {
        toast.info('Development mode', `Your test code is ${result.dev_otp}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the verification code.')
    } finally {
      setSending(false)
    }
  }

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault()
    setVerifying(true)
    setError(null)
    try {
      const result = await verifyOtp({ athleteId, mobileE164, dateOfBirth, otp, purpose })
      toast.success('Identity verified')
      onVerified(result.athlete_session_token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The code could not be verified.')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-600">
          {description ??
            'For your security we send a one-time password to the mobile number saved in your athlete profile.'}
        </p>
      </div>

      {error && <Alert tone="danger" title="Verification unsuccessful">{error}</Alert>}

      {stage === 'request' ? (
        <div className="space-y-3">
          <Button onClick={handleRequest} loading={sending} variant="accent">
            Send one-time password
          </Button>
          {info && <p className="text-sm text-slate-600">{info}</p>}
        </div>
      ) : (
        <form onSubmit={handleVerify} className="space-y-4" noValidate>
          {info && <Alert tone="info">{info}</Alert>}
          {devOtp && (
            <Alert tone="warning" title="Development mode">
              SMS delivery is not configured, so the code is shown here: <strong>{devOtp}</strong>
            </Alert>
          )}
          <Field
            label="One-time password"
            htmlFor="otp"
            required
            hint="The code expires after 10 minutes."
            error={undefined}
          >
            <Input
              id="otp"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
              placeholder="Enter the 6-digit code"
              invalid={Boolean(error)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="accent" loading={verifying} disabled={otp.length < 4}>
              Verify and continue
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleRequest}
              loading={sending}
              disabled={verifying}
            >
              Resend code
            </Button>
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel} disabled={verifying}>
                Back
              </Button>
            )}
          </div>
        </form>
      )}

      {sending && <Spinner label="Sending verification code" />}
    </div>
  )
}
