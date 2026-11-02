// Handles one upload purpose:
//
//   * purpose=photo — an optional athlete photograph / supporting document,
//     stored in the private bucket and linked to the athlete profile. This
//     needs a real profile, so it requires an athlete session.
//
// Requires a valid bearer token (athlete session) and verifies the target
// belongs to that token.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit } from '../_shared/helpers.ts'
import { resolveAthleteSession } from '../_shared/athlete-session.ts'

const MAX_BYTES = 5 * 1024 * 1024
const DOC_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

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

    const file = form.get('file')
    if (!(file instanceof File)) {
      return errorJson(req, 'INVALID_REQUEST', 'Please choose a file to upload.', 400)
    }
    if (file.size > MAX_BYTES) {
      return errorJson(req, 'FILE_TOO_LARGE', 'The file must be 5 MB or smaller.', 400)
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
