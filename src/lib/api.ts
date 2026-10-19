import { requireSupabase } from './supabase'
import type {
  AuditRow,
  Confirmation,
  DashboardStats,
  Paged,
  PaymentRow,
  PublicConfig,
  RegisterResponse,
  RegistrationAdminRow,
  RegistrationFilters,
  AthleteProfile,
  AthleteRegistrationSummary,
  AdminUserRow,
  AdminChampionship,
  DefaultCategory,
  DefaultEvent,
} from './types'

/** Error thrown for any non-2xx Edge Function response. */
export class ApiError extends Error {
  code: string
  status: number
  payload: unknown

  constructor(code: string, message: string, status: number, payload?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.payload = payload
  }
}

async function invoke<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke(name, { body })

  if (error) {
    let payload: { error?: { code?: string; message?: string } } | null = null
    let status = 500
    // supabase-js exposes the raw Response on error.context.
    const context = (error as { context?: Response }).context
    if (context && typeof context.status === 'number') {
      status = context.status
      try {
        payload = await context.clone().json()
      } catch {
        payload = null
      }
    }
    const code = payload?.error?.code ?? 'REQUEST_FAILED'
    const message =
      payload?.error?.message ??
      error.message ??
      'The request could not be completed. Please try again.'
    throw new ApiError(code, message, status, payload)
  }

  return data as T
}

/** Downloads a binary export (Excel workbook) with the admin's auth token. */
async function invokeBlob(
  name: string,
  body: Record<string, unknown>,
): Promise<{ blob: Blob; filename: string; rows: number }> {
  const client = requireSupabase()
  const { data: session } = await client.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new ApiError('UNAUTHORIZED', 'Please sign in again.', 401)

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    let message = 'The export could not be generated. Please try again.'
    let code = 'EXPORT_FAILED'
    try {
      const payload = (await response.json()) as { error?: { code?: string; message?: string } }
      message = payload.error?.message ?? message
      code = payload.error?.code ?? code
    } catch {
      /* keep defaults */
    }
    throw new ApiError(code, message, response.status)
  }

  const disposition = response.headers.get('Content-Disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(disposition)
  const rows = Number(response.headers.get('X-Export-Rows') ?? '0')
  return {
    blob: await response.blob(),
    filename: match?.[1] ?? 'export.xlsx',
    rows: Number.isFinite(rows) ? rows : 0,
  }
}

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

export const publicConfig = () => invoke<PublicConfig>('public-config')

export const verifyAthlete = (body: {
  athleteId?: string
  mobileE164?: string
  dateOfBirth: string
}) =>
  invoke<{ ok: boolean; athlete_session_token: string; expires_at: string }>(
    'verify-athlete',
    body as Record<string, unknown>,
  )

export const retrieveProfile = (athleteSessionToken: string) =>
  invoke<{ profile: AthleteProfile; registrations: AthleteRegistrationSummary[] }>('retrieve-profile', {
    athleteSessionToken,
  })

export const register = (body: Record<string, unknown>) => invoke<RegisterResponse>('register', body)

/**
 * Uploads the front of the Aadhaar card. The image is validated by the server
 * and then DISCARDED — only a "received" timestamp is kept, so the card is
 * never stored anywhere. Returns the server's acknowledgement.
 */
export async function uploadAadhaar(input: { athleteSessionToken: string; registrationId: string; file: File }) {
  const form = new FormData()
  form.append('file', input.file)
  form.append('athleteSessionToken', input.athleteSessionToken)
  form.append('registrationId', input.registrationId)
  form.append('purpose', 'aadhaar')

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-document`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY as string}`,
    },
    body: form,
  })

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; stored?: boolean; aadhaar_verified?: boolean; error?: { message?: string } }
    | null
  if (!response.ok || !payload?.ok) {
    throw new ApiError('UPLOAD_FAILED', payload?.error?.message ?? 'The upload failed. Please try again.', response.status)
  }
  return { stored: payload.stored === true, aadhaar_verified: payload.aadhaar_verified === true }
}

export const verifyPayment = (body: {
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
}) =>
  invoke<{ ok: boolean; status: string; already_verified?: boolean; confirmation: Confirmation }>(
    'verify-payment',
    body,
  )

export const retryPayment = (body: { registrationCode: string; mobileE164: string }) =>
  invoke<RegisterResponse>('payment-retry', body)

export const lookupRegistrationStatus = (body: { registrationCode: string; mobileE164: string }) =>
  invoke<{
    registration: {
      registration_code: string
      bib_number?: string | null
      athlete_name_masked: string
      status: string
      payment_status: string
      fee_paise: number
      currency: string
      registered_at: string
      confirmed_at: string | null
      championship: { name: string; starts_on: string | null; location: string | null } | null
      category: { name: string } | null
      events: string[]
    }
    payments: {
      status: string
      razorpay_payment_id: string | null
      amount_paise: number
      currency: string
      verified_at: string | null
      created_at: string
    }[]
  }>('lookup-registration-status', body)

export async function uploadDocument(input: {
  athleteSessionToken: string
  registrationId?: string
  file: File
}): Promise<{ path: string }> {
  const form = new FormData()
  form.append('file', input.file)
  form.append('athleteSessionToken', input.athleteSessionToken)
  form.append('purpose', 'photo')
  if (input.registrationId) form.append('registrationId', input.registrationId)

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-document`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY as string}`,
    },
    body: form,
  })

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; path?: string; error?: { message?: string } }
    | null
  if (!response.ok || !payload?.ok) {
    throw new ApiError('UPLOAD_FAILED', payload?.error?.message ?? 'The upload failed. Please try again.', response.status)
  }
  return { path: payload.path ?? '' }
}

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

export const adminBootstrap = (body: { secret: string; email: string; fullName?: string; password?: string }) =>
  invoke<{ ok: boolean; email: string; temp_password: string; message: string }>('admin-bootstrap', body)

export const adminMe = () => invoke<{ admin: { id: string; email: string; full_name: string | null; role: 'owner' | 'admin' | 'viewer' } }>('admin-me')

export const adminStats = () =>
  invoke<{ stats: DashboardStats; recent: RegistrationAdminRow[] }>('admin-stats')

export const adminRegistrations = (body: Record<string, unknown>) =>
  invoke<Paged<RegistrationAdminRow>>('admin-registrations', { action: 'list', ...body })

export const adminRegistrationDetail = (registrationId: string) =>
  invoke<{ registration: RegistrationAdminRow; payments: PaymentRow[]; audit: AuditRow[] }>(
    'admin-registrations',
    { action: 'detail', registrationId },
  )

export const adminUpdateRegistration = (body: {
  registrationId: string
  fields: Record<string, unknown>
  reason: string
}) => invoke<{ ok: boolean; registration: RegistrationAdminRow }>('admin-registrations', { action: 'update', ...body })

export const adminAthletes = (body: Record<string, unknown>) =>
  invoke<Paged<AthleteProfile & { registration_count: number }>>('admin-athletes', { action: 'list', ...body })

export const adminAthleteDetail = (athleteId: string) =>
  invoke<{ profile: AthleteProfile; registrations: Record<string, unknown>[] }>('admin-athletes', {
    action: 'detail',
    athleteId,
  })

export const adminUpdateAthlete = (body: { athleteId: string; fields: Record<string, unknown>; reason: string }) =>
  invoke<{ ok: boolean; profile: AthleteProfile }>('admin-athletes', { action: 'update', ...body })

export const adminPayments = (body: Record<string, unknown>) =>
  invoke<Paged<PaymentRow>>('admin-payments', { action: 'list', ...body })

export const adminPaymentDetail = (paymentId: string) =>
  invoke<{ payment: PaymentRow; attempts: PaymentRow[]; audit: AuditRow[] }>('admin-payments', {
    action: 'detail',
    paymentId,
  })

export const adminPaymentAction = (body: Record<string, unknown>) =>
  invoke<{ ok: boolean }>('admin-payments', body)

export const adminAudit = (body: Record<string, unknown>) =>
  invoke<Paged<AuditRow>>('admin-audit', body)

export const adminUsers = (body: Record<string, unknown> = { action: 'list' }) =>
  invoke<{
    rows?: AdminUserRow[]
    ok?: boolean
    email?: string
    temp_password?: string
    message?: string
    admin?: AdminUserRow
  }>('admin-users', body)

export const adminChampionships = (body: Record<string, unknown> = { action: 'list' }) =>
  invoke<{
    rows: AdminChampionship[]
    /** `action: 'defaults'` — the standard categories/events new championships start from. */
    categories?: DefaultCategory[]
    events?: DefaultEvent[]
    ok?: boolean
    championship?: { id: string; name: string; slug: string }
    categoriesAdded?: number
    eventsAdded?: number
  }>('admin-championships', body)

export const adminSettings = (body: Record<string, unknown>) =>
  invoke<{ settings: Record<string, unknown> } | { ok: boolean; settings: Record<string, unknown> }>(
    'admin-championships',
    body,
  )

export const adminExportRegistrations = (filters: RegistrationFilters, columns?: string[]) =>
  invokeBlob('admin-export', {
    kind: 'registrations',
    ...filters,
    ...(columns && columns.length > 0 ? { columns } : {}),
  })

export const adminExportPayments = (filters: Record<string, unknown>, columns?: string[]) =>
  invokeBlob('admin-export', {
    kind: 'payments',
    ...filters,
    ...(columns && columns.length > 0 ? { columns } : {}),
  })

/**
 * Bib-preparation sheet in the organiser's template layout
 * (S.No, Name, Gender, Age Category, DOB, Representing, Event1..N,
 * T-shirt size, Bib No). Pass `championshipId` for one championship or no
 * filter for every registered athlete.
 */
export const adminExportAthletes = (filters: Record<string, unknown> = {}) =>
  invokeBlob('admin-export', { kind: 'athletes', ...filters })

export { invoke }
