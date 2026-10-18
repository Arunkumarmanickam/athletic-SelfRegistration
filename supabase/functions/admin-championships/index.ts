// Admin API for championships, their categories, events, numbering rules and
// the registration form configuration. Nothing about a championship is
// hard-coded in the application: the organiser configures it here.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { requireAdmin, writeAudit } from '../_shared/admin-auth.ts'
import { isDateOnly, str } from '../_shared/helpers.ts'

const STATUSES = ['draft', 'open', 'closed', 'archived']
const GENDERS = ['any', 'male', 'female']
const FORM_CONFIG_KEYS = [
  'require_email',
  'require_address',
  'require_emergency',
  'require_photo',
  'require_representing',
  'show_district',
  'allow_photo_upload',
  'age_calculation_mode',
  'age_calculation_date',
] as const

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function sanitizeFormConfig(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    for (const key of FORM_CONFIG_KEYS) {
      if (!(key in obj)) continue
      const value = obj[key]
      if (typeof value === 'boolean') out[key] = value
      else if (key === 'age_calculation_mode' && ['championship_start', 'fixed'].includes(String(value))) {
        out[key] = String(value)
      } else if (key === 'age_calculation_date') {
        const v = str(value)
        if (isDateOnly(v)) out[key] = v
      }
    }
  }
  return out
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Math.trunc(Number(value))
  }
  return null
}

interface ChampionshipValues {
  name?: string
  slug?: string
  description?: string | null
  location?: string | null
  starts_on?: string | null
  ends_on?: string | null
  registration_opens_at?: string | null
  registration_closes_at?: string | null
  status?: string
  currency?: string
  base_fee_paise?: number
  bib_prefix?: string
  bib_start_number?: number
  bib_sequence_length?: number
  form_config?: Record<string, unknown>
  terms_text?: string | null
}

function buildChampionshipValues(
  raw: Record<string, unknown>,
  opts: { partial: boolean },
): { values: ChampionshipValues; error?: string } {
  const values: ChampionshipValues = {}

  if ('name' in raw || !opts.partial) {
    const name = str(raw.name)
    if (name.length < 2 || name.length > 160) {
      return { values, error: 'Please enter a championship name (2-160 characters).' }
    }
    values.name = name
  }

  if ('slug' in raw || (!opts.partial && values.name)) {
    const slug = str(raw.slug) ? slugify(str(raw.slug)) : slugify(values.name ?? '')
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)) {
      return { values, error: 'The web address (slug) may contain lowercase letters, numbers and dashes.' }
    }
    values.slug = slug
  }

  if ('description' in raw) values.description = str(raw.description) || null
  if ('location' in raw) values.location = str(raw.location) || null

  for (const key of ['starts_on', 'ends_on'] as const) {
    if (key in raw) {
      const value = str(raw[key])
      if (value && !isDateOnly(value)) return { values, error: `Invalid date for ${key.replace('_', ' ')}.` }
      values[key] = value || null
    }
  }

  for (const key of ['registration_opens_at', 'registration_closes_at'] as const) {
    if (key in raw) {
      const value = str(raw[key])
      if (value) {
        const parsed = new Date(value)
        if (Number.isNaN(parsed.getTime())) return { values, error: 'Invalid registration date/time.' }
        values[key] = parsed.toISOString()
      } else {
        values[key] = null
      }
    }
  }

  if (
    values.registration_opens_at &&
    values.registration_closes_at &&
    new Date(values.registration_opens_at) >= new Date(values.registration_closes_at)
  ) {
    return { values, error: 'Registration must close after it opens.' }
  }

  if ('status' in raw || !opts.partial) {
    const status = str(raw.status) || 'draft'
    if (!STATUSES.includes(status)) return { values, error: 'Invalid championship status.' }
    values.status = status
  }

  if ('currency' in raw) {
    const currency = str(raw.currency).toUpperCase() || 'INR'
    if (!/^[A-Z]{3}$/.test(currency)) return { values, error: 'Currency must be a 3-letter code such as INR.' }
    values.currency = currency
  }

  if ('base_fee_paise' in raw) {
    const fee = toInt(raw.base_fee_paise)
    if (fee === null || fee < 0) return { values, error: 'Base fee must be zero or more.' }
    values.base_fee_paise = fee
  }

  if ('bib_prefix' in raw) {
    const prefix = str(raw.bib_prefix).toUpperCase()
    if (!/^[A-Z0-9]{0,8}$/.test(prefix)) {
      return { values, error: 'Bib prefix may contain up to 8 letters or numbers.' }
    }
    values.bib_prefix = prefix
  }

  if ('bib_start_number' in raw) {
    const start = toInt(raw.bib_start_number)
    if (start === null || start < 0) return { values, error: 'Bib start number must be zero or more.' }
    values.bib_start_number = start
  }

  if ('bib_sequence_length' in raw) {
    const len = toInt(raw.bib_sequence_length)
    if (len === null || len < 1 || len > 12) {
      return { values, error: 'Bib sequence length must be between 1 and 12 digits.' }
    }
    values.bib_sequence_length = len
  }

  if ('form_config' in raw) values.form_config = sanitizeFormConfig(raw.form_config)
  if ('terms_text' in raw) {
    const terms = str(raw.terms_text)
    if (terms.length > 20000) return { values, error: 'Terms text is too long.' }
    values.terms_text = terms || null
  }

  return { values }
}

Deno.serve(
  handler(async (req) => {
    const context = await requireAdmin(req)
    if (context instanceof Response) return context
    const { supabase, admin } = context

    const body = await req.json().catch(() => ({}) as Record<string, unknown>)
    const action = str(body.action) || 'list'
    const readOnly = admin.role === 'viewer'

    // ---- list ---------------------------------------------------------------
    if (action === 'list') {
      const { data: championships, error } = await supabase
        .from('championships')
        .select(
          'id, slug, name, description, location, starts_on, ends_on, registration_opens_at, registration_closes_at, status, currency, base_fee_paise, bib_prefix, bib_start_number, bib_sequence_length, form_config, terms_text, created_at, updated_at, championship_categories (id, name, gender, min_age, max_age, fee_paise, is_active, sort_order), championship_events (id, name, gender, category_ids, fee_paise, is_active, sort_order)',
        )
        .order('created_at', { ascending: false })
      if (error) {
        console.error('championships list failed', error)
        return errorJson(req, 'SERVER_ERROR', 'Could not load championships.', 500)
      }

      const rows = []
      for (const championship of championships ?? []) {
        const base = supabase
          .from('registrations')
          .select('id', { count: 'exact', head: true })
          .eq('championship_id', championship.id)
        const paid = supabase
          .from('registrations')
          .select('id', { count: 'exact', head: true })
          .eq('championship_id', championship.id)
          .eq('payment_status', 'paid')
        const [{ count: totalCount }, { count: paidCount }] = await Promise.all([base, paid])
        rows.push({
          ...championship,
          championship_categories: (championship.championship_categories ?? []).sort(
            (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order,
          ),
          championship_events: (championship.championship_events ?? []).sort(
            (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order,
          ),
          registrations_total: totalCount ?? 0,
          registrations_paid: paidCount ?? 0,
        })
      }

      return json(req, { rows })
    }

    // ---- settings ------------------------------------------------------------
    if (action === 'settings_get') {
      const { data } = await supabase.from('app_settings').select('key, value')
      const settings: Record<string, unknown> = {}
      for (const row of data ?? []) settings[row.key as string] = row.value
      return json(req, { settings })
    }

    if (action === 'settings_update') {
      if (readOnly) return errorJson(req, 'FORBIDDEN', 'Viewers cannot change settings.', 403)
      const settings = (body.settings ?? {}) as Record<string, unknown>

      if (settings.site && typeof settings.site === 'object') {
        const site = settings.site as Record<string, unknown>
        const sanitized = {
          organizer_name: str(site.organizer_name).slice(0, 160),
          support_email: str(site.support_email).slice(0, 160),
          support_phone: str(site.support_phone).slice(0, 40),
          address: str(site.address).slice(0, 300),
        }
        await supabase
          .from('app_settings')
          .upsert({ key: 'site', value: sanitized, updated_at: new Date().toISOString() })
      }

      if (settings.athlete_id_format && typeof settings.athlete_id_format === 'object') {
        const format = settings.athlete_id_format as Record<string, unknown>
        const prefix = str(format.prefix).toUpperCase() || 'ATH'
        const sequenceLength = toInt(format.sequence_length) ?? 6
        if (!/^[A-Z0-9]{1,8}$/.test(prefix)) {
          return errorJson(req, 'INVALID_PREFIX', 'Athlete ID prefix may contain up to 8 letters or numbers.', 400)
        }
        if (sequenceLength < 3 || sequenceLength > 12) {
          return errorJson(req, 'INVALID_LENGTH', 'Sequence length must be between 3 and 12 digits.', 400)
        }
        await supabase.from('app_settings').upsert({
          key: 'athlete_id_format',
          value: { prefix, sequence_length: sequenceLength },
          updated_at: new Date().toISOString(),
        })
      }

      await writeAudit(supabase, admin, 'settings.updated', 'app_settings', null, { settings })

      const { data } = await supabase.from('app_settings').select('key, value')
      const refreshed: Record<string, unknown> = {}
      for (const row of data ?? []) refreshed[row.key as string] = row.value
      return json(req, { ok: true, settings: refreshed })
    }

    if (readOnly) {
      return errorJson(req, 'FORBIDDEN', 'Viewer accounts have read-only access.', 403)
    }

    // ---- create --------------------------------------------------------------
    if (action === 'create') {
      const { values, error } = buildChampionshipValues(body, { partial: false })
      if (error) return errorJson(req, 'INVALID_FIELDS', error, 400)

      const { data: created, error: insertError } = await supabase
        .from('championships')
        .insert({
          name: values.name,
          slug: values.slug,
          description: values.description ?? null,
          location: values.location ?? null,
          starts_on: values.starts_on ?? null,
          ends_on: values.ends_on ?? null,
          registration_opens_at: values.registration_opens_at ?? null,
          registration_closes_at: values.registration_closes_at ?? null,
          status: values.status ?? 'draft',
          currency: values.currency ?? 'INR',
          base_fee_paise: values.base_fee_paise ?? 0,
          bib_prefix: values.bib_prefix ?? '',
          bib_start_number: values.bib_start_number ?? 1,
          bib_sequence_length: values.bib_sequence_length ?? 5,
          form_config: values.form_config ?? {},
          terms_text: values.terms_text ?? null,
        })
        .select('id, name, slug')
        .maybeSingle()

      if (insertError) {
        if (insertError.code === '23505') {
          return errorJson(req, 'DUPLICATE_SLUG', 'A championship with this web address already exists.', 409)
        }
        console.error('championship insert failed', insertError)
        return errorJson(req, 'SERVER_ERROR', 'Could not create the championship.', 500)
      }

      await writeAudit(supabase, admin, 'championship.created', 'championship', created?.id ?? null, {
        name: values.name,
      })
      return json(req, { ok: true, championship: created })
    }

    // ---- update --------------------------------------------------------------
    if (action === 'update') {
      const championshipId = str(body.championshipId)
      if (!championshipId) return errorJson(req, 'MISSING_FIELDS', 'Championship id is required.', 400)

      const { values, error } = buildChampionshipValues(body, { partial: true })
      if (error) return errorJson(req, 'INVALID_FIELDS', error, 400)
      if (Object.keys(values).length === 0) return errorJson(req, 'NO_CHANGES', 'Nothing to update.', 400)

      const { data: existing } = await supabase
        .from('championships')
        .select('registration_opens_at, registration_closes_at')
        .eq('id', championshipId)
        .maybeSingle()
      if (!existing) return errorJson(req, 'NOT_FOUND', 'Championship not found.', 404)

      const opens = values.registration_opens_at ?? existing.registration_opens_at
      const closes = values.registration_closes_at ?? existing.registration_closes_at
      if (opens && closes && new Date(opens) >= new Date(closes)) {
        return errorJson(req, 'INVALID_DATES', 'Registration must close after it opens.', 400)
      }

      const { error: updateError } = await supabase
        .from('championships')
        .update(values)
        .eq('id', championshipId)
      if (updateError) {
        if (updateError.code === '23505') {
          return errorJson(req, 'DUPLICATE_SLUG', 'A championship with this web address already exists.', 409)
        }
        console.error('championship update failed', updateError)
        return errorJson(req, 'SERVER_ERROR', 'Could not update the championship.', 500)
      }

      await writeAudit(supabase, admin, 'championship.updated', 'championship', championshipId, {
        changes: values,
      })
      return json(req, { ok: true })
    }

    // ---- archive -------------------------------------------------------------
    if (action === 'archive') {
      const championshipId = str(body.championshipId)
      if (!championshipId) return errorJson(req, 'MISSING_FIELDS', 'Championship id is required.', 400)
      const { error } = await supabase
        .from('championships')
        .update({ status: 'archived' })
        .eq('id', championshipId)
      if (error) return errorJson(req, 'SERVER_ERROR', 'Could not archive the championship.', 500)
      await writeAudit(supabase, admin, 'championship.archived', 'championship', championshipId, {})
      return json(req, { ok: true })
    }

    // ---- categories ----------------------------------------------------------
    if (action === 'category_create' || action === 'category_update') {
      const championshipId = str(body.championshipId)
      const name = str(body.name)
      const gender = str(body.gender) || 'any'
      const minAge = toInt(body.min_age)
      const maxAge = toInt(body.max_age)
      const feePaise = toInt(body.fee_paise)

      if (!championshipId || name.length < 1) {
        return errorJson(req, 'INVALID_FIELDS', 'A category name is required.', 400)
      }
      if (!GENDERS.includes(gender)) return errorJson(req, 'INVALID_FIELDS', 'Invalid gender eligibility.', 400)
      if (minAge === null || maxAge === null || minAge < 0 || maxAge < minAge) {
        return errorJson(req, 'INVALID_FIELDS', 'Please provide a valid age range (max must be >= min).', 400)
      }
      if (feePaise === null || feePaise < 0) {
        return errorJson(req, 'INVALID_FIELDS', 'Category fee must be zero or more.', 400)
      }

      const payload = {
        championship_id: championshipId,
        name,
        gender,
        min_age: minAge,
        max_age: maxAge,
        fee_paise: feePaise,
        is_active: body.is_active === false ? false : true,
        sort_order: toInt(body.sort_order) ?? 0,
      }

      if (action === 'category_create') {
        const { data: created, error: insertError } = await supabase
          .from('championship_categories')
          .insert(payload)
          .select('id')
          .maybeSingle()
        if (insertError) {
          if (insertError.code === '23505') {
            return errorJson(req, 'DUPLICATE', 'A category with this name already exists.', 409)
          }
          console.error('category insert failed', insertError)
          return errorJson(req, 'SERVER_ERROR', 'Could not create the category.', 500)
        }
        await writeAudit(supabase, admin, 'category.created', 'championship', championshipId, { name })
        return json(req, { ok: true, id: created?.id })
      }

      const categoryId = str(body.categoryId)
      if (!categoryId) return errorJson(req, 'MISSING_FIELDS', 'Category id is required.', 400)
      const { error: updateError } = await supabase
        .from('championship_categories')
        .update(payload)
        .eq('id', categoryId)
      if (updateError) {
        console.error('category update failed', updateError)
        return errorJson(req, 'SERVER_ERROR', 'Could not update the category.', 500)
      }
      await writeAudit(supabase, admin, 'category.updated', 'championship', championshipId, { categoryId })
      return json(req, { ok: true })
    }

    if (action === 'category_delete') {
      const categoryId = str(body.categoryId)
      if (!categoryId) return errorJson(req, 'MISSING_FIELDS', 'Category id is required.', 400)

      const { count } = await supabase
        .from('registrations')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', categoryId)
      if ((count ?? 0) > 0) {
        return errorJson(
          req,
          'IN_USE',
          'This category already has registrations and cannot be deleted. Deactivate it instead so existing records stay intact.',
          409,
        )
      }

      const { error } = await supabase.from('championship_categories').delete().eq('id', categoryId)
      if (error) return errorJson(req, 'SERVER_ERROR', 'Could not delete the category.', 500)
      await writeAudit(supabase, admin, 'category.deleted', 'championship_category', categoryId, {})
      return json(req, { ok: true })
    }

    // ---- events --------------------------------------------------------------
    if (action === 'event_create' || action === 'event_update') {
      const championshipId = str(body.championshipId)
      const name = str(body.name)
      const gender = str(body.gender) || 'any'
      const feePaise = toInt(body.fee_paise) ?? 0
      const categoryIdsRaw = body.category_ids
      let categoryIds: string[] | null = null
      if (Array.isArray(categoryIdsRaw) && categoryIdsRaw.length > 0) {
        categoryIds = categoryIdsRaw.map((v) => str(v)).filter(Boolean)
      }

      if (!championshipId || name.length < 1) {
        return errorJson(req, 'INVALID_FIELDS', 'An event name is required.', 400)
      }
      if (!GENDERS.includes(gender)) return errorJson(req, 'INVALID_FIELDS', 'Invalid gender eligibility.', 400)
      if (feePaise < 0) return errorJson(req, 'INVALID_FIELDS', 'Event fee must be zero or more.', 400)

      const payload = {
        championship_id: championshipId,
        name,
        gender,
        category_ids: categoryIds,
        fee_paise: feePaise,
        is_active: body.is_active === false ? false : true,
        sort_order: toInt(body.sort_order) ?? 0,
      }

      if (action === 'event_create') {
        const { data: created, error: insertError } = await supabase
          .from('championship_events')
          .insert(payload)
          .select('id')
          .maybeSingle()
        if (insertError) {
          if (insertError.code === '23505') {
            return errorJson(req, 'DUPLICATE', 'An event with this name already exists.', 409)
          }
          console.error('event insert failed', insertError)
          return errorJson(req, 'SERVER_ERROR', 'Could not create the event.', 500)
        }
        await writeAudit(supabase, admin, 'event.created', 'championship', championshipId, { name })
        return json(req, { ok: true, id: created?.id })
      }

      const eventId = str(body.eventId)
      if (!eventId) return errorJson(req, 'MISSING_FIELDS', 'Event id is required.', 400)
      const { error: updateError } = await supabase.from('championship_events').update(payload).eq('id', eventId)
      if (updateError) {
        console.error('event update failed', updateError)
        return errorJson(req, 'SERVER_ERROR', 'Could not update the event.', 500)
      }
      await writeAudit(supabase, admin, 'event.updated', 'championship', championshipId, { eventId })
      return json(req, { ok: true })
    }

    if (action === 'event_delete') {
      const eventId = str(body.eventId)
      if (!eventId) return errorJson(req, 'MISSING_FIELDS', 'Event id is required.', 400)

      const { count } = await supabase
        .from('registration_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventId)
      if ((count ?? 0) > 0) {
        return errorJson(
          req,
          'IN_USE',
          'This event already has registrations and cannot be deleted. Deactivate it instead so existing records stay intact.',
          409,
        )
      }

      const { error } = await supabase.from('championship_events').delete().eq('id', eventId)
      if (error) return errorJson(req, 'SERVER_ERROR', 'Could not delete the event.', 500)
      await writeAudit(supabase, admin, 'event.deleted', 'championship_event', eventId, {})
      return json(req, { ok: true })
    }

    return errorJson(req, 'UNKNOWN_ACTION', 'Unknown action.', 400)
  }),
)
