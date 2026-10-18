import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { serviceClient } from './supabase.ts'
import { errorJson } from './responses.ts'

export type AdminRole = 'owner' | 'admin' | 'viewer'

export interface AdminUser {
  id: string
  email: string
  full_name: string | null
  role: AdminRole
  is_active: boolean
}

export interface AdminContext {
  admin: AdminUser
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>
}

function bearerToken(req: Request): string {
  const header = req.headers.get('authorization') ?? ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
}

/**
 * Verifies the caller's Supabase access token and confirms the account is an
 * active administrator. Returns a Response on failure, or the admin context.
 * Authorization is always enforced server-side.
 */
export async function requireAdmin(
  req: Request,
  opts: { roles?: AdminRole[] } = {},
): Promise<AdminContext | Response> {
  const token = bearerToken(req)
  if (!token) return errorJson(req, 'UNAUTHORIZED', 'Administrator sign-in is required.', 401)

  const supabase = serviceClient()

  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData?.user) {
    return errorJson(req, 'UNAUTHORIZED', 'Your session is invalid or has expired. Please sign in again.', 401)
  }

  const { data: admin, error } = await supabase
    .from('admin_users')
    .select('id, email, full_name, role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (error) {
    console.error('admin lookup failed', error)
    return errorJson(req, 'SERVER_ERROR', 'Could not verify administrator access.', 500)
  }
  if (!admin) return errorJson(req, 'FORBIDDEN', 'This account does not have administrator access.', 403)
  if (!admin.is_active) {
    return errorJson(req, 'ACCOUNT_DISABLED', 'This administrator account has been disabled.', 403)
  }
  if (opts.roles && !opts.roles.includes(admin.role as AdminRole)) {
    return errorJson(req, 'FORBIDDEN', 'You do not have permission to perform this action.', 403)
  }

  return { admin: admin as AdminUser, supabase }
}

/** Records an important administrative change in the audit trail. */
export async function writeAudit(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  admin: AdminUser | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      admin_user_id: admin?.id ?? null,
      admin_email: admin?.email ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    })
  } catch (err) {
    console.error('audit log write failed', err)
  }
}
