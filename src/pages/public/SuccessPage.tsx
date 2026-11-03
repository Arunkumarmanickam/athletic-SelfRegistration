import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { useConfig } from '@/context/ConfigContext'
import { ReceiptInvoice } from '@/components/registration/ReceiptInvoice'
import { ReceiptDownloadButton } from '@/components/registration/ReceiptDownload'
import { loadConfirmation } from '@/lib/receipt'

/**
 * Invoice-style receipt shown after a payment is verified on the server.
 *
 * It reads the confirmation that `verify-payment` returned and the browser
 * stashed in sessionStorage, so a refresh keeps the receipt but closing the tab
 * clears it. If the record is missing (for example the athlete opened this URL
 * directly) we send them to the status page instead of inventing data.
 *
 * The receipt is downloaded automatically as a JPEG once per registration
 * (tracked per tab), so the athlete keeps a copy on their phone without having
 * to find the print dialog. The same button stays on screen for a retry, and
 * the on-screen invoice remains printable as a fallback.
 */
export function SuccessPage() {
  const { config } = useConfig()
  const confirmation = useMemo(() => loadConfirmation(), [])

  if (!confirmation) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <Card className="print-plain">
          <CardHeader>
            <CardTitle>Receipt not available in this tab</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              For your privacy, a receipt is only kept for the current browser tab. If you have just paid, you can look
              up your registration again with your Registration ID or your bib number, plus the registered mobile
              number.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/status">
                <Button variant="accent">Look up my registration</Button>
              </Link>
              <Link to="/returning">
                <Button variant="outline">Retrieve my athlete details</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 print:max-w-none print:px-0 print:py-0">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 print-hide">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-600">Payment received</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-brand-900 sm:text-3xl">Your receipt</h1>
        </div>
        <ReceiptDownloadButton
          confirmation={confirmation}
          site={config?.site}
          auto
          ready={Boolean(config)}
          align="end"
        />
      </div>

      <ReceiptInvoice confirmation={confirmation} site={config?.site} />

      <div className="mt-5 flex flex-wrap gap-3 print-hide">
        <Link to="/register">
          <Button variant="accent">Register for another championship</Button>
        </Link>
        <Link to="/">
          <Button variant="outline">Back to home</Button>
        </Link>
      </div>
    </div>
  )
}
