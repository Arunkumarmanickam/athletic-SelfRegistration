import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Card, EmptyState, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/form-controls'
import { Pagination, Table, TableWrap, Td, Th } from '@/components/ui/table'
import { PageHeader } from '@/components/admin/PageHeader'
import { adminAthletes } from '@/lib/api'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { formatDate, genderLabel } from '@/lib/format'
import type { AthleteProfile } from '@/lib/types'

const PAGE_SIZE = 25

type AthleteRow = AthleteProfile & { registration_count: number }

export function AthletesPage() {
  const navigate = useNavigate()
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput)
  const [state, setState] = useState('')
  const [gender, setGender] = useState('')
  const [page, setPage] = useState(1)

  const [rows, setRows] = useState<AthleteRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const query = useMemo(
    () => ({ search: search.trim() || undefined, state: state.trim() || undefined, gender: gender || undefined }),
    [search, state, gender],
  )

  useEffect(() => {
    setPage(1)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    adminAthletes({ ...query, page, pageSize: PAGE_SIZE })
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

  const activeFilters = search.trim() !== '' || state.trim() !== '' || gender !== ''

  return (
    <div>
      <PageHeader title="Athletes" description="Permanent athlete profiles, independent of any championship." />

      <Card className="mb-5">
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <Field label="Search" htmlFor="athlete-search" hint="Name, Athlete ID or mobile">
            <Input
              id="athlete-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search…"
            />
          </Field>
          <Field label="State / region" htmlFor="athlete-state">
            <Input
              id="athlete-state"
              value={state}
              onChange={(event) => setState(event.target.value)}
              placeholder="Exact state"
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
        </div>
        {activeFilters && (
          <div className="border-t border-slate-100 px-4 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput('')
                setState('')
                setGender('')
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
            title="No athletes found"
            description={activeFilters ? 'No athletes match the current filters.' : 'Athlete profiles appear here as people register.'}
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Athlete ID</Th>
                  <Th>Name</Th>
                  <Th>Date of birth</Th>
                  <Th>Gender</Th>
                  <Th>Mobile</Th>
                  <Th>State</Th>
                  <Th className="text-right">Registrations</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/admin/athletes/${row.id}`)}
                  >
                    <Td className="font-mono text-xs font-semibold text-slate-900">{row.athlete_id}</Td>
                    <Td className="font-medium text-slate-900">{row.full_name}</Td>
                    <Td>{formatDate(row.date_of_birth)}</Td>
                    <Td>{genderLabel(row.gender)}</Td>
                    <Td className="font-mono text-xs">{row.mobile_e164}</Td>
                    <Td>{row.state}</Td>
                    <Td className="text-right tabular-nums">{row.registration_count}</Td>
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

      <p className="mt-4 text-xs text-slate-500">
        Athlete IDs are permanent and are never reissued. Editing a profile does not change its Athlete ID.
      </p>
    </div>
  )
}
