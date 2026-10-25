import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Badge, Card, EmptyState, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/form-controls'
import { Pagination, Table, TableWrap, Td, Th } from '@/components/ui/table'
import { adminApplications } from '@/lib/api'
import type { ChampionshipOption } from '@/hooks/useChampionshipOptions'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import {
  applicationStatusLabel,
  applicationStatusTone,
  formatDateTime,
  formatMoney,
  genderLabel,
} from '@/lib/format'
import type { ApplicationAdminRow, ApplicationFilters } from '@/lib/types'

const PAGE_SIZE = 25

type SortBy = 'created_at' | 'athlete_name' | 'application_number' | 'fee_paise' | 'application_status'

interface FilterState {
  championshipId: string
  applicationStatus: string
  state: string
  gender: string
  dateFrom: string
  dateTo: string
}

const EMPTY_FILTERS: FilterState = {
  championshipId: '',
  applicationStatus: '',
  state: '',
  gender: '',
  dateFrom: '',
  dateTo: '',
}

/** Short description of the most recent gateway attempt. */
function latestAttemptText(row: ApplicationAdminRow): string {
  const order = row.latest_order
  if (!order) return 'No payment attempt'
  if (order.status === 'failed') return order.failure_reason || 'Latest attempt failed'
  switch (order.status) {
    case 'authorized':
      return 'Payment authorised'
    case 'captured':
      return 'Payment captured'
    case 'expired':
      return 'Payment order expired'
    case 'created':
    default:
      return 'Payment order created'
  }
}

export function ApplicationsPanel({ championships }: { championships: ChampionshipOption[] }) {
  const navigate = useNavigate()

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput)
  const [sortBy, setSortBy] = useState<SortBy>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  const [rows, setRows] = useState<ApplicationAdminRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const requestFilters = useMemo<ApplicationFilters>(
    () => ({
      championshipId: filters.championshipId || undefined,
      applicationStatus: filters.applicationStatus || undefined,
      state: filters.state.trim() || undefined,
      gender: filters.gender || undefined,
      search: search.trim() || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      sortBy,
      sortDir,
    }),
    [filters, search, sortBy, sortDir],
  )

  useEffect(() => {
    setPage(1)
  }, [requestFilters])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    adminApplications({ ...requestFilters, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        setRows(result.rows)
        setTotal(result.total)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load applications.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [requestFilters, page])

  const update = (patch: Partial<FilterState>) => setFilters((current) => ({ ...current, ...patch }))

  const toggleSort = (column: SortBy) => {
    if (sortBy === column) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(column)
      setSortDir(column === 'created_at' ? 'desc' : 'asc')
    }
  }

  const sorted = (column: SortBy): 'asc' | 'desc' | false => (sortBy === column ? sortDir : false)
  const activeFilters = Object.values(filters).some((value) => value !== '') || search.trim() !== ''

  return (
    <div>
      <Alert tone="info" title="Bib numbers are not issued yet" className="mb-5">
        These submissions are unpaid applications only. No Athlete ID or bib number exists until the payment gateway
        confirms the payment; the bib is generated automatically after that verification.
      </Alert>

      <Card className="mb-5">
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" htmlFor="app-search" hint="Name, application number or mobile">
            <Input
              id="app-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search…"
            />
          </Field>
          <Field label="Championship" htmlFor="app-championship">
            <Select
              id="app-championship"
              value={filters.championshipId}
              onChange={(event) => update({ championshipId: event.target.value })}
            >
              <option value="">All championships</option>
              {championships.map((championship) => (
                <option key={championship.id} value={championship.id}>
                  {championship.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Payment status" htmlFor="app-payment">
            <Select
              id="app-payment"
              value={filters.applicationStatus}
              onChange={(event) => update({ applicationStatus: event.target.value })}
            >
              <option value="">Any payment status</option>
              <option value="pending">Pending payment</option>
              <option value="failed">Payment failed</option>
              <option value="abandoned">Abandoned / dropped</option>
              <option value="started">Not paid (no attempt)</option>
            </Select>
          </Field>
          <Field label="Gender" htmlFor="app-gender">
            <Select id="app-gender" value={filters.gender} onChange={(event) => update({ gender: event.target.value })}>
              <option value="">Any gender</option>
              <option value="male">Men</option>
              <option value="female">Women</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="State / region" htmlFor="app-state">
            <Input
              id="app-state"
              value={filters.state}
              onChange={(event) => update({ state: event.target.value })}
              placeholder="Exact state"
            />
          </Field>
          <Field label="Started from" htmlFor="app-from">
            <Input
              id="app-from"
              type="date"
              value={filters.dateFrom}
              onChange={(event) => update({ dateFrom: event.target.value })}
            />
          </Field>
          <Field label="Started to" htmlFor="app-to">
            <Input
              id="app-to"
              type="date"
              value={filters.dateTo}
              onChange={(event) => update({ dateTo: event.target.value })}
            />
          </Field>
        </div>
        {activeFilters && (
          <div className="border-t border-slate-100 px-4 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilters(EMPTY_FILTERS)
                setSearchInput('')
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
      </Card>

      {error && (
        <Alert tone="danger" title="Could not load applications" className="mb-5">
          {error}
        </Alert>
      )}

      <Card>
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner label="Loading applications" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={activeFilters ? 'No applications match these filters' : 'No unpaid applications'}
            description={
              activeFilters
                ? 'Try widening your search or clearing the payment status filter.'
                : 'Submissions appear here after the form is saved and remain until payment is verified.'
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th sortable sorted={sorted('application_number')} onSort={() => toggleSort('application_number')}>
                    Application
                  </Th>
                  <Th>Bib</Th>
                  <Th sortable sorted={sorted('athlete_name')} onSort={() => toggleSort('athlete_name')}>
                    Athlete
                  </Th>
                  <Th>Championship</Th>
                  <Th>Category &amp; events</Th>
                  <Th sortable sorted={sorted('fee_paise')} onSort={() => toggleSort('fee_paise')}>
                    Fee
                  </Th>
                  <Th sortable sorted={sorted('application_status')} onSort={() => toggleSort('application_status')}>
                    Payment
                  </Th>
                  <Th sortable sorted={sorted('created_at')} onSort={() => toggleSort('created_at')}>
                    Started
                  </Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/admin/applications/${row.id}`)}
                  >
                    <Td className="font-mono text-xs font-semibold text-slate-900">{row.application_number}</Td>
                    <Td>
                      <span
                        className="text-xs text-slate-400"
                        title="Issued only after the payment gateway confirms the payment"
                      >
                        Not issued
                      </span>
                    </Td>
                    <Td>
                      <span className="font-medium text-slate-900">{row.personal.full_name || '—'}</span>
                      <span className="block font-mono text-xs text-slate-500">
                        {row.personal.mobile_e164 || row.personal.mobile_number || '—'}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {genderLabel(row.personal.gender)} · {row.personal.state || '—'}
                      </span>
                    </Td>
                    <Td>{row.championships?.name ?? '—'}</Td>
                    <Td>
                      <span className="block text-slate-700">
                        {row.championship_categories?.name ?? row.category_name ?? '—'}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {row.events.map((event) => event.name).join(', ') || 'No events'}
                      </span>
                    </Td>
                    <Td className="tabular-nums">{formatMoney(row.fee_paise, row.currency)}</Td>
                    <Td>
                      <Badge tone={applicationStatusTone(row.application_status)}>
                        {applicationStatusLabel(row.application_status)}
                      </Badge>
                      <span className="mt-1 block max-w-[220px] text-xs text-slate-500">
                        {row.payment_orders.length > 1
                          ? `${row.payment_orders.length} attempts · ${latestAttemptText(row)}`
                          : latestAttemptText(row)}
                      </span>
                    </Td>
                    <Td className="text-xs text-slate-600">{formatDateTime(row.created_at)}</Td>
                    <Td>
                      <Link
                        to={`/admin/applications/${row.id}`}
                        onClick={(event) => event.stopPropagation()}
                        className="text-sm font-medium text-orange-700 hover:underline"
                      >
                        View
                      </Link>
                    </Td>
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
    </div>
  )
}
