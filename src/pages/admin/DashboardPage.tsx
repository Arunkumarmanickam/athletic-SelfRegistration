import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Table, TableWrap, Td, Th } from '@/components/ui/table'
import { PageHeader } from '@/components/admin/PageHeader'
import { StatCard } from '@/components/admin/StatCard'
import { adminStats } from '@/lib/api'
import {
  formatDateTime,
  formatMoney,
  genderLabel,
  paymentStatusTone,
  registrationStatusTone,
  titleCase,
  championshipStatusTone,
} from '@/lib/format'
import type { DashboardStats, RegistrationAdminRow } from '@/lib/types'

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [recent, setRecent] = useState<RegistrationAdminRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    adminStats()
      .then((result) => {
        if (cancelled) return
        setStats(result.stats)
        setRecent(result.recent)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load dashboard statistics.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div>
      <PageHeader
        title="Overview"
        actions={
          <Link to="/admin/registrations">
            <Button variant="accent" size="sm">
              Manage registrations
            </Button>
          </Link>
        }
      />

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner label="Loading dashboard" />
        </div>
      )}

      {!loading && error && (
        <Alert tone="danger" title="Could not load the dashboard">
          {error}
        </Alert>
      )}

      {!loading && !error && stats && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total registrations" value={stats.registrations_total} />
            <StatCard label="Paid" value={stats.registrations_paid} tone="success" />
            <StatCard label="Pending payment" value={stats.registrations_pending_payment} tone="warning" />
            <StatCard label="Failed payment" value={stats.registrations_failed_payment} tone="danger" />
            <StatCard label="Refunded" value={stats.registrations_refunded} hint="Registrations with a refund" />
            <StatCard label="Cancelled" value={stats.registrations_cancelled} />
            <StatCard label="Athlete profiles" value={stats.athletes_total} />
            <StatCard
              label="Amount collected"
              value={formatMoney(stats.payments_captured_amount_paise)}
              hint={`${stats.payments_captured_count} captured payment${stats.payments_captured_count === 1 ? '' : 's'}`}
              tone="success"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>By championship</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {stats.by_championship.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-slate-600">No championships have been created yet.</p>
                ) : (
                  <TableWrap>
                    <Table>
                      <thead>
                        <tr>
                          <Th>Championship</Th>
                          <Th>Status</Th>
                          <Th className="text-right">Total</Th>
                          <Th className="text-right">Paid</Th>
                          <Th className="text-right">Pending</Th>
                          <Th className="text-right">Failed</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.by_championship.map((row) => (
                          <tr key={row.championship_id}>
                            <Td className="font-medium text-slate-900">{row.name}</Td>
                            <Td>
                              <Badge tone={championshipStatusTone(row.status)}>{titleCase(row.status)}</Badge>
                            </Td>
                            <Td className="text-right tabular-nums">{row.total}</Td>
                            <Td className="text-right tabular-nums text-emerald-700">{row.paid}</Td>
                            <Td className="text-right tabular-nums text-amber-700">{row.pending}</Td>
                            <Td className="text-right tabular-nums text-red-700">{row.failed}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </TableWrap>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Participants</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">By gender</p>
                  {stats.by_gender.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-600">No data yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {stats.by_gender.map((row) => (
                        <li key={row.gender} className="flex items-center justify-between">
                          <span className="text-slate-700">{genderLabel(row.gender)}</span>
                          <span className="font-medium tabular-nums text-slate-900">{row.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top states</p>
                  {stats.by_state.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-600">No data yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {stats.by_state.map((row) => (
                        <li key={row.state} className="flex items-center justify-between gap-3">
                          <span className="truncate text-slate-700">{row.state}</span>
                          <span className="font-medium tabular-nums text-slate-900">{row.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Refunded amount: {formatMoney(stats.payments_refunded_amount_paise)} ·{' '}
                  {stats.payments_failed_count} failed payment
                  {stats.payments_failed_count === 1 ? '' : 's'}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent registrations</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recent.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-600">No registrations yet.</p>
              ) : (
                <TableWrap>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Registration ID</Th>
                        <Th>Athlete</Th>
                        <Th>Championship</Th>
                        <Th>Fee</Th>
                        <Th>Status</Th>
                        <Th>Registered</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((row) => (
                        <tr key={row.id}>
                          <Td className="font-mono text-xs text-slate-900">{row.registration_code}</Td>
                          <Td>
                            <span className="font-medium text-slate-900">{row.athlete_profiles?.full_name}</span>
                            <span className="block font-mono text-xs text-slate-500">
                              {row.athlete_profiles?.athlete_id}
                            </span>
                          </Td>
                          <Td>{row.championships?.name ?? '—'}</Td>
                          <Td>{formatMoney(row.fee_paise, row.currency)}</Td>
                          <Td>
                            <div className="flex flex-wrap gap-1">
                              <Badge tone={registrationStatusTone(row.status)}>{titleCase(row.status)}</Badge>
                              <Badge tone={paymentStatusTone(row.payment_status)}>
                                {titleCase(row.payment_status)}
                              </Badge>
                            </div>
                          </Td>
                          <Td className="text-xs text-slate-600">{formatDateTime(row.registered_at)}</Td>
                          <Td>
                            <Link to={`/admin/registrations/${row.id}`}>
                              <Button variant="ghost" size="sm">
                                View
                              </Button>
                            </Link>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
