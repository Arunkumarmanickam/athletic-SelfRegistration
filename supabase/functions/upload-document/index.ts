// Handles two upload purposes:
//
//   * purpose=aadhaar — the front of the Aadhaar card, uploaded against a
//     pre-payment DRAFT. It is validated and then DISCARDED: the image is never
//     written to storage and never stored in the database. We only record the
//     upload timestamp on the draft, so the payment step can require it, and it
//     is carried onto the registration when the draft is promoted.
//   * purpose=photo  — an optional athlete photograph / supporting document,
//     stored in the private bucket and linked to the athlete profile. This
//     needs a real profile, so it requires an athlete session.
//
// Both require a valid bearer token (draft token for Aadhaar, athlete session
// for a photo) and both verify the target belongs to that token.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit } from '../_shared/helpers.ts'
import { resolveAthleteSession } from '../_shared/athlete-session.ts'
import { resolveDraft } from '../_shared/draft.ts'

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
      (form.get('draftToken') as string | null)?.trim() ||
      req.headers.get('x-athlete-session')?.trim() ||
      req.headers.get('x-draft-token')?.trim() ||
      ''
    const registrationId = (form.get('registrationId') as string | null)?.trim() ?? ''
    const draftId = (form.get('draftId') as string | null)?.trim() ?? ''
    const purpose = (form.get('purpose') as string | null)?.trim() || 'photo'

    const file = form.get('file')
    if (!(file instanceof File)) {
      return errorJson(req, 'INVALID_REQUEST', 'Please choose a file to upload.', 400)
    }
    if (file.size > MAX_BYTES) {
      return errorJson(req, 'FILE_TOO_LARGE', 'The file must be 5 MB or smaller.', 400)
    }

    if (purpose === 'aadhaar') {
      // ---- Aadhaar front: validate, then discard ------------------------------
      // Uploaded against the pre-payment draft, because no profile exists yet.
      if (!IMAGE_TYPES.includes(file.type)) {
        return errorJson(req, 'INVALID_FILE_TYPE', 'Please upload the Aadhaar card as a JPG, PNG or WEBP image.', 400)
      }
      if (!token) {
        return errorJson(req, 'SESSION_EXPIRED', 'Your session has expired. Please verify again.', 401)
      }

      const draft = await resolveDraft(token)
      if (!draft) {
        return errorJson(req, 'SESSION_EXPIRED', 'Your session has expired. Please verify again.', 401)
      }
      if (draftId && draft.id !== draftId) {
        return errorJson(req, 'FORBIDDEN', 'This upload does not belong to your registration.', 403)
      }

      await supabase
        .from('registration_drafts')
        .update({ aadhaar_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', draft.id)

      // The image is intentionally not stored anywhere.
      return json(req, { ok: true, stored: false, aadhaar_verified: true })
    }

    // ---- Optional photo / supporting document --------------------------------
    // A photo attaches to the athlete profile, so it needs a real profile.
    const session = await resolveAthleteSession(token)
    if (!token || !session) {
      return errorJson(req, 'SESSION_EXPIRED', 'Your session has expired. Please verify again.', 401)
    }
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
