import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

let client: SupabaseClient | null = null

/**
 * Server-side Supabase client using the SERVICE ROLE key.
 * It bypasses Row Level Security and must NEVER be exposed to the browser.
 * Every Edge Function creates its own instance via serviceClient().
 */
export function serviceClient(): SupabaseClient {
  if (client) return client
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured')
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}
