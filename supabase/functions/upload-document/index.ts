// Uploads an athlete photograph / supporting document to a private bucket.
// Access requires a verified athlete session token; files are validated for
// type and size before being stored.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, sessionToken } from '../_shared/helpers.ts'
import { resolveAthleteSession } from '../_shared/athlete-session.ts'

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
}

Deno.serve(
  handler(async (req) => {
    const supabase = serviceClient()
    await enforceRateLimit(supabase, `upload:${clientIp(req)}`, 20, 3600)

    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return errorJson(req, 'INVALID_REQUEST', 'Please upload the file using a multipart form.', 400)
    }

    const token =
      (form.get('athleteSessionToken') as string | null)?.trim() ||
      req.headers.get('x-athlete-session')?.trim() ||
      ''
    const registrationId = ((form.get('registrationId') as string | null) ?? '').trim()

    if (!token) {
      return errorJson(req, 'UNAUTHORIZED', 'Please verify your identity before uploading documents.', 401)
    }

    const context = await resolveAthleteSession(token)
    if (!context) {
      return errorJson(req, 'SESSION_EXPIRED', 'Your verification session has expired. Please verify again.', 401)
    }

    const file = form.get('file')
    if (!(file instanceof File)) {
      return errorJson(req, 'NO_FILE', 'Please choose a file to upload.', 400)
    }
    if (file.size === 0) return errorJson(req, 'EMPTY_FILE', 'The selected file is empty.', 400)
    if (file.size > MAX_BYTES) {
      return errorJson(req, 'FILE_TOO_LARGE', 'The file must be 5 MB or smaller.', 400)
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return errorJson(req, 'FILE_TYPE_NOT_ALLOWED', 'Please upload a JPG, PNG, WEBP or PDF file.', 400)
    }

    const path = [
      context.profile.id,
      registrationId ? safeSegment(registrationId) : 'general',
      `${crypto.randomUUID()}-${safeSegment(file.name || 'document')}`,
    ].join('/')

    const bytes = new Uint8Array(await file.arrayBuffer())
    const { error: uploadError } = await supabase.storage
      .from('athlete-documents')
      .upload(path, bytes, { contentType: file.type, upsert: false })

    if (uploadError) {
      console.error('storage upload failed', uploadError)
      return errorJson(req, 'UPLOAD_FAILED', 'The upload failed. Please try again.', 500)
    }

    if (file.type.startsWith('image/')) {
      await supabase.from('athlete_profiles').update({ photo_path: path }).eq('id', context.profile.id)
    }

    // Short-lived signed URL so the athlete can preview their upload.
    const { data: signed } = await supabase.storage
      .from('athlete-documents')
      .createSignedUrl(path, 600)

    return json(req, { ok: true, path, signed_url: signed?.signedUrl ?? null })
  }),
)
