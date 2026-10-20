// Razorpay redirect callback for net banking and bank UPI apps.
//
// Razorpay POSTs the payment result here rather than to the site, because a
// static Vercel deployment answers POST with 405. This function is the trusted
// server: it verifies the signature, asks Razorpay about the payment, records
// the capture, mints a single-use receipt token and redirects the browser to
// the receipt page. The browser never decides whether a payment succeeded.
//
// Razorpay follows redirects on POST, so the response is a 303 (See Other),
// which is the correct way to turn a POST into a GET.
import { handler } from '../_shared/handler.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { verifyCheckoutSignature, fetchRazorpayPayment } from '../_shared/razorpay.ts'
import { markPaymentCaptured, notifyConfirmedRegistration } from '../_shared/payments.ts'

const RECEIPT_TOKEN_TTL_MINUTES = 30

function siteUrl(): string {
  return (Deno.env.get('SITE_URL') ?? 'https://www.cdmaa.in').replace(/\/+$/, '')
}

/** Builds the redirect back to the site after a callback. */
function redirectTo(path: string, params: Record<string, string> = {}): Response {
  const url = new URL(`${siteUrl()}${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new Response(null, { status: 303, headers: { Location: url.toString() } })
}

Deno.serve(
  handler(async (req) => {
    if (req.method !== 'POST') {
      // A stray GET (someone opening the URL) should land them on the status
      // page rather than show an error page.
      return redirectTo('/status', { payment_callback: 'invalid' })
    }

    // Razorpay posts these as application/x-www-form-urlencoded. Read the raw
    // text once and parse, so a JSON body is handled too.
    const raw = await req.text()
    const params = new URLSearchParams(raw)
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      try {
        const body = JSON.parse(raw) as Record<string, unknown>
        for (const [key, value] of Object.entries(body)) {
          if (typeof value === 'string') params.set(key, value)
        }
      } catch {
        /* fall through: treat as form-encoded */
      }
    }

    const orderId = params.get('razorpay_order_id') ?? ''
    const paymentId = params.get('razorpay_payment_id') ?? ''
    const signature = params.get('razorpay_signature') ?? ''
    const errorCode = params.get('error[code]') ?? params.get('error_code') ?? ''
    const errorDescription = params.get('error[description]') ?? params.get('error_description') ?? ''

    if (!orderId || !paymentId || !signature) {
      console.error('payment-callback: incomplete return', { orderId, paymentId, hasSignature: Boolean(signature) })
      return redirectTo('/status', {
        payment_callback: 'failed',
        payment_error: errorDescription || errorCode || 'Payment was not completed. Please try again.',
      })
    }

    const supabase = serviceClient()

    const { data: order } = await supabase
      .from('payment_orders')
      .select('id, draft_id, status, amount_paise')
      .eq('razorpay_order_id', orderId)
      .maybeSingle()

    if (!order) {
      console.error('payment-callback: unknown order', { orderId })
      return redirectTo('/status', {
        payment_callback: 'failed',
        payment_error: 'We could not find that payment order. Please contact the organiser.',
      })
    }

    // Idempotent: a re-post (the athlete refreshing, or a retry) simply returns
    // the existing receipt.
    if (order.status !== 'captured') {
      const signatureValid = await verifyCheckoutSignature(orderId, paymentId, signature)
      if (!signatureValid) {
        console.error('payment-callback: invalid signature', { orderId, paymentId })
        await supabase
          .from('payment_orders')
          .update({
            failure_reason: 'Signature verification failed',
            signature_verified: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id)
        return redirectTo('/status', {
          payment_callback: 'failed',
          payment_error: 'Payment verification failed. If money was deducted, please contact the organiser.',
        })
      }

      // Second factor: ask Razorpay directly.
      const remote = await fetchRazorpayPayment(paymentId)
      if (remote) {
        const remoteOrder = String(remote.order_id ?? '')
        const remoteStatus = String(remote.status ?? '')
        const remoteAmount = Number(remote.amount ?? -1)
        if (remoteOrder !== orderId) {
          return redirectTo('/status', {
            payment_callback: 'failed',
            payment_error: 'Payment does not match this registration. Please contact the organiser.',
          })
        }
        if (!['captured', 'authorized'].includes(remoteStatus)) {
          return redirectTo('/status', {
            payment_callback: 'failed',
            payment_error: `Payment is not completed yet. Please try again or contact the organiser.`,
          })
        }
        if (remoteAmount !== Number(order.amount_paise)) {
          return redirectTo('/status', {
            payment_callback: 'failed',
            payment_error: 'The paid amount does not match the registration fee. Please contact the organiser.',
          })
        }
      }

      const method = remote ? String(remote.method ?? '') : null
      const result = await markPaymentCaptured(supabase, { orderId, paymentId, method })
      if (!result.ok) {
        console.error('payment-callback: capture failed', result.error)
        return redirectTo('/status', {
          payment_callback: 'failed',
          payment_error: 'We could not confirm this payment. Please contact the organiser.',
        })
      }
      if (!result.alreadyCaptured) {
        await notifyConfirmedRegistration(supabase, result.registrationId!, paymentId)
      }
    }

    // The draft has been promoted, so the registration now exists.
    const { data: registration } = await supabase
      .from('registrations')
      .select('id')
      .eq('draft_id', order.draft_id)
      .maybeSingle()

    if (!registration) {
      console.error('payment-callback: registration missing after capture', { orderId })
      return redirectTo('/registration/success', { payment_callback: 'paid' })
    }

    // Mint a single-use token so the receipt can be shown without trusting
    // anything the browser supplies.
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    const { data: tokenHash, error: hashError } = await supabase.rpc('hash_secret', { p_value: token })
    if (hashError || !tokenHash) {
      console.error('payment-callback: could not hash receipt token', hashError)
      return redirectTo('/registration/success', { payment_callback: 'paid' })
    }
    const expiresAt = new Date(Date.now() + RECEIPT_TOKEN_TTL_MINUTES * 60_000).toISOString()

    const { error: tokenError } = await supabase.from('receipt_tokens').insert({
      token_hash: tokenHash as string,
      registration_id: registration.id,
      expires_at: expiresAt,
    })
    if (tokenError) {
      console.error('payment-callback: could not store receipt token', tokenError)
      // The payment is captured, so still send them to the receipt page: it can
      // fall back to the status lookup.
      return redirectTo('/registration/success', { payment_callback: 'paid' })
    }

    // Best-effort cleanup; never blocks the redirect.
    try {
      await supabase.rpc('prune_receipt_tokens')
    } catch (err) {
      console.error('prune_receipt_tokens failed (non-fatal)', err)
    }

    return redirectTo('/registration/success', { receipt: token })
  }),
)
