import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Badge, Card, EmptyState, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/form-controls'
import { Pagination, Table, TableWrap, Td, Th } from '@/components/ui/table'
import { PageHeader } from '@/components/admin/PageHeader'
import { ApiError, adminExportAthletes, adminRegistrations } from '@/lib/api'
import { useChampionshipOptions } from '@/hooks/useChampionshipOptions'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { downloadBlob } from '@/lib/download'
import { useToast } from '@/context/ToastContext'
import { formatDate, formatDateTime, paymentStatusTone, titleCase } from '@/lib/format'
import type { RegistrationAdminRow } from '@/lib/types'

const PAGE_SIZE = 25
const ALL = 'all'

/**
 * Registered athletes, championship by championship.
 *
 * Each championship gets its own tab-like chip; "All championships" shows
 * every registered athlete across every championship the administrator has
 * created. The export downloads the organiser's bib-preparation template
 * (S.No, Name, Gender, Age Category, DOB, Representing, Event1..N,
 * T-shirt size, Bib No) for the current selection.
 */
export function AthletesPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { options: championships, loading: championshipsLoading } = useChampionshipOptions()

  const [championshipId, setChampionshipId] = useState<string>(ALL)
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput)
  const [gender, setGender] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)

  const [rows, setRows] = useState<RegistrationAdminRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const query = useMemo(
    () => ({
      championshipId: championshipId === ALL ? undefined : championshipId,
      search: search.trim() || undefined,
      gender: gender || undefined,
      paymentStatus: paymentStatus || undefined,
    }),
    [championshipId, search, gender, paymentStatus],
  )

  useEffect(() => {
    setPage(1)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    adminRegistrations({ ...query, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        setRows(result.rows)
        setTotal(result.total)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load athletes.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, page])

  const exportFile = async () => {
    setExporting(true)
    try {
      const result = await adminExportAthletes(query)
      downloadBlob(result.blob, result.filename)
      toast.success(
        'Export ready',
        `${result.rows} athlete${result.rows === 1 ? '' : 's'} downloaded in the template format.`,
      )
    } catch (err) {
      toast.error('Export failed', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const activeFilters = search.trim() !== '' || gender !== '' || paymentStatus !== ''
  const selectedChampionship = championships.find((option) => option.id === championshipId)

  return (
    <div>
      <PageHeader
        title="Registered athletes"
        description="Athletes registered for each championship, with their bib numbers."
        actions={
          <Button variant="outline" size="sm" loading={exporting} disabled={exporting} onClick={() => void exportFile()}>
            Export XLSX
          </Button>
        }
      />

      {/* Championship selector */}
      {championshipsLoading ? (
        <div className="mb-5 flex justify-center py-4">
          <Spinner label="Loading championships" />
        </div>
      ) : (
        championships.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setChampionshipId(ALL)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                championshipId === ALL
                  ? 'border-teal-600 bg-teal-600 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              All championships
            </button>
            {championships.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setChampionshipId(option.id)}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  championshipId === option.id
                    ? 'border-teal-600 bg-teal-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {option.name}
              </button>
            ))}
          </div>
        )
      )}

      {/* Filters */}
      <Card className="mb-5">
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <Field label="Search" htmlFor="athlete-search" hint="Name, Athlete ID, mobile or bib number">
            <Input
              id="athlete-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search…"
            />
          </Field>
          <Field label="Gender" htmlFor="athlete-gender">
            <Select id="athlete-gender" value={gender} onChange={(event) => setGender(event.target.value)}>
              <option value="">Any gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Payment" htmlFor="athlete-payment">
            <Select id="athlete-payment" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}>
              <option value="">Any payment status</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
              <option value="refunded">Refunded</option>
            </Select>
          </Field>
        </div>
        {activeFilters && (
          <div className="border-t border-slate-100 px-4 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput('')
                setGender('')
                setPaymentStatus('')
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
      </Card>

      {error && (
        <Alert tone="danger" title="Could not load athletes" className="mb-5">
          {error}
        </Alert>
      )}

      <Card>
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner label="Loading athletes" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No registered athletes found"
            description={
              activeFilters
                ? 'No athletes match the current filters.'
                : championshipId === ALL
                  ? 'Athletes will appear here as they register for any championship.'
                  : 'No athletes have registered for this championship yet.'
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Bib</Th>
                  <Th>Athlete</Th>
                  <Th>DOB</Th>
                  <Th>Gender</Th>
                  <Th>Age category</Th>
                  <Th>Events</Th>
                  <Th>Representing</Th>
                  {championshipId === ALL && <Th>Championship</Th>}
                  <Th>Payment</Th>
                  <Th>Registered</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const profile = row.athlete_profiles
                  return (
                    <tr
                      key={row.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => navigate(`/admin/registrations/${row.id}`)}
                    >
                      <Td className="font-mono text-sm font-semibold text-slate-900">{row.bib_number ?? '—'}</Td>
                      <Td>
                        <p className="font-medium text-slate-900">{profile?.full_name ?? '—'}</p>
                        <p className="font-mono text-xs text-slate-500">{profile?.athlete_id}</p>
                      </Td>
                      <Td>{formatDate(profile?.date_of_birth)}</Td>
                      <Td>{titleCase(profile?.gender ?? '')}</Td>
                      <Td>{row.championship_categories?.name ?? row.category_name ?? '—'}</Td>
                      <Td className="max-w-56">
                        <span className="block truncate text-slate-700">
                          {(row.registration_events ?? []).map((event) => event.event_name).join(', ') || '—'}
                        </span>
                      </Td>
                      <Td>{profile?.representing || profile?.district || profile?.state || '—'}</Td>
                      {championshipId === ALL && <Td>{row.championships?.name ?? '—'}</Td>}
                      <Td>
                        <Badge tone={paymentStatusTone(row.payment_status)}>{titleCase(row.payment_status)}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-slate-600">{formatDateTime(row.registered_at)}</Td>
                    </tr>
                  )
                })}
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

      <p className="mt-4 text-xs text-slate-500">
        {selectedChampionship
          ? `Showing athletes registered for ${selectedChampionship.name}. `
          : 'Showing athletes from every championship. '}
        The export uses your current filters and includes every matching athlete, not just this page. Bib numbers are
        issued automatically at registration.
      </p>
    </div>
  )
}
