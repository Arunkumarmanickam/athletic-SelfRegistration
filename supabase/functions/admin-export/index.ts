// Excel export (real .xlsx via SheetJS).
//
//   * Exports ALL rows matching the admin's current filters (batched queries,
//     not just the visible page).
//   * Supports exporting every column, or a caller-selected subset ("columns").
//   * Preserves leading zeros / "+" in identifiers by writing them as text.
//   * Neutralises spreadsheet formula injection in user-supplied text.
//   * Never includes OTPs, session tokens or other secrets.
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'
import { handler } from '../_shared/handler.ts'
import { errorJson } from '../_shared/responses.ts'
import { requireAdmin, writeAudit } from '../_shared/admin-auth.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { str } from '../_shared/helpers.ts'
import {
  fetchAllPayments,
  fetchAllRegistrations,
  sanitizeFilters,
  sanitizePaymentFilters,
} from '../_shared/admin-queries.ts'

const MAX_ROWS = 100000

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

interface BuildContext {
  paymentRefs: Map<string, { paymentId: string; orderId: string }>
}

interface ColumnDef {
  key: string
  header: string
  width: number
  /** Written as text so leading zeros and phone "+" signs survive. */
  text?: boolean
  /** Rendered with a currency number format. */
  currency?: boolean
  value: (row: Row, ctx: BuildContext) => string | number
}

/** Prevents CSV/Excel formula injection for user-supplied text. */
function safeText(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

function formatDateTime(value: unknown): string {
  if (!value) return ''
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}`
}

const GENDER_LABELS: Record<string, string> = { male: 'Male', female: 'Female', other: 'Other' }

function profileOf(row: Row): Row | null {
  return (row.athlete_profiles as Row | null) ?? null
}
function championshipOf(row: Row): Row | null {
  return (row.championships as Row | null) ?? null
}
function categoryOf(row: Row): Row | null {
  return (row.championship_categories as Row | null) ?? null
}
function eventsText(row: Row): string {
  return ((row.registration_events as { event_name: string }[] | null) ?? [])
    .map((event) => safeText(event.event_name))
    .join('; ')
}

// ---------------------------------------------------------------------------
// Column registries. The order here is the order in the workbook, regardless
// of the order the caller requests columns in.
// ---------------------------------------------------------------------------

const REGISTRATION_COLUMNS: ColumnDef[] = [
  { key: 'athlete_id', header: 'Athlete ID', width: 18, text: true, value: (r) => safeText(profileOf(r)?.athlete_id) },
  {
    key: 'registration_code',
    header: 'Registration Reference',
    width: 22,
    text: true,
    value: (r) => safeText(r.registration_code),
  },
  {
    key: 'bib_number',
    header: 'Bib Number',
    width: 20,
    text: true,
    value: (r) => safeText((r as any).bib_number ?? '—'),
  },
  {
    key: 'bib_number',
    header: 'Bib Number',
    width: 20,
    text: true,
    value: (r) => safeText((r as any).bib_number ?? '—'),
  },
  { key: 'full_name', header: 'Athlete Name', width: 26, value: (r) => safeText(profileOf(r)?.full_name) },
  {
    key: 'date_of_birth',
    header: 'Date of Birth',
    width: 14,
    text: true,
    value: (r) => safeText(profileOf(r)?.date_of_birth),
  },
  {
    key: 'gender',
    header: 'Gender',
    width: 10,
    value: (r) => GENDER_LABELS[String(profileOf(r)?.gender ?? '')] ?? safeText(profileOf(r)?.gender),
  },
  { key: 'mobile_e164', header: 'Mobile Number', width: 18, text: true, value: (r) => safeText(profileOf(r)?.mobile_e164) },
  { key: 'email', header: 'Email', width: 28, value: (r) => safeText(profileOf(r)?.email) },
  { key: 'state', header: 'State', width: 18, value: (r) => safeText(profileOf(r)?.state) },
  { key: 'district', header: 'District', width: 18, value: (r) => safeText(profileOf(r)?.district) },
  {
    key: 'representing',
    header: 'Representing State / Association',
    width: 28,
    value: (r) => safeText(profileOf(r)?.representing),
  },
  { key: 'championship', header: 'Championship', width: 34, value: (r) => safeText(championshipOf(r)?.name) },
  {
    key: 'category',
    header: 'Age Category',
    width: 18,
    value: (r) => safeText(categoryOf(r)?.name ?? r.category_name),
  },
  { key: 'events', header: 'Selected Events', width: 46, value: (r) => eventsText(r) },
  {
    key: 'registered_at',
    header: 'Registration Date (UTC)',
    width: 22,
    text: true,
    value: (r) => formatDateTime(r.registered_at),
  },
  { key: 'status', header: 'Registration Status', width: 18, value: (r) => safeText(r.status) },
  { key: 'payment_status', header: 'Payment Status', width: 16, value: (r) => safeText(r.payment_status) },
  { key: 'fee', header: 'Registration Fee', width: 16, currency: true, value: (r) => Number(r.fee_paise ?? 0) / 100 },
  { key: 'currency', header: 'Currency', width: 10, value: (r) => safeText(r.currency) },
  {
    key: 'payment_reference',
    header: 'Payment Reference',
    width: 24,
    text: true,
    value: (r, ctx) => safeText(ctx.paymentRefs.get(String(r.id))?.paymentId),
  },
  {
    key: 'order_id',
    header: 'Gateway Order ID',
    width: 28,
    text: true,
    value: (r, ctx) => safeText(ctx.paymentRefs.get(String(r.id))?.orderId),
  },
]

const PAYMENT_COLUMNS: ColumnDef[] = [
  {
    key: 'created_at',
    header: 'Payment Date (UTC)',
    width: 22,
    text: true,
    value: (p) => formatDateTime(p.created_at),
  },
  {
    key: 'athlete_id',
    header: 'Athlete ID',
    width: 18,
    text: true,
    value: (p) => safeText((p.registrations?.athlete_profiles as Row | null)?.athlete_id),
  },
  {
    key: 'registration_code',
    header: 'Registration Reference',
    width: 22,
    text: true,
    value: (p) => safeText(p.registrations?.registration_code),
  },
  {
    key: 'bib_number',
    header: 'Bib Number',
    width: 18,
    text: true,
    value: (p) => safeText((p.registrations as any)?.bib_number ?? '—'),
  },
  {
    key: 'bib_number',
    header: 'Bib Number',
    width: 18,
    text: true,
    value: (p) => safeText((p.registrations as any)?.bib_number ?? '—'),
  },
  {
    key: 'full_name',
    header: 'Athlete Name',
    width: 26,
    value: (p) => safeText((p.registrations?.athlete_profiles as Row | null)?.full_name),
  },
  {
    key: 'championship',
    header: 'Championship',
    width: 34,
    value: (p) => safeText((p.registrations?.championships as Row | null)?.name),
  },
  { key: 'order_id', header: 'Razorpay Order ID', width: 30, text: true, value: (p) => safeText(p.razorpay_order_id) },
  {
    key: 'payment_id',
    header: 'Razorpay Payment ID',
    width: 26,
    text: true,
    value: (p) => safeText(p.razorpay_payment_id),
  },
  { key: 'amount', header: 'Amount', width: 14, currency: true, value: (p) => Number(p.amount_paise ?? 0) / 100 },
  { key: 'currency', header: 'Currency', width: 10, value: (p) => safeText(p.currency) },
  { key: 'status', header: 'Status', width: 14, value: (p) => safeText(p.status) },
  { key: 'method', header: 'Method', width: 16, value: (p) => safeText(p.method) },
  { key: 'attempt', header: 'Attempt', width: 10, value: (p) => Number(p.attempt_number ?? 1) },
  { key: 'verified_at', header: 'Verified At (UTC)', width: 22, text: true, value: (p) => formatDateTime(p.verified_at) },
  { key: 'failure_reason', header: 'Failure Reason', width: 40, value: (p) => safeText(p.failure_reason) },
]

/** Selects the requested columns (registry order); all columns when omitted. */
function selectColumns(registry: ColumnDef[], requested: string[]): ColumnDef[] {
  if (requested.length === 0) return registry
  const wanted = new Set(requested)
  return registry.filter((column) => wanted.has(column.key))
}

// deno-lint-ignore no-explicit-any
function sheetFromRows(
  headers: string[],
  rows: (string | number)[][],
  widths: number[],
  textColumns: number[],
  currencyColumn: number | null,
  sheetName: string,
) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  worksheet['!cols'] = widths.map((wch) => ({ wch }))
  const range = XLSX.utils.decode_range(worksheet['!ref'] ?? 'A1')

  for (let r = 1; r <= range.e.r; r++) {
    for (const col of textColumns) {
      const address = XLSX.utils.encode_cell({ r, c: col })
      const cell = worksheet[address]
      if (cell) {
        cell.t = 's'
        cell.z = '@'
      }
    }
    if (currencyColumn !== null) {
      const address = XLSX.utils.encode_cell({ r, c: currencyColumn })
      const cell = worksheet[address]
      if (cell) cell.z = '#,##0.00'
    }
  }
  worksheet['!freeze'] = { xSplit: 0, ySplit: 1 }
  return { worksheet, sheetName }
}

function buildSheet(columns: ColumnDef[], records: Row[], ctx: BuildContext, sheetName: string) {
  const headers = columns.map((column) => column.header)
  const rows = records.map((record) => columns.map((column) => column.value(record, ctx)))
  const textColumns = columns
    .map((column, index) => (column.text ? index : -1))
    .filter((index) => index >= 0)
  const currencyColumn = columns.findIndex((column) => column.currency)
  return sheetFromRows(
    headers,
    rows,
    columns.map((column) => column.width),
    textColumns,
    currencyColumn >= 0 ? currencyColumn : null,
    sheetName,
  )
}

Deno.serve(
  handler(async (req) => {
    const context = await requireAdmin(req)
    if (context instanceof Response) return context
    const { supabase, admin } = context

    const body = await req.json().catch(() => ({}) as Record<string, unknown>)
    const kind = str(body.kind) || 'registrations'
    const requestedColumns = Array.isArray(body.columns)
      ? (body.columns as unknown[]).map((column) => str(column)).filter(Boolean)
      : []

    const workbook = XLSX.utils.book_new()
    let filename = 'export.xlsx'
    let rowCount = 0
    let filterSummary: Record<string, unknown> = {}
    let exportedColumns: string[] = []

    if (kind === 'registrations') {
      const filters = sanitizeFilters(body as Record<string, unknown>)
      filterSummary = filters as unknown as Record<string, unknown>

      const columns = selectColumns(REGISTRATION_COLUMNS, requestedColumns)
      if (requestedColumns.length > 0 && columns.length === 0) {
        return errorJson(req, 'INVALID_COLUMNS', 'None of the requested columns are valid.', 400)
      }

      const records = await fetchAllRegistrations(supabase, filters, 1000, MAX_ROWS)

      // Payment references for the exported registrations (captured first).
      const paymentRefs = new Map<string, { paymentId: string; orderId: string }>()
      const registrationIds = records.map((r) => String(r.id))
      for (let i = 0; i < registrationIds.length; i += 500) {
        const chunk = registrationIds.slice(i, i + 500)
        const { data: payments } = await supabase
          .from('payments')
          .select('registration_id, razorpay_payment_id, razorpay_order_id, status, created_at')
          .in('registration_id', chunk)
          .order('created_at', { ascending: false })
        for (const payment of payments ?? []) {
          const existing = paymentRefs.get(payment.registration_id)
          const isCaptured = payment.status === 'captured'
          if (!existing || (isCaptured && !existing.paymentId)) {
            paymentRefs.set(payment.registration_id, {
              paymentId: isCaptured ? (payment.razorpay_payment_id ?? '') : '',
              orderId: payment.razorpay_order_id ?? '',
            })
          }
        }
      }

      const { worksheet, sheetName } = buildSheet(columns, records, { paymentRefs }, 'Registrations')
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
      rowCount = records.length
      exportedColumns = columns.map((column) => column.key)
    } else if (kind === 'payments') {
      const filters = sanitizePaymentFilters(body as Record<string, unknown>)
      filterSummary = filters as unknown as Record<string, unknown>

      const columns = selectColumns(PAYMENT_COLUMNS, requestedColumns)
      if (requestedColumns.length > 0 && columns.length === 0) {
        return errorJson(req, 'INVALID_COLUMNS', 'None of the requested columns are valid.', 400)
      }

      const records = await fetchAllPayments(supabase, filters, 1000, MAX_ROWS)
      const { worksheet, sheetName } = buildSheet(columns, records, { paymentRefs: new Map() }, 'Payments')
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
      rowCount = records.length
      exportedColumns = columns.map((column) => column.key)
    } else {
      return errorJson(req, 'INVALID_KIND', 'Export type must be "registrations" or "payments".', 400)
    }

    // A small metadata sheet keeps exports self-documenting.
    const meta = [
      ['Export type', kind],
      ['Generated at (UTC)', formatDateTime(new Date().toISOString())],
      ['Generated by', admin.email],
      ['Rows exported', rowCount],
      ['Row limit', MAX_ROWS],
      ['Columns', exportedColumns.join(', ')],
      ['Filters', JSON.stringify(filterSummary)],
    ]
    const metaSheet = XLSX.utils.aoa_to_sheet([['Field', 'Value'], ...meta])
    metaSheet['!cols'] = [{ wch: 22 }, { wch: 80 }]
    XLSX.utils.book_append_sheet(workbook, metaSheet, 'Export info')

    const stamp = formatDateTime(new Date().toISOString()).replace(/[-: ]/g, '').slice(0, 12)
    filename = `${kind}-${stamp}.xlsx`

    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const bytes = output instanceof Uint8Array ? output : new Uint8Array(output as ArrayBuffer)

    await writeAudit(supabase, admin, 'export.generated', kind, null, {
      rows: rowCount,
      columns: exportedColumns,
      filters: filterSummary,
    })

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Export-Rows': String(rowCount),
        ...corsHeaders(req),
      },
    })
  }),
)
