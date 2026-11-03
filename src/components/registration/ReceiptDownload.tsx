import { useCallback, useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { ReceiptInvoice } from '@/components/registration/ReceiptInvoice'
import { downloadReceiptJpeg } from '@/lib/receiptImage'
import type { Confirmation, PublicConfig } from '@/lib/types'

type DownloadMode = 'manual' | 'auto'

interface PendingDownload {
  confirmation: Confirmation
  mode: DownloadMode
  storageKey: string
}

export interface ReceiptDownloadButtonProps {
  confirmation: Confirmation
  site?: PublicConfig['site']
  /** Download once as soon as the component is ready (used after payment). */
  auto?: boolean
  /** False while the organiser details are still loading. */
  ready?: boolean
  /** Overrides the once-per-tab sessionStorage key for the automatic download. */
  storageKey?: string
  label?: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  className?: string
  align?: 'start' | 'end'
}

function autoStorageKey(confirmation: Confirmation): string {
  return `arp:receipt-downloaded:v1:${confirmation.registration.registration_code}`
}

/**
 * Downloads the payment receipt as a JPEG and, when `auto` is set, does so
 * once per registration per browser tab.
 *
 * The receipt used for the image is rendered offscreen at a fixed desktop
 * width so the saved file is consistent regardless of the device it was
 * requested from. If image generation fails the button stays available for a
 * retry; the automatic attempt is only marked as done after a successful
 * download.
 */
export function ReceiptDownloadButton({
  confirmation,
  site,
  auto = false,
  ready = true,
  storageKey,
  label = 'Download receipt',
  variant = 'outline',
  size,
  className,
  align = 'start',
}: ReceiptDownloadButtonProps) {
  const [pending, setPending] = useState<PendingDownload | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const captureRef = useRef<HTMLDivElement>(null)
  const autoStarted = useRef(false)

  const start = useCallback(
    (mode: DownloadMode) => {
      setError(null)
      setDownloading(true)
      setPending({
        confirmation,
        mode,
        storageKey: storageKey ?? autoStorageKey(confirmation),
      })
    },
    [confirmation, storageKey],
  )

  // Automatic download: wait for the organiser details, but never let a slow
  // config request hold the receipt hostage.
  useEffect(() => {
    if (!auto || autoStarted.current) return

    const key = storageKey ?? autoStorageKey(confirmation)
    try {
      if (window.sessionStorage.getItem(key)) {
        autoStarted.current = true
        return
      }
    } catch {
      /* storage unavailable: still attempt the download */
    }

    const trigger = () => {
      if (autoStarted.current) return
      autoStarted.current = true
      start('auto')
    }

    if (ready) {
      trigger()
      return
    }

    const timer = window.setTimeout(trigger, 2500)
    return () => window.clearTimeout(timer)
  }, [auto, confirmation, ready, start, storageKey])

  // The offscreen receipt has been mounted: capture it.
  useEffect(() => {
    if (!pending) return
    const node = captureRef.current
    if (!node) {
      setPending(null)
      setDownloading(false)
      setError('We could not prepare the receipt. Please try again.')
      return
    }

    let cancelled = false
    void (async () => {
      try {
        await downloadReceiptJpeg(node, pending.confirmation.registration.registration_code)
        if (pending.mode === 'auto') {
          try {
            window.sessionStorage.setItem(pending.storageKey, '1')
          } catch {
            /* storage unavailable: the download itself succeeded */
          }
        }
      } catch {
        if (!cancelled) {
          setError('We could not create the receipt image. Please try again, or contact the organiser.')
        }
      } finally {
        if (!cancelled) {
          setDownloading(false)
          setPending(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pending])

  return (
    <div className={`inline-flex flex-col gap-1 ${align === 'end' ? 'items-end' : 'items-start'}`}>
      <Button
        variant={variant}
        size={size}
        className={className}
        loading={downloading}
        onClick={() => start('manual')}
      >
        {!downloading && <Download aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />}
        {label}
      </Button>
      {error && (
        <p role="alert" className={`text-xs text-red-600 ${align === 'end' ? 'text-right' : 'text-left'}`}>
          {error}
        </p>
      )}

      {pending && (
        <div
          aria-hidden="true"
          inert
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 0,
            height: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <div ref={captureRef} className="w-[842px] bg-white p-6">
            <ReceiptInvoice confirmation={pending.confirmation} site={site} />
          </div>
        </div>
      )}
    </div>
  )
}
