import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/form-controls'
import { Dialog } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/display'
import { useToast } from '@/context/ToastContext'
import { ApiError, adminExportPayments, adminExportRegistrations } from '@/lib/api'
import { downloadBlob } from '@/lib/download'
import type { ExportColumnOption } from '@/lib/export-columns'
import type { RegistrationFilters } from '@/lib/types'

interface ExportBarProps {
  kind: 'registrations' | 'payments'
  /** The filters currently applied to the on-screen table. */
  filters: Record<string, unknown> | RegistrationFilters
  columns: ExportColumnOption[]
  /** When set, an extra button offers a championship-scoped export. */
  championshipName?: string | null
}

/**
 * Excel export controls. Every export is generated on the server from the full
 * matching dataset (not just the visible page) and downloaded as a real .xlsx.
 */
export function ExportBar({ kind, filters, columns, championshipName }: ExportBarProps) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>(() => columns.map((column) => column.key))

  const allKeys = useMemo(() => columns.map((column) => column.key), [columns])

  const run = async (
    label: string,
    exportFilters: Record<string, unknown> | RegistrationFilters,
    exportColumns?: string[],
  ) => {
    setBusy(label)
    try {
      const result =
        kind === 'registrations'
          ? await adminExportRegistrations(exportFilters as RegistrationFilters, exportColumns)
          : await adminExportPayments(exportFilters as Record<string, unknown>, exportColumns)
      downloadBlob(result.blob, result.filename)
      toast.success(
        'Export ready',
        `${result.rows} row${result.rows === 1 ? '' : 's'} downloaded as an Excel workbook.`,
      )
    } catch (err) {
      toast.error('Export failed', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const toggleColumn = (key: string) => {
    setSelected((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))
  }

  const championshipId = typeof filters.championshipId === 'string' ? filters.championshipId : ''
  const onlyChampionship = { championshipId }
  const busyAny = busy !== null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        loading={busy === 'filtered'}
        disabled={busyAny}
        onClick={() => void run('filtered', filters)}
      >
        Export filtered
      </Button>
      {championshipId && (
        <Button
          variant="outline"
          size="sm"
          loading={busy === 'championship'}
          disabled={busyAny}
          onClick={() => void run('championship', onlyChampionship)}
        >
          {championshipName ? `Export ${championshipName}` : 'Export this championship'}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        loading={busy === 'all'}
        disabled={busyAny}
        onClick={() => void run('all', {})}
      >
        Export all
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busyAny}
        onClick={() => setPickerOpen(true)}
      >
        Choose columns…
      </Button>

      <Dialog
        open={pickerOpen}
        title="Choose columns to export"
        description="The export uses your current filters and includes every matching row, not just this page."
        onClose={() => setPickerOpen(false)}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(allKeys)} disabled={busyAny}>
              Select all
            </Button>
            <Button variant="ghost" onClick={() => setSelected([])} disabled={busyAny}>
              Clear
            </Button>
            <Button variant="outline" onClick={() => setPickerOpen(false)} disabled={busyAny}>
              Cancel
            </Button>
            <Button
              variant="accent"
              loading={busy === 'columns'}
              disabled={busyAny || selected.length === 0}
              onClick={() => {
                setPickerOpen(false)
                void run('columns', filters, selected)
              }}
            >
              Export {selected.length} column{selected.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        {selected.length === 0 && (
          <Alert tone="warning" className="mb-3">
            Select at least one column to export.
          </Alert>
        )}
        <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {columns.map((column) => (
            <Checkbox
              key={column.key}
              label={column.label}
              checked={selected.includes(column.key)}
              onChange={() => toggleColumn(column.key)}
            />
          ))}
        </div>
      </Dialog>
    </div>
  )
}
