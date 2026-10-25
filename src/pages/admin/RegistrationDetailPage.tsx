import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Separator, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Select, Textarea } from '@/components/ui/form-controls'
import { ConfirmDialog } from '@/components/ui/dialog'
import { PageHeader } from '@/components/admin/PageHeader'
import { ApiError, adminPaymentAction, adminRegistrationDetail, adminUpdateRegistration } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import {
  formatDate,
  formatDateTime,
  formatMoney,
  genderLabel,
  paymentStatusTone,
  registrationStatusTone,
  titleCase,
} from '@/lib/format'
import type { AuditRow, PaymentRow, RegistrationAdminRow } from '@/lib/types'

type Detail = { registration: RegistrationAdminRow; payments: PaymentRow[]; audit: AuditRow[] }

export function RegistrationDetailPage() {
  const { registrationId = '' } = useParams<{ registrationId: string }>()
  const navigate = useNavigate()
  const toast = useToast()

  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [status, setStatus] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('')
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)

  const [reconcileReason, setReconcileReason] = useState('')
  const [confirmReconcile, setConfirmReconcile] = useState(false)
  const [reconciling, setReconciling] = useState(false)

  const load = useCallback(async () => {
    if (!registrationId) return
    setLoading(true)
    try {
      const result = await adminRegistrationDetail(registrationId)
      setDetail(result)
      setStatus(result.registration.status)
      setPaymentStatus(result.registration.payment_status)
      setNotes(result.registration.notes ?? '')
      setReason('')
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this registration.')
    } finally {
      setLoading(false)
    }
  }, [registrationId])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async () => {
    if (!detail) return
    const fields: Record<string, unknown> = {}
    if (status !== detail.registration.status) fields.status = status
    if (paymentStatus !== detail.registration.payment_status) fields.payment_status = paymentStatus
    if ((notes ?? '') !== (detail.registration.notes ?? '')) fields.notes = notes
    if (Object.keys(fields).length === 0) {
      toast.info('No changes', 'Nothing has changed yet.')
      setConfirmSave(false)
      return
    }
    if ('status' in fields || 'payment_status' in fields) {
      if (!reason.trim()) {
        toast.error('Reason required', 'Please provide a reason for a status change.')
        setConfirmSave(false)
        return
      }
    }
    setSaving(true)
    try {
      await adminUpdateRegistration({ registrationId, fields, reason: reason.trim() })
      toast.success('Registration updated')
      setConfirmSave(false)
      await load()
    } catch (err) {
      toast.error('Could not update', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleReconcile = async () => {
    if (!reconcileReason.trim()) {
      toast.error('Reason required', 'Please write why this payment is being reconciled.')
      return
    }
    setReconciling(true)
    try {
      await adminPaymentAction({ action: 'reconcile', registrationId, reason: reconcileReason.trim() })
      toast.success('Payment reconciled', 'The registration is now marked as paid.')
      setConfirmReconcile(false)
      setReconcileReason('')
      await load()
    } catch (err) {
      toast.error('Reconciliation refused', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setReconciling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="Loading registration" />
      </div>
    )
  }

  if (loadError || !detail) {
    return (
      <div>
        <Alert tone="danger" title="Could not load this registration">
          {loadError ?? 'Registration not found.'}
        </Alert>
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate('/admin/registrations')}>
            Back to registrations
          </Button>
        </div>
      </div>
    )
  }

  const { registration, payments, audit } = detail
  const profile = registration.athlete_profiles
  const dirty =
    status !== registration.status ||
    paymentStatus !== registration.payment_status ||
    (notes ?? '') !== (registration.notes ?? '')

  return (
    <div>
      <PageHeader
        title={`Registration ${registration.registration_code}`}
        description={`${registration.championships?.name ?? 'Championship'}${
          registration.championship_categories?.name ? ` · ${registration.championship_categories.name}` : ''
        }`}
        actions={
          <Link to="/admin/registrations">
            <Button variant="outline" size="sm">
              ← All registrations
            </Button>
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Athlete</CardTitle>
                <Badge tone="info">{profile.athlete_id}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                {(
                  [
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
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                    <dd className="mt-0.5 break-words text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4">
                <Link to={`/admin/athletes/${profile.id}`}>
                  <Button variant="ghost" size="sm">
                    View athlete profile
                  </Button>
                </Link>
              </div>
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
                    ['Registration ID / Bib', registration.registration_code],
                    ['Category', registration.championship_categories?.name ?? registration.category_name ?? '—'],
                    ['Fee', formatMoney(registration.fee_paise, registration.currency)],
                    ['Registered on', formatDateTime(registration.registered_at)],
                    ['Confirmed on', registration.confirmed_at ? formatDateTime(registration.confirmed_at) : '—'],
                    ['Events', (registration.registration_events ?? []).map((e) => e.event_name).join(', ') || '—'],
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                    <dd className="mt-0.5 break-words text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone={registrationStatusTone(registration.status)}>
                  {titleCase(registration.status)}
                </Badge>
                <Badge tone={paymentStatusTone(registration.payment_status)}>
                  Payment: {titleCase(registration.payment_status)}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment history</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {payments.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-600">No payment attempts recorded.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2.5">Date</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Amount</th>
                        <th className="px-3 py-2.5">Method</th>
                        <th className="px-3 py-2.5">Reference</th>
                        <th className="px-3 py-2.5">Verified</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((payment) => (
                        <tr key={payment.id} className="border-b border-slate-100">
                          <td className="px-3 py-2.5 text-slate-700">{formatDateTime(payment.created_at)}</td>
                          <td className="px-3 py-2.5">
                            <Badge tone={paymentStatusTone(payment.status)}>{titleCase(payment.status)}</Badge>
                            {payment.failure_reason && (
                              <span className="mt-1 block text-xs text-red-600">{payment.failure_reason}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-slate-700">
                            {formatMoney(payment.amount_paise, payment.currency)}
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">{payment.method ? titleCase(payment.method) : '—'}</td>
                          <td className="px-3 py-2.5 font-mono text-xs text-slate-600">
                            {payment.razorpay_payment_id ?? payment.razorpay_order_id}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">
                            {payment.verified_at ? formatDateTime(payment.verified_at) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit trail for this registration</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {audit.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-600">No administrative actions recorded yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {audit.map((entry) => (
                    <li key={entry.id} className="px-5 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-slate-800">{entry.action}</span>
                        <span className="text-xs text-slate-500">{formatDateTime(entry.created_at)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">By {entry.admin_email ?? 'system'}</p>
                      {entry.details && (
                        <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Edit status &amp; notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Registration status" htmlFor="edit-status">
                <Select id="edit-status" value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="withdrawn">Withdrawn</option>
                </Select>
              </Field>
              <Field
                label="Payment status"
                htmlFor="edit-payment"
                hint='"Paid" can only be set by a verified payment or reconciliation.'
              >
                <Select
                  id="edit-payment"
                  value={paymentStatus}
                  onChange={(event) => setPaymentStatus(event.target.value)}
                  disabled={paymentStatus === 'paid'}
                >
                  <option value="pending">Pending</option>
                  <option value="paid" disabled>
                    Paid (verified only)
                  </option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="refunded">Refunded</option>
                </Select>
              </Field>
              <Field label="Internal notes" htmlFor="edit-notes">
                <Textarea
                  id="edit-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={2000}
                  placeholder="Notes are visible to administrators only."
                />
              </Field>
              <Field
                label="Reason for change"
                htmlFor="edit-reason"
                hint="Required when changing a status. Stored in the audit trail."
              >
                <Input
                  id="edit-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. Duplicate entry, refunded in Cashfree"
                />
              </Field>
              <Button variant="primary" onClick={() => setConfirmSave(true)} disabled={!dirty}>
                Review changes
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reconcile payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">
                If the money was received in Cashfree but the registration still shows unpaid, reconcile it here. This
                only works when a captured payment already exists for this registration.
              </p>
              <Field label="Reason" htmlFor="reconcile-reason">
                <Input
                  id="reconcile-reason"
                  value={reconcileReason}
                  onChange={(event) => setReconcileReason(event.target.value)}
                  placeholder="e.g. Captured in gateway, webhook missed"
                />
              </Field>
              <Button
                variant="outline"
                onClick={() => setConfirmReconcile(true)}
                disabled={registration.payment_status === 'paid'}
              >
                Reconcile as paid
              </Button>
              {registration.payment_status === 'paid' && (
                <p className="text-xs text-emerald-700">This registration is already marked as paid.</p>
              )}
            </CardContent>
          </Card>

          {(registration.request_ip || registration.form_snapshot) && (
            <Card>
              <CardHeader>
                <CardTitle>Submission record</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Request IP</p>
                  <p className="break-all font-mono text-xs text-slate-700">{registration.request_ip ?? '—'}</p>
                </div>
                <Separator />
                <details>
                  <summary className="cursor-pointer text-slate-700">Form snapshot as submitted</summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                    {JSON.stringify(registration.form_snapshot ?? {}, null, 2)}
                  </pre>
                </details>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmSave}
        title="Save these changes?"
        description="The change and your reason will be recorded in the audit trail."
        confirmLabel="Save changes"
        loading={saving}
        onClose={() => setConfirmSave(false)}
        onConfirm={() => void handleSave()}
      >
        <ul className="space-y-1 text-sm text-slate-700">
          {status !== registration.status && (
            <li>
              Registration status: <strong>{titleCase(registration.status)}</strong> → <strong>{titleCase(status)}</strong>
            </li>
          )}
          {paymentStatus !== registration.payment_status && (
            <li>
              Payment status: <strong>{titleCase(registration.payment_status)}</strong> →{' '}
              <strong>{titleCase(paymentStatus)}</strong>
            </li>
          )}
          {(notes ?? '') !== (registration.notes ?? '') && <li>Internal notes updated</li>}
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmReconcile}
        title="Reconcile this registration as paid?"
        tone="danger"
        confirmLabel="Reconcile as paid"
        loading={reconciling}
        onClose={() => setConfirmReconcile(false)}
        onConfirm={() => void handleReconcile()}
      >
        <p className="text-sm text-slate-700">
          This marks the registration as paid and confirmed. It is refused unless a captured (verified) payment exists.
        </p>
      </ConfirmDialog>
    </div>
  )
}
