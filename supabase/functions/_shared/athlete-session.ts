import { serviceClient } from './supabase.ts'
import { randomToken, str } from './helpers.ts'

export interface AthleteProfileRow {
  id: string
  athlete_id: string
  full_name: string
  date_of_birth: string
  gender: string
  mobile_country_code: string
  mobile_number: string
  mobile_e164: string
  email: string | null
  state: string
  district: string | null
  address: string | null
  representing: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  photo_path: string | null
}

export const PROFILE_COLUMNS =
  'id, athlete_id, full_name, date_of_birth, gender, mobile_country_code, mobile_number, mobile_e164, email, state, district, address, representing, emergency_contact_name, emergency_contact_phone, photo_path'

export interface AthleteSessionContext {
  sessionId: string
  profile: AthleteProfileRow
}

/**
 * Resolves a raw athlete session token (issued after identity verification) into
 * the athlete's profile. Returns null when the token is unknown, revoked or
 * expired. Tokens are stored only as SHA-256 hashes.
 */
export async function resolveAthleteSession(token: string): Promise<AthleteSessionContext | null> {
  if (!token || token.length < 16) return null
  const supabase = serviceClient()

  const { data: hash, error: hashError } = await supabase.rpc('hash_secret', { p_value: token })
  if (hashError || !hash) {
    console.error('session hash failed', hashError)
    return null
  }

  const { data: session, error } = await supabase
    .from('athlete_sessions')
    .select(`id, athlete_profile_id, athlete_profiles (${PROFILE_COLUMNS})`)
    .eq('token_hash', hash as string)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (error) {
    console.error('session lookup failed', error)
    return null
  }
  if (!session) return null

  const profile = (session as unknown as { athlete_profiles: AthleteProfileRow }).athlete_profiles
  if (!profile) return null

  return { sessionId: session.id as string, profile }
}

export function sessionTokenFromBody(body: Record<string, unknown>): string {
  return str(body.athleteSessionToken)
}

/**
 * Issues a short-lived athlete session token (stored hashed) for the remaining
 * steps of a registration flow: profile edits, document upload, payment retry.
 */
export async function issueAthleteSession(
  profileId: string,
  minutes = 15,
): Promise<{ token: string; expiresAt: string } | null> {
  const supabase = serviceClient()
  const token = randomToken(32)
  const { data: hash, error: hashError } = await supabase.rpc('hash_secret', { p_value: token })
  if (hashError || !hash) {
    console.error('session hash failed', hashError)
    return null
  }
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString()
  const { error } = await supabase.from('athlete_sessions').insert({
    athlete_profile_id: profileId,
    token_hash: hash as string,
    expires_at: expiresAt,
  })
  if (error) {
    console.error('session insert failed', error)
    return null
  }
  return { token, expiresAt }
}
