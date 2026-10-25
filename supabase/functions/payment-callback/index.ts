// Cashfree return callback.
//
// Cashfree sends the athlete's browser back to `order_meta.return_url` with the
// order id, as a GET (unlike Razorpay, which POSTs a signed payload). It is
// also safe to POST here, so form/webhook-style callers still work.
//
// This function is the trusted server: it asks Cashfree for the order status,
// records the capture, mints a single-use receipt token and redirects the
// browser to the receipt page. The browser never decides whether a payment
// succeeded.
import { handler } from '../_shared/handler.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { cashfreePaidPayment, fetchCashfreeOrder } from '../_shared/cashfree.ts'
import { markPaymentCaptured, notifyConfirmedRegistration } from '../_shared/payments.ts'

const RECEIPT_TOKEN_TTL_MINUTES = 30

function siteUrl(): string {
  return 'https://www.cdmaa.in'
}

/** Builds the redirect back to the site after a callback. */
function redirectTo(path: string, params: Record<string, string> = {}): Response {
  const url = new URL(`${siteUrl()}${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new Response(null, { status: 303, headers: { Location: url.toString() } })
}

function failure(message: string, appNo?: string | null, mobile?: string | null): Response {
  const params: Record<string, string> = { payment_callback: 'failed', payment_error: message }
  if (appNo) params.application_number = appNo
  if (mobile) params.mobile_e164 = mobile
  return redirectTo('/status', params)
}

Deno.serve(
  handler(async (req) => {
    const url = new URL(req.url)

    // Cashfree returns the order id on the query string. Accept a form/JSON
    // body too, so the endpoint keeps working for POST-based callers.
    const params = new URLSearchParams(url.search)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const raw = await req.text()
      const bodyParams = new URLSearchParams(raw)
      const contentType = req.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        try {
          const body = JSON.parse(raw) as Record<string, unknown>
          for (const [key, value] of Object.entries(body)) {
            if (typeof value === 'string') bodyParams.set(key, value)
          }
        } catch {
          /* fall through: treat as form-encoded */
        }
      }
      for (const [key, value] of bodyParams) if (!params.has(key)) params.set(key, value)
    }

    const orderId = params.get('order_id') ?? params.get('orderId') ?? params.get('razorpay_order_id') ?? ''

    // A stray hit with nothing to verify should land on the status page rather
    // than show an error page.
    if (!orderId) {
      return redirectTo('/status', { payment_callback: 'invalid' })
    }

    const supabase = serviceClient()

    const { data: order } = await supabase
      .from('payment_orders')
      .select('id, draft_id, status, amount_paise')
      .eq('razorpay_order_id', orderId)
      .maybeSingle()

    let appNoForRedirect: string | null = null
    let mobileForRedirect: string | null = null
    if (order?.draft_id) {
      const { data: draftRow } = await supabase
        .from('registration_drafts')
        .select('application_number, personal')
        .eq('id', order.draft_id)
        .maybeSingle()
      appNoForRedirect = (draftRow?.application_number as string | null) ?? null
      mobileForRedirect = (draftRow?.personal as any)?.mobile_e164 ?? null
    }

    if (!order) {
      console.error('payment-callback: unknown order', { orderId })
      return failure('We could not find that payment order. Please contact the organiser.', appNoForRedirect, mobileForRedirect)
    }

    // Also try to get mobile if not fetched
    if (order?.draft_id && !mobileForRedirect) {
      const { data: draftRow2 } = await supabase
        .from('registration_drafts')
        .select('personal')
        .eq('id', order.draft_id)
        .maybeSingle()
      mobileForRedirect = (draftRow2?.personal as any)?.mobile_e164 ?? mobileForRedirect
    }

    // Idempotent: a re-return (the athlete refreshing, or a retry) simply shows
    // the existing receipt again.
    if (order.status !== 'captured') {
      const remote = await fetchCashfreeOrder(orderId)
      if (!remote) {
        console.error('payment-callback: gateway lookup failed', { orderId })
        return failure('We could not confirm this payment. Please contact the organiser.', appNoForRedirect, mobileForRedirect)
      }

      if ((remote.order_status ?? '').toUpperCase() !== 'PAID') {
        return failure(`Payment is not completed yet. Please try again or contact the organiser.`, appNoForRedirect, mobileForRedirect)
      }

      if (Math.round(Number(remote.order_amount) * 100) !== Number(order.amount_paise)) {
        return failure('The paid amount does not match the registration fee. Please contact the organiser.', appNoForRedirect, mobileForRedirect)
      }

      const paid = await cashfreePaidPayment(remote)
      if (paid?.amountPaise != null && paid.amountPaise !== Number(order.amount_paise)) {
        return failure('The paid amount does not match the registration fee. Please contact the organiser.', appNoForRedirect, mobileForRedirect)
      }

      const result = await markPaymentCaptured(supabase, {
        orderId,
        paymentId: paid?.paymentId ?? null,
        method: paid?.method ?? null,
      })
      if (!result.ok) {
        console.error('payment-callback: capture failed', result.error)
        return failure('We could not confirm this payment. Please contact the organiser.', appNoForRedirect, mobileForRedirect)
      }
      if (!result.alreadyCaptured) {
        await notifyConfirmedRegistration(supabase, result.registrationId!, paid?.paymentId ?? null)
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
