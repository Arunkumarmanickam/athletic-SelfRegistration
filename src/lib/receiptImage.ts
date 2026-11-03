// Renders the on-screen receipt to a JPEG in the browser.
//
// The receipt stays a normal React component, so the saved image is exactly
// what the athlete sees after paying. `html-to-image` serialises the node into
// an SVG `foreignObject`, which lets the browser lay it out and render it
// without re-implementing the invoice a second time.
import { toJpeg } from 'html-to-image'

/** File name used for every downloaded receipt, e.g. CDMAA-R000001.jpg. */
export function receiptFileName(registrationCode: string): string {
  return `CDMAA-${registrationCode}.jpg`
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  })
}

async function waitForImages(node: HTMLElement): Promise<void> {
  const images = Array.from(node.querySelectorAll('img'))
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve()
            return
          }
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => resolve(), { once: true })
        }),
    ),
  )
}

/**
 * The receipt must be laid out and its webfonts loaded before it is captured,
 * otherwise the image can be blank, clipped or use a fallback typeface.
 */
async function waitForReceipt(node: HTMLElement): Promise<void> {
  try {
    await document.fonts?.ready
  } catch {
    /* older browsers: carry on with the fonts that are already available */
  }
  await waitForImages(node)
  await nextFrame()
}

/**
 * Captures `node` and downloads it as `CDMAA-<registration code>.jpg`.
 *
 * The caller owns the node and should keep it laid out (offscreen is fine)
 * until this promise settles.
 */
export async function downloadReceiptJpeg(node: HTMLElement, registrationCode: string): Promise<void> {
  await waitForReceipt(node)

  const dataUrl = await toJpeg(node, {
    backgroundColor: '#ffffff',
    cacheBust: true,
    pixelRatio: 2,
    quality: 0.95,
  })

  const link = document.createElement('a')
  link.href = dataUrl
  link.download = receiptFileName(registrationCode)
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}
