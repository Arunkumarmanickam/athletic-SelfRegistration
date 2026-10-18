// Handles two upload purposes for a verified athlete session:
//
//   * purpose=aadhaar — the front of the Aadhaar card. It is validated and then
//     DISCARDED: the image is never written to storage and never stored in the
//     database. We only record the upload timestamp (registrations.aadhaar_verified_at)
//     so the payment step can require it.
//   * purpose=photo  — an optional athlete photograph / supporting document,
//     stored in the private bucket and linked to the athlete profile.
//
// Both require a verified athlete session token, and both verify that the
// target registration/profile belongs to that session.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit } from '../_shared/helpers.ts'
import { resolveAthleteSession } from '../_shared/athlete-session.ts'

const MAX_BYTES = 5 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const DOC_TYPES = [...IMAGE_TYPES, 'application/pdf']

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
    const registrationId = (form.get('registrationId') as string | null)?.trim() ?? ''
    const purpose = (form.get('purpose') as string | null)?.trim() || 'photo'

    const session = await resolveAthleteSession(token)
    if (!token || !session) {
      return errorJson(req, 'SESSION_EXPIRED', 'Your session has expired. Please verify again.', 401)
    }

    const file = form.get('file')
    if (!(file instanceof File)) {
      return errorJson(req, 'INVALID_REQUEST', 'Please choose a file to upload.', 400)
    }
    if (file.size > MAX_BYTES) {
      return errorJson(req, 'FILE_TOO_LARGE', 'The file must be 5 MB or smaller.', 400)
    }

    if (purpose === 'aadhaar') {
      // ---- Aadhaar front: validate, then discard ------------------------------
      if (!IMAGE_TYPES.includes(file.type)) {
        return errorJson(req, 'INVALID_FILE_TYPE', 'Please upload the Aadhaar card as a JPG, PNG or WEBP image.', 400)
      }
      if (!registrationId) {
        return errorJson(req, 'MISSING_FIELDS', 'The registration could not be identified.', 400)
      }

      const { data: registration } = await supabase
        .from('registrations')
        .select('id, athlete_profile_id')
        .eq('id', registrationId)
        .maybeSingle()
      if (!registration || (registration as { athlete_profile_id: string }).athlete_profile_id !== session.profile.id) {
        return errorJson(req, 'FORBIDDEN', 'This registration does not belong to your session.', 403)
      }

      await supabase
        .from('registrations')
        .update({ aadhaar_verified_at: new Date().toISOString() })
        .eq('id', registrationId)

      // The image is intentionally not stored anywhere.
      return json(req, { ok: true, stored: false, aadhaar_verified: true })
    }

    // ---- Optional photo / supporting document --------------------------------
    if (!DOC_TYPES.includes(file.type)) {
      return errorJson(req, 'INVALID_FILE_TYPE', 'Please upload a JPG, PNG, WEBP or PDF file.', 400)
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'upload'
    const path = `athletes/${session.profile.id}/${Date.now()}-${safeName}`

    const bytes = new Uint8Array(await file.arrayBuffer())
    const { error: uploadError } = await supabase.storage
      .from('athlete-documents')
      .upload(path, bytes, { contentType: file.type, upsert: false })
    if (uploadError) {
      console.error('storage upload failed', uploadError)
      return errorJson(req, 'SERVER_ERROR', 'We could not store the file. Please try again.', 500)
    }

    await supabase
      .from('athlete_profiles')
      .update({ photo_path: path })
      .eq('id', session.profile.id)

    return json(req, { ok: true, stored: true, path })
  }),
)
