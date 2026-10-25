import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
  Spinner,
} from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/admin/PageHeader'
import { adminApplicationDetail } from '@/lib/api'
import {
  applicationStatusLabel,
  applicationStatusTone,
  formatDate,
  formatDateTime,
  formatMoney,
  genderLabel,
  representingText,
  titleCase,
} from '@/lib/format'
import type { ApplicationAdminRow, ApplicationOrder } from '@/lib/types'

function noticeFor(application: ApplicationAdminRow): { tone: 'info' | 'warning' | 'danger' | 'success'; title: string; body: string } {
  switch (application.application_status) {
    case 'pending':
      return {
        tone: 'warning',
        title: 'Payment is still pending',
        body: 'The gateway has not confirmed a payment for this application. No Athlete ID or bib number has been issued.',
      }
    case 'failed':
      return {
        tone: 'danger',
        title: 'The latest payment attempt failed',
        body: 'No Athlete ID or bib number has been issued. If the original form session is still open, the athlete can retry payment there; otherwise they must start a new registration once this application expires.',
      }
    case 'abandoned':
      return {
        tone: 'info',
        title: 'Application abandoned before payment',
        body: 'The application link expired without a confirmed payment. No Athlete ID or bib number has been issued.',
      }
    case 'paid':
      return {
        tone: 'success',
        title: 'The gateway reports the payment as captured',
        body: 'The registration, Athlete ID and bib are created by the verified capture. If the registration is missing, check the Payments tab.',
      }
    case 'started':
    default:
      return {
        tone: 'info',
        title: 'Payment was not started',
        body: 'The form was saved, but no gateway payment attempt exists yet. No Athlete ID or bib number has been issued.',
      }
  }
}

function orderTone(order: ApplicationOrder): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (order.status) {
    case 'captured':
      return 'success'
    case 'failed':
      return 'danger'
    case 'created':
    case 'authorized':
      return 'warning'
    default:
      return 'neutral'
  }
}

export function ApplicationDetailPage() {
  const { applicationId = '' } = useParams<{ applicationId: string }>()
  const navigate = useNavigate()

  const [application, setApplication] = useState<ApplicationAdminRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!applicationId) return
    setLoading(true)
    try {
      const result = await adminApplicationDetail(applicationId)
      setApplication(result.application)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this application.')
    } finally {
      setLoading(false)
    }
  }, [applicationId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="Loading application" />
      </div>
    )
  }

  if (loadError || !application) {
    return (
      <div>
        <Alert tone="danger" title="Could not load this application">
          {loadError ?? 'Application not found.'}
        </Alert>
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate('/admin/registrations?tab=applications')}>
            Back to unpaid applications
          </Button>
        </div>
      </div>
    )
  }

  const personal = application.personal
  const notice = noticeFor(application)
  const category = application.championship_categories?.name ?? application.category_name ?? '—'
  const events = application.events.map((event) => event.name).join(', ') || '—'

  return (
    <div>
      <PageHeader
        title={`Application ${application.application_number}`}
        description={`${application.championships?.name ?? 'Championship'} · ${category}`}
        actions={
          <Link to="/admin/registrations?tab=applications">
            <Button variant="outline" size="sm">
              ← Unpaid applications
            </Button>
          </Link>
        }
      />

      <Alert tone={notice.tone} title={notice.title} className="mb-5">
        {notice.body}
      </Alert>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Athlete details as submitted</CardTitle>
                <Badge tone={applicationStatusTone(application.application_status)}>
                  {applicationStatusLabel(application.application_status)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                {(
                  [
                    ['Full name', personal.full_name || '—'],
                    ['Date of birth', formatDate(personal.date_of_birth)],
                    ['Gender', genderLabel(personal.gender)],
                    ['Mobile', personal.mobile_e164 || personal.mobile_number || '—'],
                    ['Email', personal.email || '—'],
                    ['State', personal.state || '—'],
                    ['District', personal.district || '—'],
                    ['Representing', representingText(personal) || '—'],
                    ['Address', personal.address || '—'],
                    [
                      'Emergency contact',
                      personal.emergency_contact_name
                        ? `${personal.emergency_contact_name}${
                            personal.emergency_contact_phone ? ` · ${personal.emergency_contact_phone}` : ''
                          }`
                        : '—',
                    ],
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                    <dd className="mt-0.5 break-words text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
              <Separator className="my-4" />
              <details>
                <summary className="cursor-pointer text-sm text-slate-700">All submitted fields</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                  {JSON.stringify(personal, null, 2)}
                </pre>
              </details>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Entry details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                {(
                  [
                    ['Championship', application.championships?.name ?? '—'],
                    ['Age category', category],
                    ['Selected events', events],
                    ['Fee', formatMoney(application.fee_paise, application.currency)],
                    ['Application started', formatDateTime(application.created_at)],
                    ['Application link expires', formatDateTime(application.expires_at)],
                    [
                      'Aadhaar',
                      application.aadhaar_verified_at
                        ? `Verified ${formatDateTime(application.aadhaar_verified_at)}`
                        : 'Not verified',
                    ],
                    ['Request IP', application.request_ip || '—'],
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                    <dd className="mt-0.5 break-words text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment attempts</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {application.payment_orders.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-600">
                  No payment attempt was started for this application.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2.5">Date</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Amount</th>
                        <th className="px-3 py-2.5">Method</th>
                        <th className="px-3 py-2.5">Gateway reference</th>
                        <th className="px-3 py-2.5">Verified</th>
                      </tr>
                    </thead>
                    <tbody>
                      {application.payment_orders.map((order) => (
                        <tr key={order.id} className="border-b border-slate-100">
                          <td className="px-3 py-2.5 text-slate-700">
                            {formatDateTime(order.created_at)}
                            <span className="mt-0.5 block text-xs text-slate-500">Attempt {order.attempt_number}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge tone={orderTone(order)}>{titleCase(order.status)}</Badge>
                            {order.failure_reason && (
                              <span className="mt-1 block max-w-[240px] text-xs text-red-600">
                                {order.failure_reason}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-slate-700">
                            {formatMoney(order.amount_paise, order.currency)}
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">{order.method ? titleCase(order.method) : '—'}</td>
                          <td className="px-3 py-2.5 font-mono text-xs text-slate-600">
                            <span className="block break-all">{order.razorpay_order_id}</span>
                            {order.razorpay_payment_id && (
                              <span className="mt-1 block break-all text-slate-500">{order.razorpay_payment_id}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">
                            {order.verified_at ? formatDateTime(order.verified_at) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Bib &amp; Athlete ID</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Athlete ID</p>
                <p className="mt-0.5 font-medium text-slate-500">Not issued</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Bib number</p>
                <p className="mt-0.5 font-medium text-slate-500">Not issued</p>
              </div>
              <p className="text-xs text-slate-600">
                Both are created together only after the payment gateway reports the order as paid, the amount matches,
                and the server promotes this application to a registration. An unpaid application never consumes a bib
                number.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What happens next</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              {application.application_status === 'paid' ? (
                <p>
                  The payment is captured. If the registration, Athlete ID and bib are not visible yet, check the
                  Payments tab for a reconcile action.
                </p>
              ) : application.application_status === 'abandoned' ? (
                <p>
                  The application link has expired, so it cannot be paid through the original link. The athlete must
                  start a new registration and complete payment to obtain a bib.
                </p>
              ) : (
                <p>
                  The athlete can check this application on the public Status page using application number{' '}
                  <span className="font-mono font-semibold text-slate-800">{application.application_number}</span> and
                  their mobile number. If the payment did not complete, they may need to start a new registration once
                  this application expires. After the gateway confirms a payment, the registration, Athlete ID and bib
                  are generated automatically.
                </p>
              )}
              <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                Administrators cannot mark this application as paid or assign a bib manually. Only a verified payment
                or the existing Payments reconcile flow can do that.
              </p>
              <Link to="/admin/registrations" className="inline-block text-sm font-medium text-orange-700 hover:underline">
                View paid registrations
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
