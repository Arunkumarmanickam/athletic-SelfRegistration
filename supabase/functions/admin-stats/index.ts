// Dashboard overview numbers + recent registrations.
import { handler } from '../_shared/handler.ts'
import { json } from '../_shared/responses.ts'
import { requireAdmin } from '../_shared/admin-auth.ts'
import { REGISTRATION_SELECT } from '../_shared/admin-queries.ts'

Deno.serve(
  handler(async (req) => {
    const context = await requireAdmin(req)
    if (context instanceof Response) return context
    const { supabase } = context

    const [{ data: stats, error: statsError }, { data: recent, error: recentError }] = await Promise.all([
      supabase.rpc('get_dashboard_stats'),
      supabase
        .from('registrations')
        .select(REGISTRATION_SELECT)
        .order('registered_at', { ascending: false })
        .limit(8),
    ])

    if (statsError) {
      console.error('stats query failed', statsError)
      return json(req, { error: { code: 'SERVER_ERROR', message: 'Could not load dashboard statistics.' } }, 500)
    }
    if (recentError) {
      console.error('recent registrations query failed', recentError)
    }

    return json(req, { stats, recent: recent ?? [] })
  }),
)
