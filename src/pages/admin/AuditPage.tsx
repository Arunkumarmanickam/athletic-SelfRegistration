import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Card, EmptyState, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/form-controls'
import { Dialog } from '@/components/ui/dialog'
import { Pagination, Table, TableWrap, Td, Th } from '@/components/ui/table'
import { PageHeader } from '@/components/admin/PageHeader'
import { adminAudit } from '@/lib/api'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { formatDateTime, titleCase } from '@/lib/format'
import type { AuditRow } from '@/lib/types'

const PAGE_SIZE = 25

// Entity types written by the Edge Functions. Offered as a convenience filter;
// the search box still matches anything.
const ENTITY_TYPES = [
  { value: 'registration', label: 'Registration' },
  { value: 'athlete_profile', label: 'Athlete profile' },
  { value: 'payment', label: 'Payment' },
  { value: 'championship', label: 'Championship' },
  { value: 'championship_category', label: 'Category' },
  { value: 'championship_event', label: 'Event' },
  { value: 'admin_user', label: 'Administrator' },
  { value: 'app_settings', label: 'Settings' },
]

function actionTone(action: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (action.endsWith('.deleted') || action.includes('refund') || action.includes('failed')) return 'danger'
  if (action.endsWith('.created') || action.endsWith('.bootstrap')) return 'success'
  if (action.includes('update') || action.includes('reconcile')) return 'info'
  return 'neutral'
}

/**
 * Read-only audit trail. Every administrative change is recorded server-side;
 * this page surfaces that history for accountability.
 */
export function AuditPage() {
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput)
  const [entityType, setEntityType] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [page, setPage] = useState(1)

  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<AuditRow | null>(null)

  const filters = useMemo(
    () => ({
      search: search.trim() || undefined,
      entityType: entityType || undefined,
      actionFilter: actionFilter.trim() || undefined,
    }),
    [search, entityType, actionFilter],
  )

  useEffect(() => {
    setPage(1)
  }, [filters])

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    adminAudit({ ...filters, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        setRows(result.rows)
        setTotal(result.total)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load the audit trail.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filters, page])

  useEffect(() => load(), [load])

  const activeFilters = Object.values(filters).some((value) => value !== undefined)

  return (
    <div>
      <PageHeader
        title="Audit trail"
        actions={
          <Button variant="outline" size="sm" onClick={() => load()}>
            Refresh
          </Button>
        }
      />

      <Card className="mb-5">
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <Field label="Search" htmlFor="audit-search" hint="Administrator, action or record id">
            <Input
              id="audit-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search…"
            />
          </Field>
          <Field label="Record type" htmlFor="audit-entity">
            <Select id="audit-entity" value={entityType} onChange={(event) => setEntityType(event.target.value)}>
              <option value="">All record types</option>
              {ENTITY_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Action" htmlFor="audit-action" hint="Exact action, e.g. registration.updated">
            <Input
              id="audit-action"
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
              placeholder="registration.updated"
            />
          </Field>
        </div>
        {activeFilters && (
          <div className="border-t border-slate-100 px-4 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput('')
                setEntityType('')
                setActionFilter('')
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
      </Card>

      {error && (
        <Alert tone="danger" title="Could not load the audit trail" className="mb-5">
          {error}
        </Alert>
      )}

      <Card>
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner label="Loading audit trail" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No audit entries"
            description={
              activeFilters
                ? 'No entries match the current filters.'
                : 'Administrative actions are recorded here as they happen.'
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Administrator</Th>
                  <Th>Action</Th>
                  <Th>Record</Th>
                  <Th>Details</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{formatDateTime(row.created_at)}</Td>
                    <Td className="text-slate-700">{row.admin_email ?? 'System'}</Td>
                    <Td>
                      <Badge tone={actionTone(row.action)}>{row.action}</Badge>
                    </Td>
                    <Td>
                      <span className="text-slate-700">{titleCase(row.entity_type)}</span>
                      {row.entity_id && (
                        <span className="block font-mono text-xs text-slate-500">{row.entity_id}</span>
                      )}
                    </Td>
                    <Td className="max-w-xs truncate text-xs text-slate-600">
                      {row.details ? JSON.stringify(row.details) : '—'}
                    </Td>
                    <Td>
                      {row.details && (
                        <Button variant="ghost" size="sm" onClick={() => setDetail(row)}>
                          View
                        </Button>
                      )}
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

      <Dialog open={detail !== null} title="Audit entry" onClose={() => setDetail(null)} className="max-w-2xl">
        {detail && (
          <div className="space-y-4">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {(
                [
                  ['When', formatDateTime(detail.created_at)],
                  ['Administrator', detail.admin_email ?? 'System'],
                  ['Action', detail.action],
                  ['Record type', titleCase(detail.entity_type)],
                  ['Record id', detail.entity_id ?? '—'],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                  <dd className="mt-0.5 break-words text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Details</p>
              <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                {detail.details ? JSON.stringify(detail.details, null, 2) : 'No details recorded.'}
              </pre>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}
