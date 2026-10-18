// Admin API for administrator accounts.
// There is no public administrator registration: accounts are created here by
// an existing owner/admin, and the very first one is created by admin-bootstrap.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { requireAdmin, writeAudit } from '../_shared/admin-auth.ts'
import { isEmail, randomPassword, str } from '../_shared/helpers.ts'

const CREATABLE_ROLES = ['admin', 'viewer']

Deno.serve(
  handler(async (req) => {
    const context = await requireAdmin(req)
    if (context instanceof Response) return context
    const { supabase, admin } = context

    const body = await req.json().catch(() => ({}) as Record<string, unknown>)
    const action = str(body.action) || 'list'

    // ---- list ---------------------------------------------------------------
    if (action === 'list') {
      const { data, error } = await supabase
        .from('admin_users')
        .select('id, email, full_name, role, is_active, created_at, updated_at')
        .order('created_at', { ascending: true })
      if (error) {
        console.error('admin users list failed', error)
        return errorJson(req, 'SERVER_ERROR', 'Could not load administrators.', 500)
      }
      return json(req, { rows: data ?? [] })
    }

    if (admin.role === 'viewer') {
      return errorJson(req, 'FORBIDDEN', 'Viewer accounts cannot manage administrators.', 403)
    }

    // ---- create -------------------------------------------------------------
    if (action === 'create') {
      const email = str(body.email).toLowerCase()
      const fullName = str(body.fullName)
      const role = str(body.role) || 'admin'

      if (!isEmail(email)) return errorJson(req, 'INVALID_EMAIL', 'Please enter a valid email address.', 400)
      if (!CREATABLE_ROLES.includes(role) && !(role === 'owner' && admin.role === 'owner')) {
        return errorJson(
          req,
          'INVALID_ROLE',
          role === 'owner'
            ? 'Only an owner can create another owner account.'
            : 'Role must be "admin" or "viewer".',
          400,
        )
      }

      const { data: existing } = await supabase
        .from('admin_users')
        .select('id')
        .ilike('email', email)
        .maybeSingle()
      if (existing) return errorJson(req, 'ALREADY_EXISTS', 'An administrator with this email already exists.', 409)

      const password = randomPassword(16)
      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (createError || !created.user) {
        console.error('admin create auth user failed', createError)
        return errorJson(req, 'CREATE_FAILED', createError?.message ?? 'Could not create the account.', 400)
      }

      const { error: insertError } = await supabase.from('admin_users').insert({
        id: created.user.id,
        email,
        full_name: fullName || null,
        role,
        is_active: true,
      })
      if (insertError) {
        console.error('admin insert failed', insertError)
        await supabase.auth.admin.deleteUser(created.user.id).catch(() => {})
        return errorJson(req, 'SERVER_ERROR', 'Could not register the administrator account.', 500)
      }

      await writeAudit(supabase, admin, 'admin.created', 'admin_user', created.user.id, { email, role })

      return json(req, {
        ok: true,
        email,
        temp_password: password,
        message:
          'Administrator created. Share the email and this one-time password securely — it is shown only now. The account holder should change it after signing in.',
      })
    }

    // ---- update -------------------------------------------------------------
    if (action === 'update') {
      const userId = str(body.userId)
      const role = str(body.role)
      const isActiveRaw = body.isActive
      if (!userId) return errorJson(req, 'MISSING_FIELDS', 'Administrator id is required.', 400)

      const { data: target } = await supabase
        .from('admin_users')
        .select('id, email, role, is_active')
        .eq('id', userId)
        .maybeSingle()
      if (!target) return errorJson(req, 'NOT_FOUND', 'Administrator not found.', 404)

      if (target.role === 'owner' && admin.role !== 'owner') {
        return errorJson(req, 'FORBIDDEN', 'Only an owner can modify an owner account.', 403)
      }
      if (target.id === admin.id && (role || isActiveRaw === false)) {
        return errorJson(req, 'NOT_ALLOWED', 'You cannot change your own role or disable your own account.', 400)
      }
      if (role && role === 'owner' && admin.role !== 'owner') {
        return errorJson(req, 'FORBIDDEN', 'Only an owner can grant the owner role.', 403)
      }
      if (role && !['owner', 'admin', 'viewer'].includes(role)) {
        return errorJson(req, 'INVALID_ROLE', 'Invalid role.', 400)
      }

      const updates: Record<string, unknown> = {}
      if (role) updates.role = role
      if (typeof isActiveRaw === 'boolean') updates.is_active = isActiveRaw
      if (Object.keys(updates).length === 0) return errorJson(req, 'NO_CHANGES', 'Nothing to update.', 400)

      // Never leave the system without an active owner.
      const wouldRemoveOwner =
        (target.role === 'owner' && updates.role && updates.role !== 'owner') ||
        (target.role === 'owner' && updates.is_active === false)
      if (wouldRemoveOwner) {
        const { count } = await supabase
          .from('admin_users')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'owner')
          .eq('is_active', true)
        if ((count ?? 0) <= 1) {
          return errorJson(
            req,
            'LAST_OWNER',
            'This is the only active owner. Create or promote another owner first.',
            409,
          )
        }
      }

      const { error: updateError } = await supabase.from('admin_users').update(updates).eq('id', userId)
      if (updateError) {
        console.error('admin update failed', updateError)
        return errorJson(req, 'SERVER_ERROR', 'Could not update the administrator.', 500)
      }

      await writeAudit(supabase, admin, 'admin.updated', 'admin_user', userId, {
        email: target.email,
        changes: updates,
      })

      const { data: refreshed } = await supabase
        .from('admin_users')
        .select('id, email, full_name, role, is_active, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle()
      return json(req, { ok: true, admin: refreshed })
    }

    return errorJson(req, 'UNKNOWN_ACTION', 'Unknown action.', 400)
  }),
)
