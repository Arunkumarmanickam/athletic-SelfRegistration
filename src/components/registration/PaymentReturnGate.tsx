import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { recoverRedirectedPayment, stripPaymentParams } from '@/lib/paymentReturn'

/**
 * Resolves a net-banking / bank-app payment that returned as a browser redirect.
 *
 * Razorpay's callback Edge Function has already verified the payment by the time
 * the browser lands here; this gate exchanges the single-use token for the
 * receipt, stores it and moves to the receipt page. Ordinary navigations render
 * immediately, so the cost is one `URLSearchParams` read per page load.
 */
export function PaymentReturnGate({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(() => hasReturnParams(window.location.search))

  useEffect(() => {
    if (!busy) return
    let cancelled = false
    void (async () => {
      const result = await recoverRedirectedPayment(window.location.search)
      if (cancelled) return
      // Drop the parameters so a refresh cannot replay the exchange.
      navigate(
        { pathname: window.location.pathname, search: stripPaymentParams(window.location.search) },
        { replace: true },
      )
      setBusy(false)
      if (result.confirmed) {
        navigate('/registration/success', { replace: true })
      } else if (result.error) {
        navigate('/status', { replace: true, state: { paymentError: result.error } })
      } else if (result.needsLookup) {
        navigate('/status', {
          replace: true,
          state: {
            paymentError:
              'Your payment was received, but the receipt could not be shown automatically. Look up your registration to view it.',
          },
        })
      }
    })()
    return () => {
      cancelled = true
    }
    // Run once per landing URL, not on every route change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy])

  if (busy) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-20 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-orange-600" />
        <h1 className="mt-5 text-lg font-semibold text-slate-900">Confirming your payment…</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your bank has returned you to us. Please wait a moment — do not close this page.
        </p>
      </div>
    )
  }

  return <>{children}</>
}

/** True when the URL carries a redirect-payment result. */
function hasReturnParams(search: string): boolean {
  const params = new URLSearchParams(search)
  return Boolean(params.get('receipt') || params.get('payment_callback'))
}
