// Admin queries for pre-payment registration drafts ("applications").
//
// An unpaid submission exists only as a registration_drafts row: there is no
// athlete profile, Athlete ID, bib or registration until promote_draft runs
// after a gateway-verified capture. These helpers surface those drafts to
// administrators without changing that lifecycle.

// deno-lint-ignore no-explicit-any
type SupabaseLike = any

export type ApplicationStatus = 'pending' | 'failed' | 'abandoned' | 'started' | 'paid'

export interface ApplicationFilters {
  championshipId?: string
  applicationStatus?: string
  state?: string
  gender?: string
  categoryId?: string
  eventId?: string
  search?: string
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export interface ApplicationOrder {
  id: string
  razorpay_order_id: string
  razorpay_payment_id: string | null
  amount_paise: number
  currency: string
  status: 'created' | 'authorized' | 'captured' | 'failed' | 'expired'
  method: string | null
  failure_reason: string | null
  attempt_number: number
  created_at: string
  verified_at: string | null
}

export interface ApplicationRow {
  id: string
  application_number: string
  championship_id: string
  category_id: string | null
  category_name: string | null
  personal: Record<string, unknown>
  event_ids: string[]
  fee_paise: number
  currency: string
  aadhaar_verified_at: string | null
  request_ip: string | null
  created_at: string
  updated_at: string
  expires_at: string
  championships: { id: string; name: string; slug: string; starts_on: string | null; level?: string } | null
  championship_categories: { id: string; name: string } | null
  payment_orders: ApplicationOrder[] | null
}

export interface ApplicationEvent {
  id: string
  name: string
  fee_paise: number
}

export interface ApplicationListRow extends Omit<ApplicationRow, 'payment_orders'> {
  events: ApplicationEvent[]
  payment_orders: ApplicationOrder[]
  latest_order: ApplicationOrder | null
  application_status: ApplicationStatus
}

const APPLICATION_STATUSES: ApplicationStatus[] = ['pending', 'failed', 'abandoned', 'started', 'paid']
const APPLICATION_SORTS = ['created_at', 'fee_paise', 'application_number', 'athlete_name', 'application_status']

// Keep PostgREST's select parameter on one line: newlines are rejected with
// PGRST100. `payment_orders` is embedded so the latest attempt can be derived
// without a second round-trip per row.
export const APPLICATION_SELECT = [
  'id, application_number, championship_id, category_id, category_name,',
  'personal, event_ids, fee_paise, currency, aadhaar_verified_at,',
  'created_at, updated_at, expires_at,',
  'championships (id, name, slug, starts_on, level),',
  'championship_categories (id, name),',
  'payment_orders (id, razorpay_order_id, razorpay_payment_id, amount_paise, currency, status, method, failure_reason, attempt_number, created_at, verified_at)',
].join(' ')

// request_ip is only exposed on the single-application detail view.
export const APPLICATION_DETAIL_SELECT = `${APPLICATION_SELECT}, request_ip`

// A pending order is treated as live for a short grace window after the draft
// link expires, mirroring prune_registration_drafts(): the athlete may already
// be on the bank page when the timer runs out.
const LIVE_ORDER_GRACE_MS = 2 * 60 * 60 * 1000

export function sanitizeApplicationFilters(raw: Record<string, unknown>): ApplicationFilters {
  const s = (key: string) => {
    const value = raw[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
  const status = s('applicationStatus')
  const sortBy = s('sortBy')
  return {
    championshipId: s('championshipId'),
    applicationStatus: status && APPLICATION_STATUSES.includes(status as ApplicationStatus) ? status : undefined,
    state: s('state'),
    gender: s('gender'),
    categoryId: s('categoryId'),
    eventId: s('eventId'),
    search: s('search'),
    dateFrom: s('dateFrom'),
    dateTo: s('dateTo'),
    sortBy: sortBy && APPLICATION_SORTS.includes(sortBy) ? sortBy : 'created_at',
    sortDir: s('sortDir') === 'asc' ? 'asc' : 'desc',
  }
}

export function deriveApplicationStatus(
  row: Pick<ApplicationRow, 'expires_at'>,
  latest: ApplicationOrder | null,
  now = Date.now(),
): ApplicationStatus {
  if (latest?.status === 'captured') return 'paid'
  if (latest?.status === 'failed') return 'failed'
  if (latest?.status === 'expired') return 'abandoned'

  const expiresAt = Date.parse(row.expires_at)
  if (Number.isFinite(expiresAt) && expiresAt < now) {
    const liveAttempt =
      latest != null &&
      (latest.status === 'created' || latest.status === 'authorized') &&
      Date.parse(latest.created_at) > now - LIVE_ORDER_GRACE_MS
    return liveAttempt ? 'pending' : 'abandoned'
  }

  if (latest != null) return 'pending'
  return 'started'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function includeSearch(row: ApplicationRow, search: string): boolean {
  if (!search) return true
  const personal = row.personal ?? {}
  return [row.application_number, personal.full_name, personal.mobile_e164, personal.email]
    .map((value) => text(value).toLowerCase())
    .some((value) => value.includes(search))
}

function sortRows(rows: ApplicationListRow[], sortBy: string | undefined, direction: 'asc' | 'desc'): void {
  const multiplier = direction === 'asc' ? 1 : -1
  const statusOrder: Record<ApplicationStatus, number> = {
    pending: 0,
    failed: 1,
    abandoned: 2,
    started: 3,
    paid: 4,
  }

  rows.sort((a, b) => {
    let primary = 0
    switch (sortBy) {
      case 'fee_paise':
        primary = a.fee_paise - b.fee_paise
        break
      case 'application_number':
        primary = a.application_number.localeCompare(b.application_number)
        break
      case 'athlete_name':
        primary = text(a.personal?.full_name).localeCompare(text(b.personal?.full_name))
        break
      case 'application_status':
        primary = statusOrder[a.application_status] - statusOrder[b.application_status]
        break
      case 'created_at':
      default:
        primary = Date.parse(a.created_at) - Date.parse(b.created_at)
        break
    }
    if (primary !== 0) return primary * multiplier
    // Stable tiebreaker: application numbers are unique and zero-padded.
    return a.application_number.localeCompare(b.application_number)
  })
}

async function fetchEvents(supabase: SupabaseLike, eventIds: string[]): Promise<Map<string, ApplicationEvent>> {
  const unique = Array.from(new Set(eventIds.filter(Boolean)))
  const byId = new Map<string, ApplicationEvent>()
  for (let index = 0; index < unique.length; index += 500) {
    const chunk = unique.slice(index, index + 500)
    const { data, error } = await supabase
      .from('championship_events')
      .select('id, name, fee_paise')
      .in('id', chunk)
    if (error) throw new Error(error.message)
    for (const event of (data ?? []) as ApplicationEvent[]) byId.set(event.id, event)
  }
  return byId
}

function mapEvents(row: ApplicationRow, eventMap: Map<string, ApplicationEvent>): ApplicationEvent[] {
  return row.event_ids.map((id) => eventMap.get(id)).filter((event): event is ApplicationEvent => event != null)
}

function sortOrders(orders: ApplicationOrder[] | null | undefined): ApplicationOrder[] {
  return [...(orders ?? [])].sort((a, b) => {
    const byCreated = Date.parse(b.created_at) - Date.parse(a.created_at)
    if (byCreated !== 0) return byCreated
    return (b.attempt_number ?? 0) - (a.attempt_number ?? 0)
  })
}

/** Retrieves every draft matching the DB-level filters, in pages. */
async function fetchApplicationRows(supabase: SupabaseLike, filters: ApplicationFilters): Promise<ApplicationRow[]> {
  const batchSize = 1000
  const all: ApplicationRow[] = []

  for (let from = 0; ; from += batchSize) {
    let query = supabase.from('registration_drafts').select(APPLICATION_SELECT)

    if (filters.championshipId) query = query.eq('championship_id', filters.championshipId)
    if (filters.categoryId) query = query.eq('category_id', filters.categoryId)
    if (filters.eventId) query = query.contains('event_ids', [filters.eventId])
    if (filters.dateFrom) query = query.gte('created_at', `${filters.dateFrom}T00:00:00.000Z`)
    if (filters.dateTo) query = query.lte('created_at', `${filters.dateTo}T23:59:59.999Z`)

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + batchSize - 1)

    if (error) throw new Error(error.message)
    const batch = (data ?? []) as unknown as ApplicationRow[]
    all.push(...batch)
    if (batch.length < batchSize) break
  }

  return all
}

export async function fetchApplications(
  supabase: SupabaseLike,
  filters: ApplicationFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: ApplicationListRow[]; total: number; page: number; pageSize: number }> {
  const rows = await fetchApplicationRows(supabase, filters)
  const search = (filters.search ?? '').trim().toLowerCase()
  const state = (filters.state ?? '').trim().toLowerCase()
  const gender = (filters.gender ?? '').trim().toLowerCase()

  const filtered = rows.filter((row) => {
    const personal = row.personal ?? {}
    if (state && text(personal.state).trim().toLowerCase() !== state) return false
    if (gender && text(personal.gender).trim().toLowerCase() !== gender) return false
    return includeSearch(row, search)
  })

  const withStatus = filtered.map<ApplicationListRow>((row) => {
    const orders = sortOrders(row.payment_orders)
    const latest = orders[0] ?? null
    return {
      ...row,
      payment_orders: orders,
      latest_order: latest,
      events: [],
      application_status: deriveApplicationStatus(row, latest),
    }
  })

  const statusFilter = filters.applicationStatus
  const statusFiltered = statusFilter
    ? withStatus.filter((row) => row.application_status === statusFilter)
    : withStatus

  sortRows(statusFiltered, filters.sortBy, filters.sortDir ?? 'desc')

  const total = statusFiltered.length
  const start = (page - 1) * pageSize
  const pageRows = statusFiltered.slice(start, start + pageSize)
  const eventMap = await fetchEvents(
    supabase,
    pageRows.flatMap((row) => row.event_ids),
  )

  return {
    rows: pageRows.map((row) => ({ ...row, events: mapEvents(row, eventMap) })),
    total,
    page,
    pageSize,
  }
}

export async function fetchApplicationDetail(
  supabase: SupabaseLike,
  applicationId: string,
): Promise<{ application: ApplicationListRow } | null> {
  const { data, error } = await supabase
    .from('registration_drafts')
    .select(APPLICATION_DETAIL_SELECT)
    .eq('id', applicationId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  const row = data as unknown as ApplicationRow
  const orders = sortOrders(row.payment_orders)
  const latest = orders[0] ?? null
  const eventMap = await fetchEvents(supabase, row.event_ids)

  return {
    application: {
      ...row,
      payment_orders: orders,
      latest_order: latest,
      events: mapEvents(row, eventMap),
      application_status: deriveApplicationStatus(row, latest),
    },
  }
}
