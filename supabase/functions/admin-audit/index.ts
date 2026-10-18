// Admin API: audit trail listing (read-only, paginated).
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { requireAdmin } from '../_shared/admin-auth.ts'
import { str } from '../_shared/helpers.ts'

Deno.serve(
  handler(async (req) => {
    const context = await requireAdmin(req)
    if (context instanceof Response) return context
    const { supabase } = context

    const body = await req.json().catch(() => ({}) as Record<string, unknown>)
    const entityType = str(body.entityType)
    const action = str(body.actionFilter)
    const search = str(body.search).slice(0, 80)
    const page = Math.max(1, Number(body.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(body.pageSize) || 25))

    let query = supabase.from('audit_logs').select('*', { count: 'exact' })
    if (entityType) query = query.eq('entity_type', entityType)
    if (action) query = query.eq('action', action)
    if (search) {
      const like = `%${search.replace(/[%,()*]/g, '')}%`
      query = query.or(`admin_email.ilike.${like},action.ilike.${like},entity_id.ilike.${like}`)
    }
    query = query
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, (page - 1) * pageSize + pageSize - 1)

    const { data, count, error } = await query
    if (error) {
      console.error('audit list failed', error)
      return errorJson(req, 'SERVER_ERROR', 'Could not load the audit trail.', 500)
    }

    return json(req, { rows: data ?? [], total: count ?? 0, page, pageSize })
  }),
)
