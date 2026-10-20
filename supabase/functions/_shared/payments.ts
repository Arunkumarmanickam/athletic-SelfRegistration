// Payment state transitions shared by the checkout verification endpoint and
// the Razorpay webhook. All transitions are idempotent and only ever move a
// registration to "paid" when a verified payment exists.
//
// A payment order is placed against a registration DRAFT, not a registration:
// before payment there is no athlete profile, no Athlete ID, no bib and no
// registration row. Capturing the payment promotes the draft — creating the
// profile, the Athlete ID, the bib and the registration — and then records the
// payment against that new registration.

import { sendConfirmationEmail } from './notify.ts'

// deno-lint-ignore-file no-explicit-any

export interface CaptureResult {
  ok: boolean
  alreadyCaptured: boolean
  registrationId?: string
  amountPaise?: number
  currency?: string
  error?: string
}

/**
 * Records a verified capture and promotes the underlying draft.
 *
 * Idempotent: a repeat call (webhook plus browser callback, or a retry) returns
 * the already-created registration without issuing a second Athlete ID or bib.
 */
export async function markPaymentCaptured(
  supabase: any,
  input: { orderId: string; paymentId?: string | null; method?: string | null },
): Promise<CaptureResult> {
  const { data: order, error: orderError } = await supabase
    .from('payment_orders')
    .select('id, draft_id, amount_paise, currency, status, razorpay_payment_id')
    .eq('razorpay_order_id', input.orderId)
    .maybeSingle()

  if (orderError) {
    console.error('capture: order lookup failed', orderError)
    return { ok: false, alreadyCaptured: false, error: 'SERVER_ERROR' }
  }
  if (!order) return { ok: false, alreadyCaptured: false, error: 'PAYMENT_NOT_FOUND' }

  const now = new Date().toISOString()

  // Already captured: the draft was promoted on the first call. Resolve the
  // registration the draft became and report success.
  if (order.status === 'captured') {
    const { data: existing } = await supabase
      .from('registrations')
      .select('id, fee_paise, currency')
      .eq('draft_id', order.draft_id)
      .maybeSingle()
    if (existing) {
      return {
        ok: true,
        alreadyCaptured: true,
        registrationId: existing.id,
        amountPaise: existing.fee_paise,
        currency: existing.currency,
      }
    }
    // The promotion never completed; fall through and try again.
  }

  // Promote the draft: this is where the Athlete ID, the bib and the
  // registration are finally created. The amount check happens inside, against
  // the server-calculated fee.
  const { data: promoted, error: promoteError } = await supabase.rpc('promote_draft', {
    p_draft_id: order.draft_id,
  })
  if (promoteError) {
    console.error('capture: promote_draft failed', promoteError)
    return { ok: false, alreadyCaptured: false, error: 'PROMOTE_FAILED' }
  }

  const result = promoted as Record<string, unknown>
  if (result?.ok !== true) {
    const err = (result?.error ?? {}) as { code?: string; message?: string }
    console.error('capture: promote_draft rejected', err)
    return { ok: false, alreadyCaptured: false, error: err.code ?? 'PROMOTE_FAILED' }
  }

  const registrationId = result.registration_id as string

  // Never confirm an amount that does not match the server-calculated fee.
  if (Number(result.fee_paise) !== Number(order.amount_paise)) {
    console.error('capture: amount mismatch', {
      orderId: input.orderId,
      registration: result.fee_paise,
      order: order.amount_paise,
    })
    return { ok: false, alreadyCaptured: false, error: 'AMOUNT_MISMATCH' }
  }

  // Mark the order captured (guarded so a concurrent call cannot double-count).
  const { data: updatedOrders, error: updateError } = await supabase
    .from('payment_orders')
    .update({
      status: 'captured',
      razorpay_payment_id: input.paymentId ?? order.razorpay_payment_id,
      method: input.method ?? null,
      signature_verified: true,
      verified_at: now,
      failure_reason: null,
      updated_at: now,
    })
    .eq('id', order.id)
    .in('status', ['created', 'authorized', 'failed', 'expired'])
    .select('id')

  if (updateError) {
    console.error('capture: order update failed', updateError)
    return { ok: false, alreadyCaptured: false, error: 'PAYMENT_UPDATE_FAILED' }
  }

  // Record the payment against the now-existing registration, unless a webhook
  // has already written it.
  const { data: existingPayment } = await supabase
    .from('payments')
    .select('id')
    .eq('razorpay_order_id', input.orderId)
    .maybeSingle()

  if (!existingPayment) {
    const { error: insertError } = await supabase.from('payments').insert({
      registration_id: registrationId,
      razorpay_order_id: input.orderId,
      razorpay_payment_id: input.paymentId ?? null,
      amount_paise: Number(order.amount_paise),
      currency: order.currency,
      status: 'captured',
      method: input.method ?? null,
      signature_verified: true,
      verified_at: now,
      attempt_number: 1,
    })
    if (insertError) {
      // A unique violation on razorpay_payment_id means another writer won:
      // the payment is already recorded, which is the desired end state.
      console.error('capture: payment insert failed', insertError)
    }
  }

  return {
    ok: true,
    alreadyCaptured: updatedOrders?.length === 0,
    registrationId,
    amountPaise: Number(result.fee_paise),
    currency: (result.currency as string) ?? order.currency,
  }
}

export async function markPaymentFailed(
  supabase: any,
  input: { orderId: string; reason?: string | null },
): Promise<void> {
  // A failed attempt against a draft: the draft survives, so the athlete can
  // try again. Nothing permanent was created, so nothing needs rolling back.
  const { data: order } = await supabase
    .from('payment_orders')
    .select('id, status')
    .eq('razorpay_order_id', input.orderId)
    .maybeSingle()

  if (order) {
    if (order.status === 'captured') return // never regress a captured payment
    await supabase
      .from('payment_orders')
      .update({
        status: 'failed',
        failure_reason: input.reason ?? 'Payment was not completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .in('status', ['created', 'authorized', 'failed', 'expired'])
  }

  // Legacy path: an order that already has a payment row for a real
  // registration (created before drafts existed).
  const { data: payment } = await supabase
    .from('payments')
    .select('id, registration_id, status')
    .eq('razorpay_order_id', input.orderId)
    .maybeSingle()
  if (!payment) return

  // Never regress a captured payment.
  if (payment.status === 'captured' || payment.status === 'refunded') return

  await supabase
    .from('payments')
    .update({ status: 'failed', failure_reason: input.reason ?? 'Payment was not completed' })
    .eq('id', payment.id)
    .in('status', ['created', 'authorized', 'failed', 'expired'])

  const { data: registration } = await supabase
    .from('registrations')
    .select('id, payment_status')
    .eq('id', payment.registration_id)
    .maybeSingle()

  if (registration && registration.payment_status === 'pending') {
    await supabase
      .from('registrations')
      .update({ payment_status: 'failed' })
      .eq('id', registration.id)
      .eq('payment_status', 'pending')
  }
}

export async function markPaymentRefunded(
  supabase: any,
  input: { orderId?: string | null; paymentId?: string | null },
): Promise<void> {
  let query = supabase.from('payments').select('id, registration_id, status')
  query = input.orderId
    ? query.eq('razorpay_order_id', input.orderId)
    : query.eq('razorpay_payment_id', input.paymentId ?? '')
  const { data: payment } = await query.maybeSingle()
  if (!payment) return

  await supabase
    .from('payments')
    .update({ status: 'refunded' })
    .eq('id', payment.id)
    .in('status', ['captured', 'authorized'])

  await supabase
    .from('registrations')
    .update({ payment_status: 'refunded' })
    .eq('id', payment.registration_id)
    .eq('payment_status', 'paid')
}

/** Loads the confirmation payload shown after a verified payment. */
export async function loadConfirmation(
  supabase: any,
  registrationId: string,
): Promise<Record<string, unknown> | null> {
  const { data: registration } = await supabase
    .from('registrations')
    .select(
      'id, registration_code, bib_number, status, payment_status, fee_paise, currency, registered_at, confirmed_at, championships (id, name, slug, starts_on, ends_on, location), championship_categories (name), athlete_profiles (athlete_id, full_name, email, mobile_e164, state, district), registration_events (event_name, fee_paise)',
    )
    .eq('id', registrationId)
    .maybeSingle()

  if (!registration) return null

  const { data: payments } = await supabase
    .from('payments')
    .select('razorpay_order_id, razorpay_payment_id, amount_paise, currency, status, method, verified_at')
    .eq('registration_id', registrationId)
    .order('created_at', { ascending: false })

  return { registration, payments: payments ?? [] }
}

/**
 * Sends the confirmation email for a verified payment. Never throws and never
 * pretends a message went out when no provider is configured.
 */
export async function notifyConfirmedRegistration(
  supabase: any,
  registrationId: string,
  paymentId: string | null,
): Promise<void> {
  try {
    const confirmation = await loadConfirmation(supabase, registrationId)
    if (!confirmation) return
    const reg = confirmation.registration as Record<string, unknown>
    const profile = reg.athlete_profiles as
      | { athlete_id?: string; full_name?: string; email?: string | null }
      | null
    const championship = reg.championships as { name?: string } | null
    const events = (reg.registration_events as { event_name: string }[] | null) ?? []

    const result = await sendConfirmationEmail({
      to: profile?.email ?? null,
      athleteName: profile?.full_name ?? '',
      athleteId: profile?.athlete_id ?? '',
      championshipName: championship?.name ?? '',
      registrationCode: String(reg.bib_number ?? reg.registration_code ?? ''),
      events: events.map((e) => e.event_name),
      amountPaise: Number(reg.fee_paise ?? 0),
      currency: String(reg.currency ?? 'INR'),
      paymentId,
    })
    if (!result.sent) console.log('confirmation email not sent:', result.reason)
  } catch (error) {
    console.error('confirmation notification failed', error)
  }
}
