// PhonePe webhook receiver.
//
// PhonePe can deliver `checkout.order.completed`, `checkout.order.failed`,
// `pg.refund.completed` and `pg.refund.failed`. The browser callback remains the
// primary confirmation path; this webhook covers the case where the athlete
// closes the tab or the return redirect is lost.
//
// Requirements implemented here:
//   * The request is authenticated with the SHA256(username:password) scheme
//     configured in the PhonePe dashboard; unauthenticated calls are rejected.
//   * Every event id is stored once, so duplicate and out-of-order deliveries
//     are processed idempotently.
//   * A "completed" event is re-verified against the Order Status API before
//     anything is captured — the webhook body alone is never trusted.
//   * Payment state only ever moves forward (capture never regresses).
import { handler } from '../_shared/handler.ts'
import { json } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import {
  fetchPhonePeOrder,
  phonepeFailureReason,
  phonepeOrderAmountPaise,
  phonepeOrderPaid,
  phonepePaidPayment,
} from '../_shared/phonepe.ts'
import {
  markPaymentCaptured,
  markPaymentFailed,
  markPaymentRefunded,
  notifyConfirmedRegistration,
} from '../_shared/payments.ts'

Deno.serve(
  handler(async (req) => {
    if (req.method !== 'POST') return json(req, { ok: false, error: 'Method not allowed' }, 405)

    const username = Deno.env.get('PHONEPE_WEBHOOK_USERNAME')
    const password = Deno.env.get('PHONEPE_WEBHOOK_PASSWORD')
    if (!username || !password) {
      console.error('phonepe webhook credentials are not configured')
      return json(req, { ok: false, error: 'Webhook not configured' }, 503)
    }

    const rawBody = await req.text()
    const authorised = await verifyWebhookAuth(
      req.headers.get('authorization') ?? '',
      username,
      password,
    )
    if (!authorised) {
      console.error('phonepe webhook authentication failed')
      return json(req, { ok: false, error: 'Invalid signature' }, 401)
    }

    let event: Record<string, unknown>
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return json(req, { ok: false, error: 'Invalid payload' }, 400)
    }

    const eventType = String(event.event ?? 'unknown')
    const payload = (event.payload ?? {}) as Record<string, unknown>
    const merchantOrderId = String(payload.merchantOrderId ?? payload.originalMerchantOrderId ?? '')
    const orderId = String(payload.orderId ?? payload.refundId ?? '')
    const bodyHash = (await sha256(rawBody)).slice(0, 32)
    const eventId = `phonepe-${eventType}-${merchantOrderId || orderId || bodyHash}`

    const supabase = serviceClient()

    // Idempotency gate: the unique constraint decides who processes an event.
    const { error: insertError } = await supabase.from('payment_events').insert({
      razorpay_event_id: eventId,
      event_type: eventType,
      payload: event,
      processing_status: 'received',
    })

    if (insertError) {
      if (insertError.code === '23505') {
        return json(req, { ok: true, status: 'duplicate_ignored' }, 200)
      }
      console.error('webhook event insert failed', insertError)
      return json(req, { ok: false, error: 'Could not record event' }, 500)
    }

    let status: 'processed' | 'ignored' | 'failed' = 'ignored'
    let errorText: string | null = null

    try {
      switch (eventType) {
        case 'checkout.order.completed': {
          if (!merchantOrderId) {
            status = 'ignored'
            break
          }

          // Re-verify with PhonePe: the webhook body is a hint, not proof.
          const remote = await fetchPhonePeOrder(merchantOrderId)
          if (!remote || !phonepeOrderPaid(remote)) {
            status = 'failed'
            errorText = 'Gateway does not report this order as completed'
            break
          }

          const { data: localOrder } = await supabase
            .from('payment_orders')
            .select('amount_paise')
            .eq('razorpay_order_id', merchantOrderId)
            .maybeSingle()

          if (!localOrder) {
            status = 'ignored'
            break
          }

          const remoteAmount = phonepeOrderAmountPaise(remote)
          if (remoteAmount !== null && remoteAmount !== Number(localOrder.amount_paise)) {
            status = 'failed'
            errorText = 'Amount mismatch'
            break
          }

          const paid = phonepePaidPayment(remote)
          if (paid?.amountPaise != null && paid.amountPaise !== Number(localOrder.amount_paise)) {
            status = 'failed'
            errorText = 'Payment amount mismatch'
            break
          }

          const result = await markPaymentCaptured(supabase, {
            orderId: merchantOrderId,
            paymentId: paid?.paymentId ?? null,
            method: paid?.method ?? null,
          })
          if (!result.ok) {
            status = 'failed'
            errorText = result.error ?? 'capture failed'
          } else {
            status = 'processed'
            if (!result.alreadyCaptured && result.registrationId) {
              await notifyConfirmedRegistration(supabase, result.registrationId, paid?.paymentId ?? null)
            }
          }
          break
        }
        case 'checkout.order.failed': {
          if (!merchantOrderId) {
            status = 'ignored'
            break
          }
          const remote = await fetchPhonePeOrder(merchantOrderId)
          await markPaymentFailed(supabase, {
            orderId: merchantOrderId,
            reason: remote ? phonepeFailureReason(remote) : 'Payment failed at the gateway',
          })
          status = 'processed'
          break
        }
        case 'pg.refund.completed': {
          if (!merchantOrderId) {
            status = 'ignored'
            break
          }
          await markPaymentRefunded(supabase, { orderId: merchantOrderId })
          status = 'processed'
          break
        }
        case 'pg.refund.failed': {
          // Nothing to change: the payment is still captured.
          status = 'ignored'
          break
        }
        default:
          status = 'ignored'
      }
    } catch (processingError) {
      console.error('webhook processing failed', processingError)
      status = 'failed'
      errorText = processingError instanceof Error ? processingError.message : 'unknown error'
    }

    await supabase
      .from('payment_events')
      .update({
        processing_status: status,
        error: errorText,
        processed_at: new Date().toISOString(),
      })
      .eq('razorpay_event_id', eventId)

    // Returning 500 on failures lets PhonePe retry later. Because events are
    // recorded before processing, a retry with the same event id is ignored,
    // so a failed record is cleared before returning.
    if (status === 'failed') {
      await supabase.from('payment_events').delete().eq('razorpay_event_id', eventId)
      return json(req, { ok: false, status, error: errorText }, 500)
    }

    return json(req, { ok: true, status }, 200)
  }),
)

/**
 * PhonePe's SHA webhook auth: the dashboard is given a username and password,
 * and PhonePe sends `Authorization: SHA256 <sha256(username:password)>`.
 */
async function verifyWebhookAuth(header: string, username: string, password: string): Promise<boolean> {
  const provided = header.trim().replace(/^sha256\s+/i, '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(provided)) return false
  const expected = await sha256(`${username}:${password}`)
  return constantTimeEqual(provided, expected)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
