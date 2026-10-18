import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Card, EmptyState, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/form-controls'
import { Dialog, ConfirmDialog } from '@/components/ui/dialog'
import { Pagination, Table, TableWrap, Td, Th } from '@/components/ui/table'
import { PageHeader } from '@/components/admin/PageHeader'
import { ExportBar } from '@/components/admin/ExportBar'
import { ApiError, adminPaymentAction, adminPaymentDetail, adminPayments } from '@/lib/api'
import { useChampionshipOptions } from '@/hooks/useChampionshipOptions'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { PAYMENT_EXPORT_COLUMNS } from '@/lib/export-columns'
import { useConfig } from '@/context/ConfigContext'
import { useToast } from '@/context/ToastContext'
import { formatDateTime, formatMoney, paymentStatusTone, titleCase } from '@/lib/format'
import type { AuditRow, PaymentRow } from '@/lib/types'

const PAGE_SIZE = 25

type ActionType = 'refund' | 'fail' | 'reconcile'

interface PaymentDetail {
  payment: PaymentRow
  attempts: PaymentRow[]
  audit: AuditRow[]
}

export function PaymentsPage() {
  const toast = useToast()
  const { config } = useConfig()
  const { options: championships } = useChampionshipOptions()

  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput)
  const [championshipId, setChampionshipId] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  const [rows, setRows] = useState<PaymentRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PaymentDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [action, setAction] = useState<ActionType | null>(null)
  const [reason, setReason] = useState('')
  const [actionBusy, setActionBusy] = useState(false)

  const filters = useMemo(
    () => ({
      search: search.trim() || undefined,
      championshipId: championshipId || undefined,
      status: status || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [search, championshipId, status, dateFrom, dateTo],
  )

  useEffect(() => {
    setPage(1)
  }, [filters])

  const loadList = useCallback(() => {
    let cancelled = false
    setLoading(true)
    adminPayments({ ...filters, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        setRows(result.rows)
        setTotal(result.total)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load payments.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filters, page])

  useEffect(() => loadList(), [loadList])

  const loadDetail = useCallback(async (paymentId: string) => {
    setDetailLoading(true)
    try {
      const result = await adminPaymentDetail(paymentId)
      setDetail(result)
    } catch (err) {
      toast.error('Could not load payment', err instanceof ApiError ? err.message : 'Please try again.')
      setDetailId(null)
    } finally {
      setDetailLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (detailId) void loadDetail(detailId)
    else setDetail(null)
  }, [detailId, loadDetail])

  const runAction = async () => {
    if (!action || !detail) return
    if (!reason.trim()) {
      toast.error('Reason required', 'Please provide a reason for this change.')
      return
    }
    setActionBusy(true)
    try {
      if (action === 'reconcile') {
        const registrationId = detail.payment.registration_id
        await adminPaymentAction({ action: 'reconcile', registrationId, reason: reason.trim() })
      } else {
        await adminPaymentAction({
          action: action === 'refund' ? 'mark_refunded' : 'mark_failed',
          paymentId: detail.payment.id,
          reason: reason.trim(),
        })
      }
      toast.success('Payment updated')
      setAction(null)
      setReason('')
      setDetailId(null)
      loadList()
    } catch (err) {
      toast.error('Action refused', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setActionBusy(false)
    }
  }

  const activeFilters = Object.values(filters).some((value) => value !== undefined)
  const championshipName = championships.find((c) => c.id === championshipId)?.name ?? null

  const actionConfig: Record<ActionType, { title: string; confirm: string; description: string; tone: 'primary' | 'danger' }> = {
    refund: {
      title: 'Mark payment as refunded',
      confirm: 'Mark refunded',
      description:
        'Only captured payments can be refunded. Issue the actual refund in the Razorpay dashboard first, then record it here.',
      tone: 'danger',
    },
    fail: {
      title: 'Mark payment as failed',
      confirm: 'Mark failed',
      description: 'Use this when a payment attempt did not succeed. Captured or refunded payments cannot be marked failed.',
      tone: 'danger',
    },
    reconcile: {
      title: 'Reconcile registration as paid',
      confirm: 'Reconcile as paid',
      description:
        'Marks the registration as paid. This is refused unless a captured (verified) payment exists for this registration.',
      tone: 'danger',
    },
  }

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Every Razorpay order attempt, with the registration it belongs to."
        actions={<ExportBar kind="payments" filters={filters} columns={PAYMENT_EXPORT_COLUMNS} championshipName={championshipName} />}
      />

      {config?.payments_configured === false && (
        <Alert tone="warning" title="Payment method not initialized" className="mb-5">
          Payment method still not initialized yet. Add your Razorpay keys as Supabase
          function secrets to start recording payments.
        </Alert>
      )}

      <Card className="mb-5">
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" htmlFor="pay-search" hint="Order ID, payment ID or registration ID">
            <Input
              id="pay-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search…"
            />
          </Field>
          <Field label="Championship" htmlFor="pay-championship">
            <Select
              id="pay-championship"
              value={championshipId}
              onChange={(event) => setChampionshipId(event.target.value)}
            >
              <option value="">All championships</option>
              {championships.map((championship) => (
                <option key={championship.id} value={championship.id}>
                  {championship.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="pay-status">
            <Select id="pay-status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Any status</option>
              <option value="created">Created</option>
              <option value="authorized">Authorized</option>
              <option value="captured">Captured</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
              <option value="refunded">Refunded</option>
              <option value="expired">Expired</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="pay-from">
              <Input id="pay-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </Field>
            <Field label="To" htmlFor="pay-to">
              <Input id="pay-to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </Field>
          </div>
        </div>
        {activeFilters && (
          <div className="border-t border-slate-100 px-4 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput('')
                setChampionshipId('')
                setStatus('')
                setDateFrom('')
                setDateTo('')
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
      </Card>

      {error && (
        <Alert tone="danger" title="Could not load payments" className="mb-5">
          {error}
        </Alert>
      )}

      <Card>
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner label="Loading payments" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No payments found"
            description={activeFilters ? 'No payments match the current filters.' : 'Payment attempts appear here as athletes pay.'}
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Athlete</Th>
                  <Th>Registration</Th>
                  <Th>Bib</Th>
                  <Th>Championship</Th>
                  <Th>Amount</Th>
                  <Th>Status</Th>
                  <Th>Method</Th>
                  <Th>Order ID</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((payment) => (
                  <tr
                    key={payment.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setDetailId(payment.id)}
                  >
                    <Td className="text-xs text-slate-600">{formatDateTime(payment.created_at)}</Td>
                    <Td>
                      <span className="font-medium text-slate-900">
                        {payment.registrations?.athlete_profiles?.full_name ?? '—'}
                      </span>
                      <span className="block font-mono text-xs text-slate-500">
                        {payment.registrations?.athlete_profiles?.athlete_id ?? ''}
                      </span>
                    </Td>
                    <Td className="font-mono text-xs">{payment.registrations?.registration_code ?? '—'}</Td>
                    <Td className="font-mono text-xs">{payment.registrations?.bib_number ?? '—'}</Td>
                    <Td>{payment.registrations?.championships?.name ?? '—'}</Td>
                    <Td className="tabular-nums">{formatMoney(payment.amount_paise, payment.currency)}</Td>
                    <Td>
                      <Badge tone={paymentStatusTone(payment.status)}>{titleCase(payment.status)}</Badge>
                    </Td>
                    <Td>{payment.method ? titleCase(payment.method) : '—'}</Td>
                    <Td className="font-mono text-xs text-slate-600">{payment.razorpay_order_id}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}

        {!loading && rows.length > 0 && (
          <div className="border-t border-slate-100 px-3">
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </div>
        )}
      </Card>

      <Dialog
        open={Boolean(detailId)}
        title="Payment detail"
        onClose={() => setDetailId(null)}
        className="max-w-2xl"
      >
        {detailLoading || !detail ? (
          <div className="flex justify-center py-10">
            <Spinner label="Loading payment" />
          </div>
        ) : (
          <div className="space-y-5">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {(
                [
                  ['Registration reference', detail.payment.registrations?.registration_code ?? '—'],
                  ['Bib number', detail.payment.registrations?.bib_number ?? '—'],
                  ['Athlete', detail.payment.registrations?.athlete_profiles?.full_name ?? '—'],
                  ['Athlete ID', detail.payment.registrations?.athlete_profiles?.athlete_id ?? '—'],
                  ['Championship', detail.payment.registrations?.championships?.name ?? '—'],
                  ['Order ID', detail.payment.razorpay_order_id],
                  ['Payment ID', detail.payment.razorpay_payment_id ?? '—'],
                  ['Amount', formatMoney(detail.payment.amount_paise, detail.payment.currency)],
                  ['Status', titleCase(detail.payment.status)],
                  ['Method', detail.payment.method ? titleCase(detail.payment.method) : '—'],
                  ['Attempt', String(detail.payment.attempt_number)],
                  ['Signature verified', detail.payment.signature_verified ? 'Yes' : 'No'],
                  ['Verified at', detail.payment.verified_at ? formatDateTime(detail.payment.verified_at) : '—'],
                  ['Failure reason', detail.payment.failure_reason ?? '—'],
                  ['Registration payment status', titleCase(detail.payment.registrations?.payment_status ?? '—')],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                  <dd className="mt-0.5 break-words text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-900">Attempt history for this registration</p>
              <div className="max-h-40 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.attempts.map((attempt) => (
                      <tr key={attempt.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-xs text-slate-600">{formatDateTime(attempt.created_at)}</td>
                        <td className="px-3 py-2">
                          <Badge tone={paymentStatusTone(attempt.status)}>{titleCase(attempt.status)}</Badge>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-slate-700">
                          {formatMoney(attempt.amount_paise, attempt.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={detail.payment.status !== 'captured'}
                onClick={() => setAction('refund')}
              >
                Mark refunded
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={['captured', 'refunded'].includes(detail.payment.status)}
                onClick={() => setAction('fail')}
              >
                Mark failed
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAction('reconcile')}>
                Reconcile registration
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={action !== null}
        title={action ? actionConfig[action].title : ''}
        description={action ? actionConfig[action].description : undefined}
        confirmLabel={action ? actionConfig[action].confirm : 'Confirm'}
        tone={action ? actionConfig[action].tone : 'primary'}
        loading={actionBusy}
        onClose={() => {
          setAction(null)
          setReason('')
        }}
        onConfirm={() => void runAction()}
      >
        <Field label="Reason" htmlFor="payment-action-reason" required>
          <Input
            id="payment-action-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Recorded in the audit trail"
          />
        </Field>
      </ConfirmDialog>
    </div>
  )
}
