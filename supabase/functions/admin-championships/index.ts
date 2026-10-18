// Admin API for championships, their categories, events, numbering rules and
// the registration form configuration. Nothing about a championship is
// hard-coded in the application: the organiser configures it here.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
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

// ---------------------------------------------------------------------------
// Standard defaults
//
// Categories and events are maintained once as a standard set. Every new
// championship is seeded from it; the organiser can uncheck or add entries
// while creating the championship, and can edit the championship's own rows
// afterwards without ever touching the defaults.
// ---------------------------------------------------------------------------

const MAX_CATEGORIES = 60
const MAX_EVENTS = 120
const DEFAULT_CATEGORY_COLUMNS = 'id, name, gender, min_age, max_age, fee_paise, is_active, sort_order'
const DEFAULT_EVENT_COLUMNS = 'id, name, gender, fee_paise, is_active, sort_order'

interface CategoryRow {
  name: string
  gender: string
  min_age: number
  max_age: number
  fee_paise: number
  is_active: boolean
  sort_order: number
}

interface EventRow {
  name: string
  gender: string
  fee_paise: number
  is_active: boolean
  sort_order: number
}

/** Validates the age-category list that arrives with a championship create. */
function parseCategoryRows(raw: unknown): { rows: CategoryRow[]; error?: string } {
  if (!Array.isArray(raw)) return { rows: [] }
  if (raw.length > MAX_CATEGORIES) {
    return { rows: [], error: `Too many age categories (maximum ${MAX_CATEGORIES}).` }
  }
  const rows: CategoryRow[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const source = (item ?? {}) as Record<string, unknown>
    const name = str(source.name).slice(0, 120)
    if (name.length < 1) return { rows, error: 'Every age category needs a name.' }
    if (seen.has(name.toLowerCase())) continue
    const gender = str(source.gender) || 'any'
    if (!GENDERS.includes(gender)) return { rows, error: `Invalid gender for the category "${name}".` }
    const minAge = toInt(source.min_age)
    const maxAge = toInt(source.max_age)
    if (minAge === null || maxAge === null || minAge < 0 || maxAge < minAge) {
      return { rows, error: `Please give "${name}" a valid age range (max must be >= min).` }
    }
    const fee = toInt(source.fee_paise)
    if (fee === null || fee < 0) return { rows, error: `The fee for "${name}" must be zero or more.` }
    seen.add(name.toLowerCase())
    rows.push({
      name,
      gender,
      min_age: minAge,
      max_age: maxAge,
      fee_paise: fee,
      is_active: source.is_active === false ? false : true,
      sort_order: toInt(source.sort_order) ?? rows.length + 1,
    })
  }
  return { rows }
}

/** Validates the event list that arrives with a championship create. */
function parseEventRows(raw: unknown): { rows: EventRow[]; error?: string } {
  if (!Array.isArray(raw)) return { rows: [] }
  if (raw.length > MAX_EVENTS) return { rows: [], error: `Too many events (maximum ${MAX_EVENTS}).` }
  const rows: EventRow[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const source = (item ?? {}) as Record<string, unknown>
    const name = str(source.name).slice(0, 120)
    if (name.length < 1) return { rows, error: 'Every event needs a name.' }
    if (seen.has(name.toLowerCase())) continue
    const gender = str(source.gender) || 'any'
    if (!GENDERS.includes(gender)) return { rows, error: `Invalid gender for the event "${name}".` }
    const fee = toInt(source.fee_paise)
    if (fee === null || fee < 0) return { rows, error: `The fee for "${name}" must be zero or more.` }
    seen.add(name.toLowerCase())
    rows.push({
      name,
      gender,
      fee_paise: fee,
      is_active: source.is_active === false ? false : true,
      sort_order: toInt(source.sort_order) ?? rows.length + 1,
    })
  }
  return { rows }
}

async function loadDefaults(
  supabase: SupabaseClient,
): Promise<{ categories: Array<Record<string, unknown>>; events: Array<Record<string, unknown>> }> {
  const [categories, events] = await Promise.all([
    supabase.from('default_categories').select(DEFAULT_CATEGORY_COLUMNS).order('sort_order', { ascending: true }),
    supabase.from('default_events').select(DEFAULT_EVENT_COLUMNS).order('sort_order', { ascending: true }),
  ])
  return {
    categories: (categories.data ?? []) as unknown as Array<Record<string, unknown>>,
    events: (events.data ?? []) as unknown as Array<Record<string, unknown>>,
  }
}

function defaultCategoryRows(
  championshipId: string,
  defaults: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return defaults
    .filter((category) => category.is_active !== false)
    .map((category) => ({
      championship_id: championshipId,
      name: category.name,
      gender: category.gender ?? 'any',
      min_age: category.min_age,
      max_age: category.max_age,
      fee_paise: category.fee_paise ?? 0,
      is_active: true,
      sort_order: category.sort_order ?? 0,
    }))
}

function defaultEventRows(
  championshipId: string,
  defaults: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return defaults
    .filter((event) => event.is_active !== false)
    .map((event) => ({
      championship_id: championshipId,
      name: event.name,
      gender: event.gender ?? 'any',
      category_ids: null,
      fee_paise: event.fee_paise ?? 0,
      is_active: true,
      sort_order: event.sort_order ?? 0,
    }))
}

async function insertCollections(
  supabase: SupabaseClient,
  categories: Array<Record<string, unknown>>,
  events: Array<Record<string, unknown>>,
): Promise<void> {
  if (categories.length > 0) {
    const { error } = await supabase.from('championship_categories').insert(categories)
    if (error) console.error('category seed failed', error)
  }
  if (events.length > 0) {
    const { error } = await supabase.from('championship_events').insert(events)
    if (error) console.error('event seed failed', error)
  }
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
  form_config?: Record<string, unknown>
  terms_text?: string | null
  level?: string
  nation?: string | null
  state_name?: string | null
  max_events_per_athlete?: number | null
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

  // Bib numbers are derived by the database (M|W + age category + sequence),
  // so there are no organiser-supplied bib settings left to validate.

  if ('form_config' in raw) values.form_config = sanitizeFormConfig(raw.form_config)
  if ('terms_text' in raw) {
    const terms = str(raw.terms_text)
    if (terms.length > 20000) return { values, error: 'Terms text is too long.' }
    values.terms_text = terms || null
  }
  if ('level' in raw) {
    const level = str(raw.level).toLowerCase()
    if (level !== 'state' && level !== 'national') return { values, error: 'Level must be State or National.' }
    values.level = level
  }

  if ('nation' in raw) {
    const nation = str(raw.nation).slice(0, 80)
    values.nation = nation || null
  }
  if ('state_name' in raw) {
    const stateName = str(raw.state_name).slice(0, 120)
    values.state_name = stateName || null
  }

  // The level decides what the registration form asks the athlete for, so the
  // two location fields are kept in step here rather than in the UI: a state
  // meet is always in India and names its state; a national meet names its
  // nation and has no state of its own.
  const level = values.level ?? (str(raw.level) || undefined)
  if (level === 'state') {
    values.nation = 'India'
    const stateName = (values.state_name ?? '').trim()
    if (stateName) {
      values.state_name = stateName
    } else if (!opts.partial || 'state_name' in raw) {
      return { values, error: 'Please choose the state this championship belongs to.' }
    } else {
      delete values.state_name
    }
  } else if (level === 'national') {
    const nation = (values.nation ?? '').trim()
    if (nation) {
      values.nation = nation
    } else if (!opts.partial || 'nation' in raw) {
      return { values, error: 'Please choose the nation this championship belongs to.' }
    } else {
      delete values.nation
    }
    values.state_name = null
  }
  if ('max_events_per_athlete' in raw) {
    const max = toInt(raw.max_events_per_athlete)
    if (raw.max_events_per_athlete === null || str(raw.max_events_per_athlete) === '') {
      values.max_events_per_athlete = null
    } else {
      if (max === null || max < 1 || max > 50) return { values, error: 'Max events per athlete must be between 1 and 50 (or leave blank).' }
      values.max_events_per_athlete = max
    }
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
          'id, slug, name, description, location, starts_on, ends_on, registration_opens_at, registration_closes_at, status, currency, base_fee_paise, form_config, terms_text, level, nation, state_name, max_events_per_athlete, created_at, updated_at, championship_categories (id, name, gender, min_age, max_age, fee_paise, is_active, sort_order), championship_events (id, name, gender, category_ids, fee_paise, is_active, sort_order)',
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

    // ---- standard defaults ---------------------------------------------------
    // Read-only list of the standard categories/events, used by the create form
    // to pre-fill (and let the organiser trim) a new championship.
    if (action === 'defaults') {
      const defaults = await loadDefaults(supabase)
      return json(req, { categories: defaults.categories, events: defaults.events })
    }

    if (readOnly) {
      return errorJson(req, 'FORBIDDEN', 'Viewer accounts have read-only access.', 403)
    }

    // ---- create --------------------------------------------------------------
    if (action === 'create') {
      const { values, error } = buildChampionshipValues(body, { partial: false })
      if (error) return errorJson(req, 'INVALID_FIELDS', error, 400)

      // The form sends the defaults the organiser kept (plus any additions).
      // When the lists are omitted entirely we fall back to every active
      // default, so an API caller also gets a usable championship.
      const hasCategoryList = Array.isArray(body.categories)
      const hasEventList = Array.isArray(body.events)

      const parsedCategories = parseCategoryRows(body.categories)
      if (parsedCategories.error) return errorJson(req, 'INVALID_FIELDS', parsedCategories.error, 400)
      const parsedEvents = parseEventRows(body.events)
      if (parsedEvents.error) return errorJson(req, 'INVALID_FIELDS', parsedEvents.error, 400)

      const defaults = await loadDefaults(supabase)

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
          form_config: values.form_config ?? {},
          terms_text: values.terms_text ?? null,
          level: values.level ?? 'state',
          nation: values.nation ?? 'India',
          state_name: values.state_name ?? null,
          max_events_per_athlete: values.max_events_per_athlete ?? null,
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

      let categoriesAdded = 0
      let eventsAdded = 0
      if (created) {
        const categoryRows = hasCategoryList
          ? parsedCategories.rows.map((row) => ({ ...row, championship_id: created.id }))
          : defaultCategoryRows(created.id, defaults.categories)
        const eventRows = hasEventList
          ? parsedEvents.rows.map((row) => ({ ...row, championship_id: created.id, category_ids: null }))
          : defaultEventRows(created.id, defaults.events)
        await insertCollections(supabase, categoryRows, eventRows)
        categoriesAdded = categoryRows.length
        eventsAdded = eventRows.length
      }

      await writeAudit(supabase, admin, 'championship.created', 'championship', created?.id ?? null, {
        name: values.name,
        categories: categoriesAdded,
        events: eventsAdded,
      })
      return json(req, { ok: true, championship: created, categoriesAdded, eventsAdded })
    }

    // ---- re-apply standard defaults ------------------------------------------
    if (action === 'import_defaults') {
      const championshipId = str(body.championshipId)
      if (!championshipId) return errorJson(req, 'MISSING_FIELDS', 'Championship id is required.', 400)

      const [existingCategories, existingEvents, defaults] = await Promise.all([
        supabase.from('championship_categories').select('name').eq('championship_id', championshipId),
        supabase.from('championship_events').select('name').eq('championship_id', championshipId),
        loadDefaults(supabase),
      ])

      const knownCategories = new Set((existingCategories.data ?? []).map((row) => String(row.name).toLowerCase()))
      const knownEvents = new Set((existingEvents.data ?? []).map((row) => String(row.name).toLowerCase()))

      const categoryRows = defaultCategoryRows(championshipId, defaults.categories).filter(
        (row) => !knownCategories.has(String(row.name).toLowerCase()),
      )
      const eventRows = defaultEventRows(championshipId, defaults.events).filter(
        (row) => !knownEvents.has(String(row.name).toLowerCase()),
      )

      await insertCollections(supabase, categoryRows, eventRows)
      await writeAudit(supabase, admin, 'championship.defaults_applied', 'championship', championshipId, {
        categories: categoryRows.length,
        events: eventRows.length,
      })
      return json(req, { ok: true, categoriesAdded: categoryRows.length, eventsAdded: eventRows.length })
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
