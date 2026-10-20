import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { recoverRedirectedPayment, stripPaymentParams } from '@/lib/paymentReturn'

/**
 * Recovers a net-banking / bank-app payment that returned as a browser redirect.
 *
 * Razorpay's redirect flows come back with the payment result in the URL. This
 * gate sits in front of the public routes: if it sees those parameters it
 * verifies the payment on the server, stores the confirmation and moves to the
 * receipt page. Every other navigation renders immediately, so this costs one
 * cheap `URLSearchParams` read on ordinary page loads.
 */
export function PaymentReturnGate({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(() => hasPaymentParams(window.location.search))

  useEffect(() => {
    if (!busy) return
    let cancelled = false
    void (async () => {
      const result = await recoverRedirectedPayment(window.location.search)
      if (cancelled) return
      // Drop the parameters so a refresh cannot replay the verification.
      navigate(
        { pathname: window.location.pathname, search: stripPaymentParams(window.location.search) },
        { replace: true },
      )
      setBusy(false)
      if (result.confirmed) {
        navigate('/registration/success', { replace: true })
      } else if (result.error) {
        navigate('/status', { replace: true, state: { paymentError: result.error } })
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

/** True when the URL carries a Razorpay redirect result. */
function hasPaymentParams(search: string): boolean {
  const params = new URLSearchParams(search)
  return Boolean(
    params.get('razorpay_payment_id') ||
      params.get('razorpay_order_id') ||
      // Razorpay documents the failure form as `error[code]` / `error[description]`,
      // but some flows send a plain `error` or `error_code`.
      params.get('error') ||
      params.get('error[code]') ||
      params.get('error_code'),
  )
}
