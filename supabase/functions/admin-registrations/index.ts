// Admin API for registrations: search/filter/paginate, full detail, and
// guarded status updates with an audit trail.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { requireAdmin, writeAudit } from '../_shared/admin-auth.ts'
import { str } from '../_shared/helpers.ts'
import { fetchRegistrations, REGISTRATION_SELECT, sanitizeFilters } from '../_shared/admin-queries.ts'

const REGISTRATION_STATUSES = ['pending', 'confirmed', 'cancelled', 'withdrawn']
const PAYMENT_STATUSES_ALLOWED = ['pending', 'failed', 'cancelled', 'refunded']

Deno.serve(
  handler(async (req) => {
    const context = await requireAdmin(req)
    if (context instanceof Response) return context
    const { supabase, admin } = context

    const body = await req.json().catch(() => ({}) as Record<string, unknown>)
    const action = str(body.action) || 'list'

    // ---- list ---------------------------------------------------------------
    if (action === 'list') {
      const filters = sanitizeFilters(body as Record<string, unknown>)
      const page = Math.max(1, Number(body.page) || 1)
      const pageSize = Math.min(200, Math.max(1, Number(body.pageSize) || 25))
      try {
        const result = await fetchRegistrations(supabase, filters, page, pageSize)
        return json(req, result)
      } catch (queryError) {
        console.error('registrations list failed', queryError)
        return errorJson(req, 'SERVER_ERROR', 'Could not load registrations.', 500)
      }
    }

    // ---- detail --------------------------------------------------------------
    if (action === 'detail') {
      const registrationId = str(body.registrationId)
      if (!registrationId) return errorJson(req, 'MISSING_FIELDS', 'Registration id is required.', 400)

      const { data: registration } = await supabase
        .from('registrations')
        .select(`${REGISTRATION_SELECT}, request_ip, form_snapshot, category_id`)
        .eq('id', registrationId)
        .maybeSingle()

      if (!registration) return errorJson(req, 'NOT_FOUND', 'Registration not found.', 404)

      const [payments, audit] = await Promise.all([
        supabase
          .from('payments')
          .select(
            'id, razorpay_order_id, razorpay_payment_id, amount_paise, currency, status, method, failure_reason, signature_verified, attempt_number, created_at, verified_at',
          )
          .eq('registration_id', registrationId)
          .order('created_at', { ascending: false }),
        supabase
          .from('audit_logs')
          .select('*')
          .eq('entity_type', 'registration')
          .eq('entity_id', registrationId)
          .order('created_at', { ascending: false })
          .limit(50),
      ])

      return json(req, {
        registration,
        payments: payments.data ?? [],
        audit: audit.data ?? [],
      })
    }

    // ---- update ---------------------------------------------------------------
    if (action === 'update') {
      if (admin.role === 'viewer') {
        return errorJson(req, 'FORBIDDEN', 'Viewer accounts cannot edit registrations.', 403)
      }

      const registrationId = str(body.registrationId)
      const reason = str(body.reason)
      const fields = (body.fields ?? {}) as Record<string, unknown>
      if (!registrationId) return errorJson(req, 'MISSING_FIELDS', 'Registration id is required.', 400)

      const { data: registration } = await supabase
        .from('registrations')
        .select('id, status, payment_status, notes, registration_code')
        .eq('id', registrationId)
        .maybeSingle()
      if (!registration) return errorJson(req, 'NOT_FOUND', 'Registration not found.', 404)

      const updates: Record<string, unknown> = {}
      const changes: Record<string, unknown> = {}

      if ('status' in fields) {
        const target = str(fields.status)
        if (!REGISTRATION_STATUSES.includes(target)) {
          return errorJson(req, 'INVALID_STATUS', 'Invalid registration status.', 400)
        }
        updates.status = target
        changes.status = { from: registration.status, to: target }
      }

      if ('payment_status' in fields) {
        const target = str(fields.payment_status)
        if (target === 'paid') {
          return errorJson(
            req,
            'NOT_ALLOWED',
            'Payment status cannot be set to "paid" manually. Use Payments \u2192 Reconcile, which only succeeds when a captured payment exists.',
            403,
          )
        }
        if (!PAYMENT_STATUSES_ALLOWED.includes(target)) {
          return errorJson(req, 'INVALID_STATUS', 'Invalid payment status.', 400)
        }
        updates.payment_status = target
        changes.payment_status = { from: registration.payment_status, to: target }
      }

      if ('notes' in fields) {
        updates.notes = str(fields.notes).slice(0, 2000)
        changes.notes = { from: registration.notes, to: updates.notes }
      }

      if (Object.keys(updates).length === 0) {
        return errorJson(req, 'NO_CHANGES', 'Nothing to update.', 400)
      }
      if (('status' in updates || 'payment_status' in updates) && !reason) {
        return errorJson(req, 'REASON_REQUIRED', 'Please provide a reason for this change.', 400)
      }

      const { error: updateError } = await supabase
        .from('registrations')
        .update(updates)
        .eq('id', registrationId)
      if (updateError) {
        console.error('registration update failed', updateError)
        return errorJson(req, 'SERVER_ERROR', 'Could not update the registration.', 500)
      }

      await writeAudit(supabase, admin, 'registration.update', 'registration', registrationId, {
        registration_code: registration.registration_code,
        changes,
        reason,
      })

      const { data: refreshed } = await supabase
        .from('registrations')
        .select(REGISTRATION_SELECT)
        .eq('id', registrationId)
        .maybeSingle()

      return json(req, { ok: true, registration: refreshed })
    }

    return errorJson(req, 'UNKNOWN_ACTION', 'Unknown action.', 400)
  }),
)
