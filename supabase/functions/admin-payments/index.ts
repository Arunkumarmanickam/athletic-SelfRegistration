// Admin API for payments.
//
// Payment status is NEVER set to "paid" by hand. The only path to a paid
// registration is a verified Razorpay payment (or the "reconcile" action,
// which requires an existing captured payment row and a written reason).
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { requireAdmin, writeAudit } from '../_shared/admin-auth.ts'
import { str } from '../_shared/helpers.ts'
import { fetchPayments, sanitizePaymentFilters } from '../_shared/admin-queries.ts'

Deno.serve(
  handler(async (req) => {
    const context = await requireAdmin(req)
    if (context instanceof Response) return context
    const { supabase, admin } = context

    const body = await req.json().catch(() => ({}) as Record<string, unknown>)
    const action = str(body.action) || 'list'

    // ---- list ---------------------------------------------------------------
    if (action === 'list') {
      const filters = sanitizePaymentFilters(body as Record<string, unknown>)
      const page = Math.max(1, Number(body.page) || 1)
      const pageSize = Math.min(200, Math.max(1, Number(body.pageSize) || 25))
      try {
        const result = await fetchPayments(supabase, filters, page, pageSize)
        return json(req, result)
      } catch (queryError) {
        console.error('payments list failed', queryError)
        return errorJson(req, 'SERVER_ERROR', 'Could not load payments.', 500)
      }
    }

    // ---- detail --------------------------------------------------------------
    if (action === 'detail') {
      const paymentId = str(body.paymentId)
      if (!paymentId) return errorJson(req, 'MISSING_FIELDS', 'Payment id is required.', 400)

      const { data: payment } = await supabase
        .from('payments')
        .select(
          'id, registration_id, razorpay_order_id, razorpay_payment_id, amount_paise, currency, status, method, failure_reason, signature_verified, attempt_number, created_at, updated_at, verified_at, registrations (id, registration_code, status, payment_status, fee_paise, currency, registered_at, championships (id, name), athlete_profiles (athlete_id, full_name, mobile_e164, email))',
        )
        .eq('id', paymentId)
        .maybeSingle()
      if (!payment) return errorJson(req, 'NOT_FOUND', 'Payment not found.', 404)

      const [history, audit] = await Promise.all([
        supabase
          .from('payments')
          .select('id, razorpay_order_id, razorpay_payment_id, amount_paise, status, attempt_number, created_at, verified_at')
          .eq('registration_id', payment.registration_id)
          .order('created_at', { ascending: false }),
        supabase
          .from('audit_logs')
          .select('*')
          .eq('entity_id', payment.registration_id)
          .order('created_at', { ascending: false })
          .limit(50),
      ])

      return json(req, { payment, attempts: history.data ?? [], audit: audit.data ?? [] })
    }

    // ---- actions -------------------------------------------------------------
    if (action === 'mark_refunded') {
      if (admin.role === 'viewer') return errorJson(req, 'FORBIDDEN', 'Viewers cannot change payments.', 403)
      const paymentId = str(body.paymentId)
      const reason = str(body.reason)
      if (!paymentId || !reason) {
        return errorJson(req, 'MISSING_FIELDS', 'A payment id and a reason are required.', 400)
      }

      const { data: payment } = await supabase
        .from('payments')
        .select('id, registration_id, status, razorpay_payment_id, amount_paise')
        .eq('id', paymentId)
        .maybeSingle()
      if (!payment) return errorJson(req, 'NOT_FOUND', 'Payment not found.', 404)
      if (payment.status !== 'captured') {
        return errorJson(
          req,
          'NOT_REFUNDABLE',
          'Only captured payments can be marked as refunded. Issue the refund in the Razorpay dashboard first, then record it here.',
          409,
        )
      }

      await supabase.from('payments').update({ status: 'refunded' }).eq('id', payment.id)
      await supabase
        .from('registrations')
        .update({ payment_status: 'refunded' })
        .eq('id', payment.registration_id)
        .eq('payment_status', 'paid')

      await writeAudit(supabase, admin, 'payment.refunded', 'registration', payment.registration_id, {
        payment_id: payment.razorpay_payment_id,
        amount_paise: payment.amount_paise,
        reason,
      })
      return json(req, { ok: true })
    }

    if (action === 'mark_failed') {
      if (admin.role === 'viewer') return errorJson(req, 'FORBIDDEN', 'Viewers cannot change payments.', 403)
      const paymentId = str(body.paymentId)
      const reason = str(body.reason)
      if (!paymentId || !reason) {
        return errorJson(req, 'MISSING_FIELDS', 'A payment id and a reason are required.', 400)
      }

      const { data: payment } = await supabase
        .from('payments')
        .select('id, registration_id, status')
        .eq('id', paymentId)
        .maybeSingle()
      if (!payment) return errorJson(req, 'NOT_FOUND', 'Payment not found.', 404)
      if (['captured', 'refunded'].includes(payment.status)) {
        return errorJson(req, 'NOT_ALLOWED', 'A captured or refunded payment cannot be marked as failed.', 409)
      }

      await supabase
        .from('payments')
        .update({ status: 'failed', failure_reason: reason })
        .eq('id', payment.id)
      await supabase
        .from('registrations')
        .update({ payment_status: 'failed' })
        .eq('id', payment.registration_id)
        .eq('payment_status', 'pending')

      await writeAudit(supabase, admin, 'payment.marked_failed', 'registration', payment.registration_id, {
        reason,
      })
      return json(req, { ok: true })
    }

    // Reconciliation: only succeeds when a captured payment exists for the
    // registration, i.e. money really was received.
    if (action === 'reconcile') {
      if (admin.role === 'viewer') return errorJson(req, 'FORBIDDEN', 'Viewers cannot reconcile payments.', 403)
      const registrationId = str(body.registrationId)
      const reason = str(body.reason)
      if (!registrationId || !reason) {
        return errorJson(req, 'MISSING_FIELDS', 'A registration id and a written reason are required.', 400)
      }

      const { data: captured } = await supabase
        .from('payments')
        .select('id, razorpay_payment_id, amount_paise')
        .eq('registration_id', registrationId)
        .eq('status', 'captured')
        .limit(1)
        .maybeSingle()

      if (!captured) {
        return errorJson(
          req,
          'NO_VERIFIED_PAYMENT',
          'Reconciliation refused: no captured (verified) payment exists for this registration. Verify the payment in Razorpay before recording it as paid.',
          409,
        )
      }

      const { data: registration } = await supabase
        .from('registrations')
        .select('id, registration_code, fee_paise, payment_status')
        .eq('id', registrationId)
        .maybeSingle()
      if (!registration) return errorJson(req, 'NOT_FOUND', 'Registration not found.', 404)

      await supabase
        .from('registrations')
        .update({ payment_status: 'paid', status: 'confirmed', confirmed_at: new Date().toISOString() })
        .eq('id', registrationId)

      await writeAudit(supabase, admin, 'payment.reconciled', 'registration', registrationId, {
        registration_code: registration.registration_code,
        previous_payment_status: registration.payment_status,
        payment_id: captured.razorpay_payment_id,
        amount_paise: captured.amount_paise,
        reason,
      })
      return json(req, { ok: true })
    }

    return errorJson(req, 'UNKNOWN_ACTION', 'Unknown action.', 400)
  }),
)
