// Resolves a pre-payment registration draft from its bearer token.
//
// Before payment there is no athlete profile (and therefore no Athlete ID, no
// bib and no athlete session). A draft is identified by its own single-use
// bearer token, stored only as a SHA-256 hash. This is what the Aadhaar upload
// and the payment order creation authenticate against.
import { serviceClient } from './supabase.ts'
import { randomToken } from './helpers.ts'

export interface DraftRow {
  id: string
  championship_id: string
  category_id: string | null
  category_name: string | null
  personal: Record<string, string>
  event_ids: string[]
  fee_paise: number
  currency: string
  aadhaar_verified_at: string | null
  expires_at: string
}

/** Hashes a draft token the same way the database does. */
async function hashToken(token: string): Promise<string | null> {
  const supabase = serviceClient()
  const { data, error } = await supabase.rpc('hash_secret', { p_value: token })
  if (error || !data) {
    console.error('draft token hash failed', error)
    return null
  }
  return data as string
}

/**
 * Returns the draft for a bearer token, or null when the token is unknown or
 * expired. Expired drafts are treated as absent: they are about to be pruned.
 */
export async function resolveDraft(token: string): Promise<DraftRow | null> {
  if (!token || token.length < 16) return null
  const hash = await hashToken(token)
  if (!hash) return null

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('registration_drafts')
    .select(
      'id, championship_id, category_id, category_name, personal, event_ids, fee_paise, currency, aadhaar_verified_at, expires_at',
    )
    .eq('token_hash', hash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (error) {
    console.error('draft lookup failed', error)
    return null
  }
  return (data as DraftRow | null) ?? null
}

/** Mints a new draft token, returning it alongside the hash to store. */
export async function newDraftToken(): Promise<{ token: string; hash: string } | null> {
  const token = randomToken(32)
  const hash = await hashToken(token)
  if (!hash) return null
  return { token, hash }
}
