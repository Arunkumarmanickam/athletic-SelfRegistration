import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/format'
import { isPhonePeCheckoutUrl, startPhonePeCheckout } from '@/lib/phonepe'
import { qrDataUrl } from '@/lib/qr'
import { ApiError, retryPayment } from '@/lib/api'
import type { Confirmation } from '@/lib/types'

export interface PaymentOrder {
  /**
   * PhonePe merchant order id (the database column is still named
   * `razorpay_order_id`).
   */
  razorpay_order_id: string
  /** PhonePe hosted-checkout URL, created server-side. */
  redirect_url?: string
  amount_paise: number
  currency: string
  application_number?: string | null
}

export interface PaymentPanelProps {
  championshipName: string
  organizerName?: string
  /** Draft bearer token: the only credential that exists before payment. */
  draftToken: string | null
  mobileE164: string
  /** Shown under the pay button so a returning athlete can check status. */
  applicationNumber?: string | null
  /** Server-calculated fee, used for display before/without an order. */
  amountPaise: number
  currency: string
  /** Present when a payment order already exists; otherwise the athlete starts a new attempt. */
  order?: PaymentOrder
  prefill?: { name?: string; email?: string; contact?: string }
  onSuccess: (confirmation: Confirmation) => void
}

type Stage = 'idle' | 'opening' | 'failed' | 'qr'

const DESKTOP_QUERY = '(min-width: 900px) and (pointer: fine)'

/**
 * True for a desktop-sized screen with a precise pointer. PhonePe itself
 * switches to its mobile layout below 900px, so this mirrors the same boundary:
 * anything that would receive PhonePe's mobile flow is redirected normally.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY)
    const update = () => setIsDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return isDesktop
}

/**
 * PhonePe Standard Checkout launcher.
 *
 * Security model: the server creates the order and hands back a hosted-checkout
 * URL. The browser is only redirected there; it never decides the amount and
 * never marks a payment as successful. PhonePe returns the athlete to
 * `payment-callback`, which verifies the order with PhonePe, promotes the draft
 * and redirects to the receipt.
 */
export function PaymentPanel({
  draftToken,
  amountPaise,
  currency,
  order,
  applicationNumber,
}: PaymentPanelProps) {
  const [currentOrder, setCurrentOrder] = useState<PaymentOrder | null>((order as any) ?? null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [qrTarget, setQrTarget] = useState<string | null>(null)
  const isDesktop = useIsDesktop()

  const displayAmount = currentOrder?.amount_paise ?? amountPaise
  const displayCurrency = currentOrder?.currency ?? currency
  const amountLabel = formatMoney(displayAmount, displayCurrency)
  const qrImage = useMemo(() => (qrTarget ? qrDataUrl(qrTarget) : null), [qrTarget])

  const startCheckout = (paymentOrder: PaymentOrder) => {
    setError(null)

    if (!paymentOrder.redirect_url) {
      setStage('failed')
      setError('The payment link is missing. Please try again.')
      return
    }
    if (!isPhonePeCheckoutUrl(paymentOrder.redirect_url)) {
      setStage('failed')
      setError('The payment link could not be verified. Please try again or contact the organiser.')
      return
    }

    // Desktop: PhonePe's own QR screen can overflow and cannot be zoomed out,
    // so keep the athlete here and show a QR of the same hosted checkout link.
    // Scanning it opens the normal mobile UPI flow on the phone.
    if (isDesktop) {
      setQrTarget(paymentOrder.redirect_url)
      setStage('qr')
      return
    }

    // The browser leaves for PhonePe and comes back through the
    // payment-callback Edge Function. There is no in-page success callback to
    // trust, so nothing here can confirm a payment.
    setStage('opening')
    const opened = startPhonePeCheckout(paymentOrder.redirect_url)
    if (!opened.ok) {
      setStage('failed')
      setError(opened.error ?? 'The payment page could not be opened. Please try again.')
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
      const nextOrder: PaymentOrder = {
        razorpay_order_id: result.payment.razorpay_order_id,
        redirect_url: result.payment.redirect_url,
        amount_paise: result.payment.amount_paise,
        currency: result.payment.currency,
        application_number:
          (result as any).application_number || (result.draft as any)?.application_number || null,
      }
      try {
        if (nextOrder.application_number) {
          localStorage.setItem('cdmaa:lastApp', nextOrder.application_number)
        }
      } catch {}
      setCurrentOrder(nextOrder)
      startCheckout(nextOrder)
    } catch (err) {
      setStage('failed')
      setError(err instanceof ApiError ? err.message : 'Could not start a new payment attempt. Please try again.')
    }
  }

  const busy = stage === 'opening'

  const appNo = currentOrder?.application_number ?? order?.application_number ?? applicationNumber

  return (
    <div className="space-y-4">
      {/* Pay block first: on a phone this is the only thing the athlete needs
          to see, so it sits at the top of the page rather than below the
          summary. The button is full width on small screens. */}
      <div className="rounded-xl border border-accent-200 bg-accent-50 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-accent-700">Amount payable</p>
            <p className="text-2xl font-bold text-slate-900">{amountLabel}</p>
          </div>
          <Badge tone="warning">Awaiting payment</Badge>
        </div>

        {stage === 'qr' && qrImage && qrTarget ? (
          <div className="mt-4">
            <div className="rounded-lg border border-accent-200 bg-white p-4 text-center">
              <p className="text-sm font-semibold text-slate-900">Scan this code with your phone</p>
              <img
                src={qrImage}
                alt={`UPI payment QR code for ${amountLabel}`}
                className="mx-auto mt-3 w-full max-w-[320px]"
              />
              <p className="mt-3 text-sm text-slate-700">
                Open any UPI app (PhonePe, Google Pay, Paytm), scan this code and approve {amountLabel}.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Keep this page open. Your entry is confirmed automatically once the payment succeeds.
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <a
                href={qrTarget}
                className="font-medium text-accent-700 underline underline-offset-2"
              >
                Continue on this computer instead
              </a>
              <button
                type="button"
                onClick={() => void handleRetry()}
                disabled={busy}
                className="font-medium text-slate-600 underline underline-offset-2 disabled:opacity-50"
              >
                Generate a new QR code
              </button>
              <Link to="/status" className="font-medium text-slate-600 underline underline-offset-2">
                Already paid? Check status
              </Link>
            </div>
          </div>
        ) : (
          <>
            <Button
              variant="accent"
              size="lg"
              className="mt-4 w-full sm:w-auto"
              onClick={() => (currentOrder ? startCheckout(currentOrder) : void handleRetry())}
              loading={busy}
              disabled={busy}
            >
              {stage === 'failed' ? 'Start a new payment attempt' : `Pay ${amountLabel} securely`}
            </Button>

            <p className="mt-2 text-xs text-accent-800">
              Pay with any UPI app. On a computer, click Pay to show a QR code you can scan with your
              phone.
            </p>
          </>
        )}
      </div>

      {error && (
        <Alert tone="danger" title="Payment not completed">
          {error}
        </Alert>
      )}

      {appNo && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-blue-700">Application Number</p>
          <p className="mt-1 font-mono text-lg font-bold text-blue-900">{appNo}</p>
          <p className="mt-1 text-xs text-blue-700">
            Save this number to check your payment status if you return later.
          </p>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Payments are processed securely by PhonePe. Your registration is only confirmed after the payment is verified on
        our server, so a browser success message alone is never enough. If an amount was deducted but the registration
        still shows unpaid, contact the organiser with your payment reference.
      </p>
    </div>
  )
}
