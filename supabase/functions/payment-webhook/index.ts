// Razorpay webhook receiver.
//
// Requirements implemented here:
//   * The raw request body signature is verified with the webhook secret;
//     unverified calls are rejected.
//   * Every event id is stored once (unique constraint), so duplicate and
//     out-of-order deliveries are processed idempotently.
//   * Payment state only ever moves forward (capture never regresses).
import { handler } from '../_shared/handler.ts'
import { json } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { verifyWebhookSignature } from '../_shared/razorpay.ts'
import { markPaymentCaptured, markPaymentFailed, markPaymentRefunded, notifyConfirmedRegistration } from '../_shared/payments.ts'

Deno.serve(
  handler(async (req) => {
    if (req.method !== 'POST') return json(req, { ok: false, error: 'Method not allowed' }, 405)

    const rawBody = await req.text()
    const signature = req.headers.get('x-razorpay-signature') ?? ''
    const eventIdHeader = req.headers.get('x-razorpay-event-id') ?? ''

    const signatureValid = await verifyWebhookSignature(rawBody, signature)
    if (!signatureValid) {
      console.error('webhook signature verification failed')
      return json(req, { ok: false, error: 'Invalid signature' }, 401)
    }

    let event: Record<string, unknown>
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return json(req, { ok: false, error: 'Invalid payload' }, 400)
    }

    const eventType = String(event.event ?? 'unknown')
    const eventId = eventIdHeader || `hash-${(await sha256(rawBody)).slice(0, 32)}`
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

    const payload = (event.payload ?? {}) as Record<string, unknown>
    const paymentEntity = ((payload.payment ?? {}) as Record<string, unknown>).entity as
      | Record<string, unknown>
      | undefined
    const refundEntity = ((payload.refund ?? {}) as Record<string, unknown>).entity as
      | Record<string, unknown>
      | undefined

    let status: 'processed' | 'ignored' | 'failed' = 'ignored'
    let errorText: string | null = null

    try {
      switch (eventType) {
        case 'payment.captured':
        case 'order.paid': {
          const orderId = String(paymentEntity?.order_id ?? '')
          const paymentId = String(paymentEntity?.id ?? '')
          if (!orderId) {
            status = 'ignored'
            break
          }
          const result = await markPaymentCaptured(supabase, {
            orderId,
            paymentId: paymentId || null,
            method: paymentEntity?.method ? String(paymentEntity.method) : null,
          })
          if (!result.ok) {
            status = 'failed'
            errorText = result.error ?? 'capture failed'
          } else {
            status = 'processed'
            if (!result.alreadyCaptured && result.registrationId) {
              await notifyConfirmedRegistration(supabase, result.registrationId, paymentId || null)
            }
          }
          break
        }
        case 'payment.failed': {
          const orderId = String(paymentEntity?.order_id ?? '')
          if (!orderId) {
            status = 'ignored'
            break
          }
          await markPaymentFailed(supabase, {
            orderId,
            reason: paymentEntity?.error_description
              ? String(paymentEntity.error_description)
              : paymentEntity?.error_code
                ? String(paymentEntity.error_code)
                : 'Payment failed at gateway',
          })
          status = 'processed'
          break
        }
        case 'payment.refunded':
        case 'refund.processed': {
          const orderId = paymentEntity?.order_id ? String(paymentEntity.order_id) : null
          const paymentId = refundEntity?.payment_id
            ? String(refundEntity.payment_id)
            : paymentEntity?.id
              ? String(paymentEntity.id)
              : null
          if (!orderId && !paymentId) {
            status = 'ignored'
            break
          }
          await markPaymentRefunded(supabase, { orderId, paymentId })
          status = 'processed'
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

    // Returning 500 on failures lets Razorpay retry later. Because events are
    // recorded before processing, a retry with the same event id is ignored...
    // unless processing failed, in which case we clear the record so the retry
    // is processed again.
    if (status === 'failed') {
      await supabase.from('payment_events').delete().eq('razorpay_event_id', eventId)
      return json(req, { ok: false, status, error: errorText }, 500)
    }

    return json(req, { ok: true, status }, 200)
  }),
)

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
