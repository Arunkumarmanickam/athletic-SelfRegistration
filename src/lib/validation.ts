import { z } from 'zod'

// Validation is duplicated on the server (Edge Functions + Postgres), so the
// browser checks are purely for fast, friendly feedback. Messages are written
// with the string shorthand so the schemas stay version-independent.

export interface PersonalStepValues {
  full_name: string
  date_of_birth: string
  gender: string
  mobile_country_code: string
  mobile_number: string
  email: string
  state: string
  district: string
  address: string
  representing: string
}

export interface ParticipationStepValues {
  category_id: string
  event_ids: string[]
  emergency_contact_name: string
  emergency_contact_phone: string
}

// ---------------------------------------------------------------------------
// Single-page registration form
// ---------------------------------------------------------------------------

export interface RegistrationFormValues {
  full_name: string
  date_of_birth: string
  gender: string
  /** District for a state-level championship, state for a national one. */
  representing: string
  event_ids: string[]
  mobile_country_code: string
  mobile_number: string
  /** Optional. Used for the payment receipt and the Razorpay checkout. */
  email: string
  accept_terms: boolean
}

export const registrationFormSchema = z.object({
  full_name: z.string().trim().min(2, 'Please enter the full name').max(120, 'Name is too long'),
  date_of_birth: z
    .string()
    .min(1, 'Please enter the date of birth')
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`)
      if (Number.isNaN(date.getTime())) return false
      const age = (Date.now() - date.getTime()) / (365.25 * 24 * 3600 * 1000)
      return age >= 3 && age <= 110
    }, 'Please check the date of birth'),
  gender: z
    .string()
    .refine((value) => ['male', 'female'].includes(value), 'Please select Men or Women'),
  representing: z.string().trim().min(1, 'Please enter your district / state').max(120, 'Too long'),
  event_ids: z.array(z.string()).min(1, 'Please select at least one event'),
  mobile_country_code: z.string().min(2, 'Please select a country code'),
  mobile_number: z
    .string()
    .trim()
    .min(6, 'Please enter a valid mobile number')
    .max(15, 'Please enter a valid mobile number')
    .regex(/^\d+$/, 'Mobile number should contain digits only'),
  email: z
    .union([z.literal(''), z.string().trim().email('Please enter a valid email address')])
    .optional()
    .transform((value) => value ?? ''),
  accept_terms: z.boolean(),
})

export const returningLookupSchema = z.object({
  athlete_id: z.string().trim().min(4, 'Please enter your Athlete ID'),
})

export const statusLookupSchema = z.object({
  registration_code: z.string().trim().min(3, 'Please enter your registration ID / bib number'),
  mobile_e164: z.string().trim().min(8, 'Enter the registered mobile number with country code'),
})

type ValidationResult<T> = { success: true; data: T } | { success: false; errors: Record<string, string> }

/** Validates values and returns { field: message } for form display. */
export function validateWith<T>(schema: z.ZodType<T>, values: unknown): ValidationResult<T> {
  const result = schema.safeParse(values)
  if (result.success) return { success: true, data: result.data as T }
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || 'form'
    if (!errors[key]) errors[key] = issue.message
  }
  return { success: false, errors }
}
