// Column choices offered by the "export selected columns" picker. Keys must
// match the registry in supabase/functions/admin-export/index.ts.

export interface ExportColumnOption {
  key: string
  label: string
}

export const REGISTRATION_EXPORT_COLUMNS: ExportColumnOption[] = [
  { key: 'athlete_id', label: 'Athlete ID' },
  { key: 'registration_code', label: 'Registration ID / Bib Number' },
  { key: 'full_name', label: 'Athlete Name' },
  { key: 'date_of_birth', label: 'Date of Birth' },
  { key: 'gender', label: 'Gender' },
  { key: 'mobile_e164', label: 'Mobile Number' },
  { key: 'email', label: 'Email' },
  { key: 'state', label: 'State' },
  { key: 'district', label: 'District' },
  { key: 'representing', label: 'Representing State / Association' },
  { key: 'championship', label: 'Championship' },
  { key: 'category', label: 'Age Category' },
  { key: 'events', label: 'Selected Events' },
  { key: 'registered_at', label: 'Registration Date (UTC)' },
  { key: 'status', label: 'Registration Status' },
  { key: 'payment_status', label: 'Payment Status' },
  { key: 'fee', label: 'Registration Fee' },
  { key: 'currency', label: 'Currency' },
  { key: 'payment_reference', label: 'Payment Reference' },
  { key: 'order_id', label: 'Gateway Order ID' },
]

export const PAYMENT_EXPORT_COLUMNS: ExportColumnOption[] = [
  { key: 'created_at', label: 'Payment Date (UTC)' },
  { key: 'athlete_id', label: 'Athlete ID' },
  { key: 'registration_code', label: 'Registration ID / Bib Number' },
  { key: 'full_name', label: 'Athlete Name' },
  { key: 'championship', label: 'Championship' },
  { key: 'order_id', label: 'Cashfree Order ID' },
  { key: 'payment_id', label: 'Cashfree Payment ID' },
  { key: 'amount', label: 'Amount' },
  { key: 'currency', label: 'Currency' },
  { key: 'status', label: 'Status' },
  { key: 'method', label: 'Method' },
  { key: 'attempt', label: 'Attempt' },
  { key: 'verified_at', label: 'Verified At (UTC)' },
  { key: 'failure_reason', label: 'Failure Reason' },
]
