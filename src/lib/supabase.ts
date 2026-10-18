import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './env'

/**
 * Browser Supabase client. It uses the PUBLIC anon key which can only call
 * Edge Functions — every data table has Row Level Security enabled with no
 * public policies, so this client cannot read athlete data directly.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env, add your project URL and anon key, then restart the dev server.',
    )
  }
  return supabase
}
