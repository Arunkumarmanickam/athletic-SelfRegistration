// Shared API types. The Edge Functions return snake_case payloads that mirror
// the database, which keeps the mapping between server and client trivial.

export type Gender = 'male' | 'female' | 'other'
export type CategoryGender = 'any' | 'male' | 'female'
export type ChampionshipStatus = 'draft' | 'open' | 'closed' | 'archived'
export type RegistrationStatus = 'pending' | 'confirmed' | 'cancelled' | 'withdrawn'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded'
export type AdminRole = 'owner' | 'admin' | 'viewer'

export interface ChampionshipCategory {
  id: string
  name: string
  gender: CategoryGender
  min_age: number
  max_age: number
  fee_paise: number
  is_active: boolean
  sort_order: number
}

export interface ChampionshipEvent {
  id: string
  name: string
  gender: CategoryGender
  category_ids: string[] | null
  fee_paise: number
  is_active: boolean
  sort_order: number
}

/**
 * The standard set every new championship starts from. Categories and events
 * carry the same fields as a championship's own rows (events have no category
 * restriction until the organiser adds one after creating the championship).
 */
export type DefaultCategory = ChampionshipCategory
export type DefaultEvent = Omit<ChampionshipEvent, 'category_ids'>

export interface FormConfig {
  require_email?: boolean
  require_address?: boolean
  require_emergency?: boolean
  require_photo?: boolean
  require_representing?: boolean
  show_district?: boolean
  allow_photo_upload?: boolean
  age_calculation_mode?: 'championship_start' | 'fixed'
  age_calculation_date?: string
}

export interface Championship {
  id: string
  slug: string
  name: string
  description: string | null
  location: string | null
  starts_on: string | null
  ends_on: string | null
  registration_opens_at: string | null
  registration_closes_at: string | null
  status: ChampionshipStatus
  currency: string
  base_fee_paise: number
  terms_text: string | null
  form_config: FormConfig
  level?: 'district' | 'state' | 'national'
  /** Country the championship belongs to (always India for a district/state meet). */
  nation?: string | null
  /** Indian state the meet belongs to (set for district and state meets). */
  state_name?: string | null
  max_events_per_athlete?: number | null
  championship_categories: ChampionshipCategory[]
  championship_events: ChampionshipEvent[]
}

export interface AdminChampionship extends Omit<Championship, 'championship_categories' | 'championship_events'> {
  created_at: string
  updated_at: string
  championship_categories: ChampionshipCategory[]
  championship_events: ChampionshipEvent[]
  registrations_total: number
  registrations_paid: number
}

export interface PublicConfig {
  site: {
    organizer_name?: string
    support_email?: string
    support_phone?: string
    address?: string
  }
  athlete_id_format: { prefix?: string; sequence_length?: number } | null
  payments_configured: boolean
  championships: Championship[]
}

export interface AthleteProfile {
  id: string
  athlete_id: string
  full_name: string
  date_of_birth: string
  gender: Gender
  mobile_country_code: string
  mobile_number: string
  mobile_e164: string
  email: string | null
  state: string | null
  district: string | null
  address: string | null
  representing: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  photo_path: string | null
}

export interface RegistrationEventRow {
  event_id?: string
  event_name: string
  fee_paise?: number
}

export interface ConfirmationRegistration {
  id: string
  registration_code: string
  bib_number?: string | null
  status: RegistrationStatus
  payment_status: PaymentStatus
  fee_paise: number
  currency: string
  registered_at: string
  confirmed_at: string | null
  championships: {
    id?: string
    name: string
    slug?: string
    starts_on?: string | null
    ends_on?: string | null
    location?: string | null
  } | null
  championship_categories: { name: string } | null
  athlete_profiles: {
    athlete_id: string
    full_name: string
    email?: string | null
    mobile_e164?: string | null
    state?: string | null
    district?: string | null
    representing?: string | null
  } | null
  registration_events: RegistrationEventRow[] | null
}

export interface ConfirmationPayment {
  razorpay_order_id: string
  razorpay_payment_id: string | null
  amount_paise: number
  currency: string
  status: string
  method: string | null
  verified_at: string | null
}

export interface Confirmation {
  registration: ConfirmationRegistration
  payments: ConfirmationPayment[]
}

export interface AthleteRegistrationSummary {
  id: string
  registration_code: string
  bib_number?: string | null
  status: RegistrationStatus
  payment_status: PaymentStatus
  fee_paise: number
  currency: string
  registered_at: string
  confirmed_at: string | null
  championship_id: string
  championships: { id: string; name: string; slug: string; starts_on: string | null; location: string | null; level?: string } | null
  championship_categories: { name: string } | null
  registration_events: RegistrationEventRow[] | null
}

export interface RegisterResponse {
  ok: boolean
  /**
   * The staged submission. Nothing permanent exists yet: no Athlete ID, no bib
   * number and no registration. Both are issued when payment is captured.
   */
  draft: {
    id: string
    championship_id: string
    category_name: string | null
    fee_paise: number
    currency: string
    expires_at: string | null
  }
  payment:
    | { configured: false; aadhaar_required?: boolean }
    | {
        configured: true
        /** Cashfree order id (field name kept for compatibility). */
        razorpay_order_id: string
        /** Cashfree `payment_session_id` (field name kept for compatibility). */
        razorpay_key_id: string
        cashfree_mode?: 'sandbox' | 'production'
        amount_paise: number
        currency: string
      }
    | { configured: false; aadhaar_required: true }
  /** Name/email/phone to prefill in the Cashfree checkout, from the draft. */
  prefill?: { name?: string; email?: string; contact?: string }
  /** Bearer token for the pre-payment steps (Aadhaar upload, payment order). */
  draft_token: string | null
  message?: string
}

export interface RegistrationAdminRow {
  id: string
  registration_code: string
  bib_number?: string | null
  status: RegistrationStatus
  payment_status: PaymentStatus
  fee_paise: number
  currency: string
  registered_at: string
  confirmed_at: string | null
  category_name: string | null
  notes: string | null
  updated_at: string
  championships: { id: string; name: string; slug: string; starts_on: string | null; level?: string; max_events_per_athlete?: number | null } | null
  championship_categories: { id: string; name: string } | null
  athlete_profiles: AthleteProfile
  registration_events: RegistrationEventRow[] | null
  request_ip?: string | null
  form_snapshot?: Record<string, unknown>
  category_id?: string | null
}

export interface PaymentRow {
  id: string
  razorpay_order_id: string
  razorpay_payment_id: string | null
  amount_paise: number
  currency: string
  status: string
  method: string | null
  failure_reason: string | null
  signature_verified: boolean
  attempt_number: number
  created_at: string
  verified_at: string | null
  registration_id: string
  registrations?: {
    id: string
    registration_code: string
    bib_number?: string | null
    status: RegistrationStatus
    payment_status: PaymentStatus
    championship_id: string
    championships: { id: string; name: string } | null
    athlete_profiles: { athlete_id: string; full_name: string; mobile_e164: string } | null
  } | null
}

export interface AuditRow {
  id: string
  admin_user_id: string | null
  admin_email: string | null
  action: string
  entity_type: string
  entity_id: string | null
  details: Record<string, unknown> | null
  created_at: string
}

export interface AdminUserRow {
  id: string
  email: string
  full_name: string | null
  role: AdminRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DashboardStats {
  registrations_total: number
  registrations_paid: number
  registrations_pending_payment: number
  registrations_failed_payment: number
  registrations_refunded: number
  registrations_cancelled: number
  athletes_total: number
  payments_captured_count: number
  payments_created_count: number
  payments_failed_count: number
  payments_captured_amount_paise: number
  payments_refunded_amount_paise: number
  by_championship: {
    championship_id: string
    name: string
    status: ChampionshipStatus
    total: number
    paid: number
    pending: number
    failed: number
  }[]
  by_gender: { gender: string; count: number }[]
  by_state: { state: string; count: number }[]
}

export interface Paged<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

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
