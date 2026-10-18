// Payment state transitions shared by the checkout verification endpoint and
// the Razorpay webhook. All transitions are idempotent and only ever move a
// registration to "paid" when a verified payment exists.

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

export async function markPaymentCaptured(
  supabase: any,
  input: { orderId: string; paymentId?: string | null; method?: string | null },
): Promise<CaptureResult> {
  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .select('id, registration_id, amount_paise, currency, status, razorpay_payment_id')
    .eq('razorpay_order_id', input.orderId)
    .maybeSingle()

  if (paymentError) {
    console.error('capture: payment lookup failed', paymentError)
    return { ok: false, alreadyCaptured: false, error: 'SERVER_ERROR' }
  }
  if (!payment) return { ok: false, alreadyCaptured: false, error: 'PAYMENT_NOT_FOUND' }

  const { data: registration } = await supabase
    .from('registrations')
    .select('id, fee_paise, currency, payment_status, status')
    .eq('id', payment.registration_id)
    .maybeSingle()

  if (!registration) return { ok: false, alreadyCaptured: false, error: 'REGISTRATION_NOT_FOUND' }

  // Never confirm an amount that does not match the server-calculated fee.
  if (Number(registration.fee_paise) !== Number(payment.amount_paise)) {
    console.error('capture: amount mismatch', {
      orderId: input.orderId,
      expected: registration.fee_paise,
      order: payment.amount_paise,
    })
    return { ok: false, alreadyCaptured: false, error: 'AMOUNT_MISMATCH' }
  }

  if (payment.status === 'captured' && registration.payment_status === 'paid') {
    return {
      ok: true,
      alreadyCaptured: true,
      registrationId: registration.id,
      amountPaise: registration.fee_paise,
      currency: registration.currency,
    }
  }

  const now = new Date().toISOString()

  // Guard with status filter so duplicate/out-of-order events cannot regress state.
  const { data: updatedPayments, error: updateError } = await supabase
    .from('payments')
    .update({
      status: 'captured',
      razorpay_payment_id: input.paymentId ?? payment.razorpay_payment_id,
      method: input.method ?? null,
      signature_verified: true,
      verified_at: now,
      failure_reason: null,
    })
    .eq('id', payment.id)
    .in('status', ['created', 'authorized', 'failed', 'expired'])
    .select('id')

  if (updateError) {
    // A unique violation on razorpay_payment_id means this payment is already
    // attached to another order — treat as a duplicate, never double-credit.
    console.error('capture: payment update failed', updateError)
    return { ok: false, alreadyCaptured: false, error: 'PAYMENT_UPDATE_FAILED' }
  }

  if (!updatedPayments || updatedPayments.length === 0) {
    // Already captured/refunded by a concurrent request: ensure the
    // registration is consistent and report success.
    const { data: fresh } = await supabase
      .from('payments')
      .select('status')
      .eq('id', payment.id)
      .maybeSingle()
    if (fresh?.status === 'captured') {
      await supabase
        .from('registrations')
        .update({ payment_status: 'paid', status: 'confirmed', confirmed_at: now })
        .eq('id', registration.id)
        .neq('payment_status', 'paid')
      try {
        await supabase.rpc('assign_bib', { p_registration_id: registration.id })
      } catch (err) {
        console.error('assign_bib failed (idempotent)', err)
      }
      return {
        ok: true,
        alreadyCaptured: true,
        registrationId: registration.id,
        amountPaise: registration.fee_paise,
        currency: registration.currency,
      }
    }
    return { ok: false, alreadyCaptured: false, error: 'PAYMENT_NOT_CAPTURABLE' }
  }

  await supabase
    .from('registrations')
    .update({ payment_status: 'paid', status: 'confirmed', confirmed_at: now })
    .eq('id', registration.id)

  // Assign the bib number (race-safe). The function returns the bib if already
  // assigned.
  try {
    await supabase.rpc('assign_bib', { p_registration_id: registration.id })
  } catch (err) {
    console.error('assign_bib failed', err)
  }

  return {
    ok: true,
    alreadyCaptured: false,
    registrationId: registration.id,
    amountPaise: registration.fee_paise,
    currency: registration.currency,
  }
}

export async function markPaymentFailed(
  supabase: any,
  input: { orderId: string; reason?: string | null },
): Promise<void> {
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
      'id, registration_code, bib_number, status, payment_status, fee_paise, currency, registered_at, confirmed_at, championships (id, name, slug, starts_on, ends_on, location), championship_categories (name), athlete_profiles (athlete_id, full_name, email), registration_events (event_name)',
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
