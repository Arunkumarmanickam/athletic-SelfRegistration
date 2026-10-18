import { useRef, useState } from 'react'
import { Alert } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { uploadDocument } from '@/lib/api'
import { ApiError } from '@/lib/api'

export interface DocumentUploadProps {
  athleteSessionToken: string
  registrationId?: string
  label?: string
  hint?: string
  onUploaded?: (path: string, signedUrl: string | null) => void
}

const MAX_BYTES = 5 * 1024 * 1024

/**
 * Uploads a photo or supporting document to the private bucket. Access requires
 * the short-lived athlete session issued after verification (or after a
 * registration), so it can never be used by an anonymous visitor.
 */
export function DocumentUpload({
  athleteSessionToken,
  registrationId,
  label = 'Photo or supporting document',
  hint = 'JPG, PNG, WEBP or PDF up to 5 MB.',
  onUploaded,
}: DocumentUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    setDone(null)

    if (file.size > MAX_BYTES) {
      setError('The file must be 5 MB or smaller.')
      event.target.value = ''
      return
    }

    setBusy(true)
    try {
      const result = await uploadDocument({ athleteSessionToken, registrationId, file })
      setDone(file.name)
      onUploaded?.(result.path, result.signed_url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The upload failed. Please try again.')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(event) => void handleChange(event)}
        />
        <Button
          type="button"
          variant="outline"
          loading={busy}
          onClick={() => inputRef.current?.click()}
        >
          {done ? 'Upload another file' : 'Choose file'}
        </Button>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">{label}</p>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
      </div>
      {done && (
        <Alert tone="success" className="text-xs">
          Uploaded <span className="font-medium">{done}</span>. It is stored privately and only visible to the organiser.
        </Alert>
      )}
      {error && (
        <Alert tone="danger" className="text-xs">
          {error}
        </Alert>
      )}
    </div>
  )
}
