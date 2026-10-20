import { useState } from 'react'
import { Alert, Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/format'
import { loadRazorpayCheckout, openRazorpayCheckout } from '@/lib/razorpay'
import { ApiError, retryPayment, verifyPayment } from '@/lib/api'
import type { Confirmation } from '@/lib/types'

export interface PaymentOrder {
  razorpay_order_id: string
  razorpay_key_id: string
  amount_paise: number
  currency: string
}

export interface PaymentPanelProps {
  championshipName: string
  organizerName?: string
  registrationCode: string
  mobileE164: string
  /** Server-calculated fee, used for display before/without an order. */
  amountPaise: number
  currency: string
  /** Present when a Razorpay order already exists; otherwise the athlete starts a new attempt. */
  order?: PaymentOrder
  prefill?: { name?: string; email?: string; contact?: string }
  onSuccess: (confirmation: Confirmation) => void
}

type Stage = 'idle' | 'opening' | 'verifying' | 'dismissed' | 'failed'

/**
 * Razorpay checkout launcher.
 *
 * Security model: the browser only ever receives the public key and a
 * server-created order. The registration is only considered paid after the
 * backend verifies the HMAC signature AND confirms the payment with Razorpay.
 * Nothing here ever marks a payment as successful on its own.
 */
export function PaymentPanel({
  championshipName,
  organizerName,
  registrationCode,
  mobileE164,
  amountPaise,
  currency,
  order,
  prefill,
  onSuccess,
}: PaymentPanelProps) {
  const [currentOrder, setCurrentOrder] = useState<PaymentOrder | null>(order ?? null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  // Name/email/phone from the registration. A retry refreshes them from the
  // server so the checkout is prefilled even after a page reload.
  const [prefillValues, setPrefillValues] = useState(prefill)
  const checkoutPrefill = prefillValues ?? prefill

  const displayAmount = currentOrder?.amount_paise ?? amountPaise
  const displayCurrency = currentOrder?.currency ?? currency
  const amountLabel = formatMoney(displayAmount, displayCurrency)

  const verify = async (response: {
    razorpay_payment_id: string
    razorpay_order_id: string
    razorpay_signature: string
  }) => {
    setStage('verifying')
    setError(null)
    try {
      const result = await verifyPayment({
        razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
      })
      onSuccess(result.confirmation)
    } catch (err) {
      setStage('failed')
      setError(
        err instanceof ApiError
          ? err.message
          : 'We could not confirm your payment. If money was deducted, please contact the organiser with the payment reference.',
      )
    }
  }

  const startCheckout = async (paymentOrder: PaymentOrder) => {
    setStage('opening')
    setError(null)
    const ready = await loadRazorpayCheckout()
    if (!ready) {
      setStage('failed')
      setError('The payment window could not be loaded. Please check your connection and try again.')
      return
    }
    const opened = openRazorpayCheckout({
      key: paymentOrder.razorpay_key_id,
      amount: paymentOrder.amount_paise,
      currency: paymentOrder.currency,
      name: organizerName?.trim() || championshipName,
      description: `Registration ${registrationCode}`,
      order_id: paymentOrder.razorpay_order_id,
      prefill: checkoutPrefill,
      notes: { registration_code: registrationCode },
      theme: { color: '#f97316' },
      // Net banking and bank UPI apps leave the page and come back by redirect.
      // Send them to a route the app controls so PaymentReturnGate can verify
      // the result from the URL; card and in-app UPI still use the handler.
      callback_url: `${window.location.origin}/status`,
      redirect: true,
      handler: (response) => {
        void verify(response)
      },
      modal: {
        ondismiss: () => {
          setStage((current) => (current === 'verifying' ? current : 'dismissed'))
        },
      },
    })
    if (!opened) {
      setStage('failed')
      setError('The payment window could not be opened. Please try again.')
    }
  }

  const handleRetry = async () => {
    setStage('opening')
    setError(null)
    try {
      const result = await retryPayment({ registrationCode, mobileE164 })
      if (result.prefill) setPrefillValues(result.prefill)
      if (!result.payment.configured) {
        setStage('failed')
        setError('Online payment is not available right now. Please contact the organiser.')
        return
      }
      const nextOrder: PaymentOrder = {
        razorpay_order_id: result.payment.razorpay_order_id,
        razorpay_key_id: result.payment.razorpay_key_id,
        amount_paise: result.payment.amount_paise,
        currency: result.payment.currency,
      }
      setCurrentOrder(nextOrder)
      await startCheckout(nextOrder)
    } catch (err) {
      setStage('failed')
      setError(err instanceof ApiError ? err.message : 'Could not start a new payment attempt. Please try again.')
    }
  }

  const busy = stage === 'opening' || stage === 'verifying'

  return (
    <div className="space-y-4">
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
          Your payment was not completed. You can start a new attempt — your registration and bib number are saved.
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
        Payments are processed securely by Razorpay. Your registration is only confirmed after the payment is verified
        on our server, so a browser success message alone is never enough. If an amount was deducted but the
        registration still shows unpaid, contact the organiser with your payment reference.
      </p>
    </div>
  )
}
