import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Alert, Card, CardContent, CardHeader, CardTitle, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input, useFieldId } from '@/components/ui/input'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { ApiError, adminBootstrap } from '@/lib/api'
import { isSupabaseConfigured } from '@/lib/env'

export function AdminLoginPage() {
  const { admin, loading, signIn } = useAdminAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // First-time setup (only works while no owner administrator exists).
  const [showSetup, setShowSetup] = useState(false)
  const [setupSecret, setSetupSecret] = useState('')
  const [setupEmail, setSetupEmail] = useState('')
  const [setupName, setSetupName] = useState('')
  const [setupPassword, setSetupPassword] = useState('')
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [setupResult, setSetupResult] = useState<{ email: string; temp_password: string; message: string } | null>(
    null,
  )

  const emailField = useFieldId('admin_email')
  const passwordField = useFieldId('admin_password')
  const secretField = useFieldId('bootstrap_secret')

  useEffect(() => {
    document.title = 'Administrator sign-in'
  }, [])

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Alert tone="warning" title="Backend not configured">
          Add your Supabase URL and anon key to <code className="rounded bg-white/60 px-1">.env</code> and restart the
          app. See the README for setup steps.
        </Alert>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking session" />
      </div>
    )
  }

  if (admin) return <Navigate to="/admin" replace />

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (email.trim().length < 3 || password.length < 6) {
      setError('Please enter your administrator email and password.')
      return
    }
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please check your details.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSetup = async (event: React.FormEvent) => {
    event.preventDefault()
    setSetupError(null)
    setSetupResult(null)
    if (setupSecret.trim().length < 8) {
      setSetupError('Please enter the bootstrap secret configured for this deployment.')
      return
    }
    if (setupEmail.trim().length < 5) {
      setSetupError('Please enter a valid email address.')
      return
    }
    if (setupPassword && setupPassword.length < 12) {
      setSetupError('If you set a password, it must be at least 12 characters long.')
      return
    }
    setSetupBusy(true)
    try {
      const result = await adminBootstrap({
        secret: setupSecret.trim(),
        email: setupEmail.trim(),
        fullName: setupName.trim() || undefined,
        password: setupPassword || undefined,
      })
      setSetupResult(result)
      setEmail(setupEmail.trim())
    } catch (err) {
      setSetupError(err instanceof ApiError ? err.message : 'First-time setup failed. Please check the secret.')
    } finally {
      setSetupBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-base font-bold text-orange-400"
          >
            AR
          </span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Administrator sign-in</h1>
          <p className="mt-1 text-sm text-slate-600">
            Restricted area for championship organisers. There is no public administrator registration.
          </p>
        </div>

        <Card>
          <CardContent className="pt-5">
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {error && <Alert tone="danger" title="Could not sign in">{error}</Alert>}
              <Field label="Email address" htmlFor={emailField} required>
                <Input
                  id={emailField}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Field label="Password" htmlFor={passwordField} required>
                <Input
                  id={passwordField}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Button type="submit" variant="accent" className="w-full" loading={submitting}>
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-5 text-center">
          <button
            type="button"
            className="text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900"
            onClick={() => setShowSetup((open) => !open)}
            aria-expanded={showSetup}
          >
            {showSetup ? 'Hide first-time setup' : 'First-time setup'}
          </button>
        </div>

        {showSetup && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Create the first administrator</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert tone="info">
                This only works before the first owner account exists. You need the bootstrap secret set as an Edge
                Function secret (<code className="rounded bg-white/60 px-1">BOOTSTRAP_ADMIN_SECRET</code>). Once an owner
                exists it stops working.
              </Alert>

              {setupError && <Alert tone="danger" title="Setup failed">{setupError}</Alert>}

              {setupResult && (
                <Alert tone="success" title="Owner account created">
                  <p>{setupResult.message}</p>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div>
                      <dt className="inline font-semibold">Email: </dt>
                      <dd className="inline">{setupResult.email}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">One-time password: </dt>
                      <dd className="inline break-all font-mono">{setupResult.temp_password}</dd>
                    </div>
                  </dl>
                </Alert>
              )}

              <form onSubmit={handleSetup} className="space-y-4" noValidate>
                <Field label="Bootstrap secret" htmlFor={secretField} required>
                  <Input
                    id={secretField}
                    type="password"
                    value={setupSecret}
                    onChange={(event) => setSetupSecret(event.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Administrator email" htmlFor="setup_email" required>
                  <Input
                    id="setup_email"
                    type="email"
                    value={setupEmail}
                    onChange={(event) => setSetupEmail(event.target.value)}
                  />
                </Field>
                <Field label="Full name" htmlFor="setup_name" hint="Optional">
                  <Input
                    id="setup_name"
                    value={setupName}
                    onChange={(event) => setSetupName(event.target.value)}
                  />
                </Field>
                <Field
                  label="Password"
                  htmlFor="setup_password"
                  hint="Optional. Leave blank to generate a strong one-time password."
                >
                  <Input
                    id="setup_password"
                    type="password"
                    value={setupPassword}
                    onChange={(event) => setSetupPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </Field>
                <Button type="submit" variant="outline" loading={setupBusy}>
                  Create owner account
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link to="/" className="hover:text-slate-800">
            ← Back to the public site
          </Link>
        </p>
      </div>
    </div>
  )
}
