import { useState } from 'react'
import { Alert, Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/format'
import { loadCashfreeCheckout, openCashfreeCheckout, type CashfreeMode } from '@/lib/cashfree'
import { ApiError, retryPayment } from '@/lib/api'
import type { Confirmation } from '@/lib/types'

export interface PaymentOrder {
  /**
   * Cashfree order id (the database column is still named `razorpay_order_id`).
   */
  razorpay_order_id: string
  /** Cashfree `payment_session_id` (column/field name kept for compatibility). */
  razorpay_key_id: string
  /** Which Cashfree environment the session id belongs to. */
  cashfree_mode?: CashfreeMode
  amount_paise: number
  currency: string
}

export interface PaymentPanelProps {
  championshipName: string
  organizerName?: string
  /** Draft bearer token: the only credential that exists before payment. */
  draftToken: string | null
  mobileE164: string
  /** Server-calculated fee, used for display before/without an order. */
  amountPaise: number
  currency: string
  /** Present when a payment order already exists; otherwise the athlete starts a new attempt. */
  order?: PaymentOrder
  prefill?: { name?: string; email?: string; contact?: string }
  onSuccess: (confirmation: Confirmation) => void
}

type Stage = 'idle' | 'opening' | 'verifying' | 'dismissed' | 'failed'

/**
 * Cashfree checkout launcher.
 *
 * Security model: the browser only ever receives a server-created order and its
 * `payment_session_id`. Cashfree redirects the athlete back to
 * `payment-callback`, which verifies the order with Cashfree, promotes the
 * draft and redirects to the receipt. Nothing here ever marks a payment as
 * successful on its own.
 */
export function PaymentPanel({ draftToken, amountPaise, currency, order }: PaymentPanelProps) {
  const [currentOrder, setCurrentOrder] = useState<PaymentOrder | null>((order as any) ?? null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)

  const displayAmount = currentOrder?.amount_paise ?? amountPaise
  const displayCurrency = currentOrder?.currency ?? currency
  const amountLabel = formatMoney(displayAmount, displayCurrency)

  const startCheckout = async (paymentOrder: PaymentOrder) => {
    setStage('opening')
    setError(null)
    const ready = await loadCashfreeCheckout()
    if (!ready) {
      setStage('failed')
      setError('The payment window could not be loaded. Please check your connection and try again.')
      return
    }

    // With redirectTarget '_self' the browser leaves for Cashfree and comes
    // back through the payment-callback Edge Function, which verifies the order
    // server-side and forwards to the receipt. Card, UPI and net banking all use
    // the same return path, so there is no in-page success callback to trust.
    const opened = await openCashfreeCheckout({
      paymentSessionId: paymentOrder.razorpay_key_id,
      mode: paymentOrder.cashfree_mode ?? 'sandbox',
    })
    if (!opened.ok) {
      setStage('failed')
      setError(opened.error ?? 'The payment window could not be opened. Please try again.')
    }
  }

  const handleRetry = async () => {
    setStage('opening')
    setError(null)
    if (!draftToken) {
      setStage('failed')
      setError('Your session has expired. Please fill in your details again.')
      return
    }
    try {
      const result = await retryPayment({ draftToken })
      if (!result.payment.configured) {
        setStage('failed')
        setError('Online payment is not available right now. Please contact the organiser.')
        return
      }
      const nextOrder: any = {
        razorpay_order_id: result.payment.razorpay_order_id,
        razorpay_key_id: result.payment.razorpay_key_id,
        cashfree_mode: (result.payment as any).cashfree_mode,
        amount_paise: result.payment.amount_paise,
        currency: result.payment.currency,
        application_number: (result as any).application_number || (result.draft as any)?.application_number,
      }
      try {
        if (nextOrder.application_number) {
          localStorage.setItem('cdmaa:lastApp', nextOrder.application_number)
        }
      } catch {}
      setCurrentOrder(nextOrder)
      await startCheckout(nextOrder)
    } catch (err) {
      setStage('failed')
      setError(err instanceof ApiError ? err.message : 'Could not start a new payment attempt. Please try again.')
    }
  }

  const busy = stage === 'opening' || stage === 'verifying'

  const appNo = (order as any)?.application_number || (currentOrder as any)?.application_number

  return (
    <div className="space-y-4">
      {(appNo) && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-blue-700">Application Number</p>
          <p className="mt-1 font-mono text-lg font-bold text-blue-900">{appNo}</p>
          <p className="mt-1 text-xs text-blue-700">Save this number to check your payment status if you return later.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-sm text-slate-600">Amount payable</p>
          <p className="text-xl font-bold text-slate-900">{amountLabel}</p>
        </div>
        <Badge tone="warning">Awaiting payment</Badge>
      </div>

      {error && (
        <Alert tone="danger" title="Payment not completed">
          {error}
        </Alert>
      )}

      {stage === 'dismissed' && !error && (
        <Alert tone="warning" title="Payment window closed">
          Your payment was not completed, so your entry is not registered. You can try again whenever you are ready —
          nothing has been issued yet.
        </Alert>
      )}

      {stage === 'verifying' && (
        <Alert tone="info">Confirming your payment with the gateway. Please wait and do not close this page…</Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {currentOrder ? (
          <Button variant="accent" onClick={() => void startCheckout(currentOrder)} loading={busy} disabled={busy}>
            {stage === 'dismissed' || stage === 'failed' ? 'Start a new payment attempt' : `Pay ${amountLabel} securely`}
          </Button>
        ) : (
          <Button variant="accent" onClick={() => void handleRetry()} loading={busy} disabled={busy}>
            Pay {amountLabel} securely
          </Button>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Payments are processed securely. Your registration is only confirmed after the payment is verified on our
        server, so a browser success message alone is never enough. If an amount was deducted but the registration still
        shows unpaid, contact the organiser with your payment reference.
      </p>
    </div>
  )
}
