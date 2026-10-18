// Creates a fresh Razorpay order for a pending (unpaid) registration.
// Used when a previous checkout failed, was cancelled or was abandoned.
// Requires the registration code AND the registered mobile number, so a bib
// number alone cannot be used to probe or spam the payment gateway.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, readJson, str } from '../_shared/helpers.ts'
import { normalizeMobile } from '../_shared/athlete-lookup.ts'
import { createRazorpayOrder, razorpayConfigured, razorpayKeyId } from '../_shared/razorpay.ts'

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const registrationCode = str(body.registrationCode).toUpperCase()
    const mobileE164 = normalizeMobile(str(body.mobileE164))

    if (!registrationCode || !mobileE164) {
      return errorJson(
        req,
        'MISSING_FIELDS',
        'Please provide your registration ID / bib number and the registered mobile number.',
        400,
      )
    }

    const supabase = serviceClient()
    const ip = clientIp(req)
    await enforceRateLimit(supabase, `payment-retry:ip:${ip}`, 30, 3600)
    await enforceRateLimit(supabase, `payment-retry:code:${registrationCode}`, 12, 3600)

    const { data: registration } = await supabase
      .from('registrations')
      .select(
        'id, registration_code, fee_paise, currency, status, payment_status, championship_id, athlete_profiles (mobile_e164), championships (id, name, status, registration_closes_at)',
      )
      .ilike('registration_code', registrationCode)
      .maybeSingle()

    const profile = (registration as unknown as { athlete_profiles?: { mobile_e164: string } } | null)
      ?.athlete_profiles

    if (!registration || !profile || profile.mobile_e164 !== mobileE164) {
      return errorJson(
        req,
        'NOT_FOUND',
        'No pending registration matches those details. Please check the registration ID and mobile number.',
        404,
      )
    }

    if (registration.payment_status === 'paid') {
      return errorJson(req, 'ALREADY_PAID', 'This registration is already paid.', 409)
    }
    if (registration.status === 'cancelled') {
      return errorJson(req, 'NOT_RETRYABLE', 'This registration has been cancelled.', 409)
    }

    // Mandatory Aadhaar upload must have been recorded before creating an order.
    const { data: regCheck } = await supabase
      .from('registrations')
      .select('aadhaar_verified_at')
      .eq('id', registration.id)
      .maybeSingle()
    if (!regCheck?.aadhaar_verified_at) {
      return errorJson(req, 'AADHAAR_REQUIRED', 'Please upload your Aadhaar front before making payment.', 400)
    }

    const championship = (registration as unknown as {
      championships?: { name: string; status: string; registration_closes_at: string | null }
    }).championships

    if (championship?.status !== 'open') {
      return errorJson(req, 'REGISTRATION_CLOSED', 'Registration for this championship is not open.', 409)
    }
    if (championship.registration_closes_at && new Date(championship.registration_closes_at) < new Date()) {
      return errorJson(req, 'DEADLINE_PASSED', 'The registration deadline has passed.', 409)
    }

    if (!razorpayConfigured()) {
      return errorJson(
        req,
        'PAYMENTS_NOT_CONFIGURED',
        'Online payment is not configured for this deployment yet. Please contact the organiser.',
        503,
      )
    }

    const { count } = await supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('registration_id', registration.id)
    const attemptNumber = (count ?? 0) + 1

    let orderId: string
    try {
      const order = await createRazorpayOrder({
        amountPaise: Number(registration.fee_paise),
        currency: registration.currency,
        receipt: registration.registration_code,
        notes: { registration_id: registration.id, attempt: String(attemptNumber) },
      })
      orderId = order.id
    } catch (error) {
      console.error('retry order failed', error)
      return errorJson(req, 'ORDER_FAILED', 'Could not create a new payment order. Please try again.', 502)
    }

    const { error: insertError } = await supabase.from('payments').insert({
      registration_id: registration.id,
      razorpay_order_id: orderId,
      amount_paise: Number(registration.fee_paise),
      currency: registration.currency,
      status: 'created',
      attempt_number: attemptNumber,
    })
    if (insertError) {
      console.error('retry payment insert failed', insertError)
      return errorJson(req, 'SERVER_ERROR', 'Could not start the payment. Please try again.', 500)
    }

    // Return this order to a coherent state: the previous attempt is abandoned.
    await supabase
      .from('registrations')
      .update({ payment_status: 'pending' })
      .eq('id', registration.id)
      .eq('payment_status', 'failed')

    return json(req, {
      ok: true,
      registration: {
        id: registration.id,
        registration_code: registration.registration_code,
        fee_paise: Number(registration.fee_paise),
        currency: registration.currency,
      },
      payment: {
        configured: true,
        razorpay_order_id: orderId,
        razorpay_key_id: razorpayKeyId(),
        amount_paise: Number(registration.fee_paise),
        currency: registration.currency,
      },
    })
  }),
)
