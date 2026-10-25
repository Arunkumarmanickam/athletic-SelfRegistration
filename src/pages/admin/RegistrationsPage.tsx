import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Badge, Card, EmptyState, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/form-controls'
import { Pagination, Table, TableWrap, Td, Th } from '@/components/ui/table'
import { PageHeader } from '@/components/admin/PageHeader'
import { ExportBar } from '@/components/admin/ExportBar'
import { adminRegistrations } from '@/lib/api'
import { useChampionshipOptions } from '@/hooks/useChampionshipOptions'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { REGISTRATION_EXPORT_COLUMNS } from '@/lib/export-columns'
import { formatDateTime, formatMoney, genderLabel, paymentStatusTone, registrationStatusTone, titleCase } from '@/lib/format'
import type { RegistrationAdminRow, RegistrationFilters } from '@/lib/types'

const PAGE_SIZE = 25

type SortBy = 'registered_at' | 'athlete_name' | 'registration_code' | 'bib_number' | 'fee_paise' | 'payment_status' | 'status'

interface FilterState {
  championshipId: string
  paymentStatus: string
  registrationStatus: string
  state: string
  gender: string
  dateFrom: string
  dateTo: string
}

const EMPTY_FILTERS: FilterState = {
  championshipId: '',
  paymentStatus: '',
  registrationStatus: '',
  state: '',
  gender: '',
  dateFrom: '',
  dateTo: '',
}

export function RegistrationsPage() {
  const navigate = useNavigate()
  const { options: championships } = useChampionshipOptions()

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput)
  const [sortBy, setSortBy] = useState<SortBy>('registered_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  const [rows, setRows] = useState<RegistrationAdminRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const requestFilters = useMemo<RegistrationFilters>(
    () => ({
      championshipId: filters.championshipId || undefined,
      paymentStatus: filters.paymentStatus || undefined,
      registrationStatus: filters.registrationStatus || undefined,
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

  // Reset to the first page whenever the query changes.
  useEffect(() => {
    setPage(1)
  }, [requestFilters])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    adminRegistrations({ ...requestFilters, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        setRows(result.rows)
        setTotal(result.total)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load registrations.')
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
      setSortDir(column === 'registered_at' ? 'desc' : 'asc')
    }
  }

  const sorted = (column: SortBy): 'asc' | 'desc' | false => (sortBy === column ? sortDir : false)
  const activeFilters = Object.values(filters).some((value) => value !== '') || search.trim() !== ''

  const championshipName = championships.find((c) => c.id === filters.championshipId)?.name ?? null

  return (
    <div>
      <PageHeader
        title="Registrations"
        actions={<ExportBar kind="registrations" filters={requestFilters} columns={REGISTRATION_EXPORT_COLUMNS} championshipName={championshipName} />}
      />

      <Card className="mb-5">
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" htmlFor="reg-search" hint="Name, Athlete ID, mobile or bib number">
            <Input
              id="reg-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search…"
            />
          </Field>
          <Field label="Championship" htmlFor="reg-championship">
            <Select
              id="reg-championship"
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
          <Field label="Payment status" htmlFor="reg-payment">
            <Select
              id="reg-payment"
              value={filters.paymentStatus}
              onChange={(event) => update({ paymentStatus: event.target.value })}
            >
              <option value="">Any payment status</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
              <option value="refunded">Refunded</option>
            </Select>
          </Field>
          <Field label="Registration status" htmlFor="reg-status">
            <Select
              id="reg-status"
              value={filters.registrationStatus}
              onChange={(event) => update({ registrationStatus: event.target.value })}
            >
              <option value="">Any registration status</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
              <option value="withdrawn">Withdrawn</option>
            </Select>
          </Field>
          <Field label="Gender" htmlFor="reg-gender">
            <Select id="reg-gender" value={filters.gender} onChange={(event) => update({ gender: event.target.value })}>
              <option value="">Any gender</option>
              <option value="male">Men</option>
              <option value="female">Women</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="State / region" htmlFor="reg-state">
            <Input
              id="reg-state"
              value={filters.state}
              onChange={(event) => update({ state: event.target.value })}
              placeholder="Exact state"
            />
          </Field>
          <Field label="Registered from" htmlFor="reg-from">
            <Input
              id="reg-from"
              type="date"
              value={filters.dateFrom}
              onChange={(event) => update({ dateFrom: event.target.value })}
            />
          </Field>
          <Field label="Registered to" htmlFor="reg-to">
            <Input
              id="reg-to"
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
        <Alert tone="danger" title="Could not load registrations" className="mb-5">
          {error}
        </Alert>
      )}

      <Card>
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner label="Loading registrations" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No registrations found"
            description={
              activeFilters
                ? 'No registrations match the current filters. Try widening your search.'
                : 'Registrations will appear here as athletes sign up.'
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th sortable sorted={sorted('registration_code')} onSort={() => toggleSort('registration_code')}>
                    Reference
                  </Th>
                  <Th sortable sorted={sorted('bib_number')} onSort={() => toggleSort('bib_number')}>
                    Bib
                  </Th>
                  <Th sortable sorted={sorted('athlete_name')} onSort={() => toggleSort('athlete_name')}>
                    Athlete
                  </Th>
                  <Th>Championship</Th>
                  <Th>Category &amp; events</Th>
                  <Th sortable sorted={sorted('fee_paise')} onSort={() => toggleSort('fee_paise')}>
                    Fee
                  </Th>
                  <Th sortable sorted={sorted('payment_status')} onSort={() => toggleSort('payment_status')}>
                    Payment
                  </Th>
                  <Th sortable sorted={sorted('status')} onSort={() => toggleSort('status')}>
                    Registration
                  </Th>
                  <Th sortable sorted={sorted('registered_at')} onSort={() => toggleSort('registered_at')}>
                    Registered
                  </Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/admin/registrations/${row.id}`)}
                  >
                    <Td className="font-mono text-xs font-semibold text-slate-900">{row.registration_code}</Td>
                    <Td className="font-mono text-xs text-slate-900">{row.bib_number ?? '—'}</Td>
                    <Td>
                      <span className="font-medium text-slate-900">{row.athlete_profiles?.full_name}</span>
                      <span className="block font-mono text-xs text-slate-500">
                        {row.athlete_profiles?.athlete_id}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {genderLabel(row.athlete_profiles?.gender)} · {row.athlete_profiles?.state}
                      </span>
                    </Td>
                    <Td>{row.championships?.name ?? '—'}</Td>
                    <Td>
                      <span className="block text-slate-700">{row.championship_categories?.name ?? row.category_name ?? '—'}</span>
                      <span className="block text-xs text-slate-500">
                        {(row.registration_events ?? []).map((event) => event.event_name).join(', ') || 'No events'}
                      </span>
                    </Td>
                    <Td className="tabular-nums">{formatMoney(row.fee_paise, row.currency)}</Td>
                    <Td>
                      <Badge tone={paymentStatusTone(row.payment_status)}>{titleCase(row.payment_status)}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={registrationStatusTone(row.status)}>{titleCase(row.status)}</Badge>
                    </Td>
                    <Td className="text-xs text-slate-600">{formatDateTime(row.registered_at)}</Td>
                    <Td>
                      <Link
                        to={`/admin/registrations/${row.id}`}
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
