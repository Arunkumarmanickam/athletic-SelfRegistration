// Admin API for athlete profiles: search, profile detail with linked
// registrations, and guarded profile edits with an audit trail.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { requireAdmin, writeAudit } from '../_shared/admin-auth.ts'
import { isDateOnly, isEmail, isE164, str } from '../_shared/helpers.ts'
import { normalizeMobile } from '../_shared/athlete-lookup.ts'

const PROFILE_COLUMNS =
  'id, athlete_id, full_name, date_of_birth, gender, mobile_country_code, mobile_number, mobile_e164, email, state, district, address, representing, emergency_contact_name, emergency_contact_phone, photo_path, created_at, updated_at'

Deno.serve(
  handler(async (req) => {
    const context = await requireAdmin(req)
    if (context instanceof Response) return context
    const { supabase, admin } = context

    const body = await req.json().catch(() => ({}) as Record<string, unknown>)
    const action = str(body.action) || 'list'

    // ---- list ---------------------------------------------------------------
    if (action === 'list') {
      const search = str(body.search).slice(0, 80)
      const state = str(body.state)
      const gender = str(body.gender)
      const page = Math.max(1, Number(body.page) || 1)
      const pageSize = Math.min(200, Math.max(1, Number(body.pageSize) || 25))

      let query = supabase.from('athlete_profiles').select(PROFILE_COLUMNS, { count: 'exact' })
      if (search) {
        const like = `%${search.replace(/[%,()*]/g, '')}%`
        query = query.or(
          `full_name.ilike.${like},athlete_id.ilike.${like},mobile_e164.ilike.${like}`,
        )
      }
      if (state) query = query.eq('state', state)
      if (gender) query = query.eq('gender', gender)
      query = query
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range((page - 1) * pageSize, (page - 1) * pageSize + pageSize - 1)

      const { data, count, error } = await query
      if (error) {
        console.error('athletes list failed', error)
        return errorJson(req, 'SERVER_ERROR', 'Could not load athletes.', 500)
      }

      // Registration counts for the visible page (single extra query).
      const ids = (data ?? []).map((p: { id: string }) => p.id)
      const counts = new Map<string, number>()
      if (ids.length) {
        const { data: regs } = await supabase
          .from('registrations')
          .select('athlete_profile_id, payment_status')
          .in('athlete_profile_id', ids)
        for (const reg of (regs ?? []) as { athlete_profile_id: string }[]) {
          counts.set(reg.athlete_profile_id, (counts.get(reg.athlete_profile_id) ?? 0) + 1)
        }
      }

      const rows = (data ?? []).map((p: { id: string }) => ({
        ...p,
        registration_count: counts.get(p.id) ?? 0,
      }))

      return json(req, { rows, total: count ?? 0, page, pageSize })
    }

    // ---- detail ---------------------------------------------------------------
    if (action === 'detail') {
      const athleteId = str(body.athleteId)
      if (!athleteId) return errorJson(req, 'MISSING_FIELDS', 'Athlete id is required.', 400)

      const { data: profile } = await supabase
        .from('athlete_profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', athleteId)
        .maybeSingle()
      if (!profile) return errorJson(req, 'NOT_FOUND', 'Athlete not found.', 404)

      const { data: registrations } = await supabase
        .from('registrations')
        .select(
          `id, registration_code, status, payment_status, fee_paise, currency, registered_at, confirmed_at,
           championships (id, name, slug, starts_on, location),
           championship_categories (name),
           registration_events (event_name),
           payments (id, razorpay_order_id, razorpay_payment_id, amount_paise, status, created_at, verified_at)`,
        )
        .eq('athlete_profile_id', athleteId)
        .order('registered_at', { ascending: false })

      return json(req, { profile, registrations: registrations ?? [] })
    }

    // ---- update ---------------------------------------------------------------
    if (action === 'update') {
      if (admin.role === 'viewer') {
        return errorJson(req, 'FORBIDDEN', 'Viewer accounts cannot edit athlete profiles.', 403)
      }

      const athleteId = str(body.athleteId)
      const reason = str(body.reason)
      const fields = (body.fields ?? {}) as Record<string, unknown>
      if (!athleteId) return errorJson(req, 'MISSING_FIELDS', 'Athlete id is required.', 400)

      const { data: profile } = await supabase
        .from('athlete_profiles')
        .select('id, athlete_id, full_name')
        .eq('id', athleteId)
        .maybeSingle()
      if (!profile) return errorJson(req, 'NOT_FOUND', 'Athlete not found.', 404)

      const updates: Record<string, unknown> = {}
      const changes: Record<string, unknown> = {}

      const editable = [
        'full_name',
        'date_of_birth',
        'gender',
        'mobile_country_code',
        'mobile_number',
        'mobile_e164',
        'email',
        'state',
        'district',
        'address',
        'representing',
        'emergency_contact_name',
        'emergency_contact_phone',
      ] as const

      for (const key of editable) {
        if (!(key in fields)) continue
        const value = str(fields[key])
        updates[key] = value || (key === 'mobile_e164' ? '' : null)
        changes[key] = value
      }

      if (updates.email && !isEmail(String(updates.email))) {
        return errorJson(req, 'INVALID_EMAIL', 'Please enter a valid email address.', 400)
      }
      if (updates.date_of_birth && !isDateOnly(String(updates.date_of_birth))) {
        return errorJson(req, 'INVALID_DOB', 'Please enter a valid date of birth.', 400)
      }
      if (updates.gender && !['male', 'female', 'other'].includes(String(updates.gender))) {
        return errorJson(req, 'INVALID_GENDER', 'Please select a valid gender.', 400)
      }
      if (updates.mobile_e164) {
        updates.mobile_e164 = normalizeMobile(String(updates.mobile_e164))
        if (!isE164(String(updates.mobile_e164))) {
          return errorJson(req, 'INVALID_MOBILE', 'Please enter a valid mobile number.', 400)
        }
      }
      if (updates.full_name && String(updates.full_name).length < 2) {
        return errorJson(req, 'INVALID_NAME', 'Please enter a valid full name.', 400)
      }

      if (Object.keys(updates).length === 0) {
        return errorJson(req, 'NO_CHANGES', 'Nothing to update.', 400)
      }
      if (!reason) return errorJson(req, 'REASON_REQUIRED', 'Please provide a reason for this change.', 400)

      const { error: updateError } = await supabase
        .from('athlete_profiles')
        .update(updates)
        .eq('id', athleteId)
      if (updateError) {
        console.error('profile update failed', updateError)
        return errorJson(req, 'SERVER_ERROR', 'Could not update the athlete profile.', 500)
      }

      await writeAudit(supabase, admin, 'athlete.update', 'athlete_profile', athleteId, {
        athlete_id: profile.athlete_id,
        full_name: profile.full_name,
        changes,
        reason,
      })

      const { data: refreshed } = await supabase
        .from('athlete_profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', athleteId)
        .maybeSingle()

      return json(req, { ok: true, profile: refreshed })
    }

    return errorJson(req, 'UNKNOWN_ACTION', 'Unknown action.', 400)
  }),
)
