import { PROFILE_COLUMNS, type AthleteProfileRow } from './athlete-session.ts'

// deno-lint-ignore no-explicit-any
export type SupabaseLike = any

export function normalizeMobile(value: string): string {
  const digits = value.replace(/[^\d+]/g, '')
  if (!digits) return ''
  return digits.startsWith('+') ? digits : `+${digits}`
}

/**
 * Finds an athlete profile for OTP delivery. Callers must ALWAYS return the
 * same generic response whether or not a profile was found, so that arbitrary
 * Athlete IDs cannot be probed.
 */
export async function findProfileForOtp(
  supabase: SupabaseLike,
  input: { athleteId?: string; mobileE164?: string; dateOfBirth?: string },
): Promise<AthleteProfileRow | null> {
  if (input.athleteId) {
    const { data } = await supabase
      .from('athlete_profiles')
      .select(PROFILE_COLUMNS)
      .ilike('athlete_id', input.athleteId.trim())
      .maybeSingle()
    return (data as AthleteProfileRow) ?? null
  }

  if (input.mobileE164 && input.dateOfBirth) {
    const { data } = await supabase
      .from('athlete_profiles')
      .select(PROFILE_COLUMNS)
      .eq('mobile_e164', input.mobileE164)
      .eq('date_of_birth', input.dateOfBirth)
      .limit(1)
      .maybeSingle()
    return (data as AthleteProfileRow) ?? null
  }

  return null
}
