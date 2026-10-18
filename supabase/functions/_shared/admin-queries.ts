// Shared query builders for the admin dashboard and the Excel export, so both
// use exactly the same filters and therefore export the same rows.

// deno-lint-ignore no-explicit-any
type SupabaseLike = any

export interface RegistrationFilters {
  championshipId?: string
  paymentStatus?: string
  registrationStatus?: string
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

export interface PaymentFilters {
  status?: string
  championshipId?: string
  search?: string
  dateFrom?: string
  dateTo?: string
  sortDir?: 'asc' | 'desc'
}

// NOTE: PostgREST rejects newline characters inside the `select` parameter
// (PGRST100 "unexpected \n"), so these are built as single-line strings.
export const REGISTRATION_SELECT = [
  'id, registration_code, bib_number, status, payment_status, fee_paise, currency,',
  'registered_at, confirmed_at, category_name, notes, updated_at,',
  'championships (id, name, slug, starts_on, level, max_events_per_athlete),',
  'championship_categories (id, name),',
  'athlete_profiles!inner(id, athlete_id, full_name, date_of_birth, gender, mobile_country_code, mobile_number, mobile_e164, email, state, district, address, representing, emergency_contact_name, emergency_contact_phone, photo_path),',
  'registration_events (event_id, event_name, fee_paise)',
].join(' ')

export const PAYMENT_SELECT = [
  'id, razorpay_order_id, razorpay_payment_id, amount_paise, currency, status,',
  'method, failure_reason, signature_verified, attempt_number, created_at, verified_at, registration_id,',
  'registrations!inner(id, registration_code, bib_number, status, payment_status, championship_id,',
  'championships (id, name),',
  'athlete_profiles (athlete_id, full_name, mobile_e164))',
].join(' ')

const UUID_ZERO = '00000000-0000-0000-0000-000000000000'

function cleanLike(value: string): string {
  // PostgREST or-filters use commas/parentheses as syntax: strip them.
  return value.replace(/[%,()*]/g, '').slice(0, 80)
}

export function sanitizeFilters(raw: Record<string, unknown>): RegistrationFilters {
  const s = (key: string) => {
    const value = raw[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
  const sortDir = s('sortDir') === 'asc' ? 'asc' : 'desc'
  return {
    championshipId: s('championshipId'),
    paymentStatus: s('paymentStatus'),
    registrationStatus: s('registrationStatus'),
    state: s('state'),
    gender: s('gender'),
    categoryId: s('categoryId'),
    eventId: s('eventId'),
    search: s('search'),
    dateFrom: s('dateFrom'),
    dateTo: s('dateTo'),
    sortBy: s('sortBy'),
    sortDir,
  }
}

export function sanitizePaymentFilters(raw: Record<string, unknown>): PaymentFilters {
  const s = (key: string) => {
    const value = raw[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
  return {
    status: s('status'),
    championshipId: s('championshipId'),
    search: s('search'),
    dateFrom: s('dateFrom'),
    dateTo: s('dateTo'),
    sortDir: s('sortDir') === 'asc' ? 'asc' : 'desc',
  }
}

export async function buildRegistrationsQuery(
  supabase: SupabaseLike,
  filters: RegistrationFilters,
  opts: { count?: boolean } = {},
) {
  let query = supabase
    .from('registrations')
    .select(REGISTRATION_SELECT, opts.count ? { count: 'exact' } : {})

  if (filters.championshipId) query = query.eq('championship_id', filters.championshipId)
  if (filters.paymentStatus) query = query.eq('payment_status', filters.paymentStatus)
  if (filters.registrationStatus) query = query.eq('status', filters.registrationStatus)
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId)
  if (filters.state) query = query.eq('athlete_profiles.state', filters.state)
  if (filters.gender) query = query.eq('athlete_profiles.gender', filters.gender)
  if (filters.dateFrom) query = query.gte('registered_at', `${filters.dateFrom}T00:00:00.000Z`)
  if (filters.dateTo) query = query.lte('registered_at', `${filters.dateTo}T23:59:59.999Z`)

  if (filters.eventId) {
    const { data: rows } = await supabase
      .from('registration_events')
      .select('registration_id')
      .eq('event_id', filters.eventId)
    const ids = Array.from(new Set((rows ?? []).map((r: { registration_id: string }) => r.registration_id)))
    query = query.in('id', ids.length ? ids : [UUID_ZERO])
  }

  const search = cleanLike(filters.search ?? '')
  if (search) {
    const like = `%${search}%`
    const { data: profiles } = await supabase
      .from('athlete_profiles')
      .select('id')
      .or(`full_name.ilike.${like},athlete_id.ilike.${like},mobile_e164.ilike.${like}`)
      .limit(500)
    const ids = (profiles ?? []).map((p: { id: string }) => p.id)
    const orParts = [`registration_code.ilike.${like}`, `bib_number.ilike.${like}`]
    if (ids.length) orParts.push(`athlete_profile_id.in.(${ids.join(',')})`)
    query = query.or(orParts.join(','))
  }

  const ascending = (filters.sortDir ?? 'desc') === 'asc'
  switch (filters.sortBy) {
    case 'athlete_name':
      query = query.order('full_name', { foreignTable: 'athlete_profiles', ascending })
      break
    case 'registration_code':
    case 'bib_number':
    case 'fee_paise':
    case 'status':
    case 'payment_status':
    case 'registered_at':
      query = query.order(filters.sortBy, { ascending })
      break
    default:
      query = query.order('registered_at', { ascending: false })
  }
  // Stable tiebreaker so pagination never repeats or skips rows.
  query = query.order('id', { ascending: true })

  // Wrapped in a plain object: awaiting the supabase builder directly would
  // auto-execute it (it is a thenable) instead of returning the builder.
  return { query }
}

export async function fetchRegistrations(
  supabase: SupabaseLike,
  filters: RegistrationFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
  const from = (page - 1) * pageSize
  // buildRegistrationsQuery is async, so it must be awaited before chaining .range().
  const { query: builder } = await buildRegistrationsQuery(supabase, filters, { count: true })
  const { data, count, error } = await builder.range(from, from + pageSize - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as unknown as Record<string, unknown>[], total: count ?? 0, page, pageSize }
}

/** Retrieves every matching registration in batches (for Excel export). */
export async function fetchAllRegistrations(
  supabase: SupabaseLike,
  filters: RegistrationFilters,
  batchSize = 1000,
  maxRows = 100000,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let page = 1
  while (all.length < maxRows) {
    const { rows } = await fetchRegistrations(supabase, filters, page, batchSize)
    all.push(...rows)
    if (rows.length < batchSize) break
    page += 1
  }
  return all
}

export async function buildPaymentsQuery(
  supabase: SupabaseLike,
  filters: PaymentFilters,
  opts: { count?: boolean } = {},
) {
  let query = supabase.from('payments').select(PAYMENT_SELECT, opts.count ? { count: 'exact' } : {})

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.championshipId) query = query.eq('registrations.championship_id', filters.championshipId)
  if (filters.dateFrom) query = query.gte('created_at', `${filters.dateFrom}T00:00:00.000Z`)
  if (filters.dateTo) query = query.lte('created_at', `${filters.dateTo}T23:59:59.999Z`)

  const search = cleanLike(filters.search ?? '')
  if (search) {
    const like = `%${search}%`
    // Resolve matching registration codes first, then combine filters: PostgREST
    // or-filters cannot contain subqueries.
    const { data: regs } = await supabase
      .from('registrations')
      .select('id')
      .ilike('registration_code', like)
      .limit(500)
    const ids = (regs ?? []).map((r: { id: string }) => r.id)
    const orParts = [`razorpay_order_id.ilike.${like}`, `razorpay_payment_id.ilike.${like}`]
    if (ids.length) orParts.push(`registration_id.in.(${ids.join(',')})`)
    query = query.or(orParts.join(','))
  }

  query = query
    .order('created_at', { ascending: (filters.sortDir ?? 'desc') === 'asc' })
    .order('id', { ascending: true })
  return { query }
}

export async function fetchPayments(
  supabase: SupabaseLike,
  filters: PaymentFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
  const from = (page - 1) * pageSize
  const { query: builder } = await buildPaymentsQuery(supabase, filters, { count: true })
  const { data, count, error } = await builder.range(from, from + pageSize - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as unknown as Record<string, unknown>[], total: count ?? 0, page, pageSize }
}

export async function fetchAllPayments(
  supabase: SupabaseLike,
  filters: PaymentFilters,
  batchSize = 1000,
  maxRows = 100000,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let page = 1
  while (all.length < maxRows) {
    const { rows } = await fetchPayments(supabase, filters, page, batchSize)
    all.push(...rows)
    if (rows.length < batchSize) break
    page += 1
  }
  return all
}
