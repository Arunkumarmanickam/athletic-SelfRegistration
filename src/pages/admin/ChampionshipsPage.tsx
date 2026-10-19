import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Separator, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Checkbox, Select, Textarea } from '@/components/ui/form-controls'
import { SearchCombobox } from '@/components/ui/search-combobox'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Table, TableWrap, Td, Th } from '@/components/ui/table'
import { PageHeader } from '@/components/admin/PageHeader'
import { ApiError, adminChampionships } from '@/lib/api'
import { COUNTRIES, INDIAN_STATES } from '@/lib/geo'
import { useToast } from '@/context/ToastContext'
import { formatDate, formatDateTime, formatMoney, championshipStatusTone, genderLabel, titleCase } from '@/lib/format'
import type {
  AdminChampionship,
  ChampionshipCategory,
  ChampionshipEvent,
  DefaultCategory,
  DefaultEvent,
  FormConfig,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const paiseToRupees = (paise: number): string => (paise / 100).toString()
const rupeesToPaise = (rupees: string): number => Math.max(0, Math.round(Number(rupees || '0') * 100))

function toLocalInput(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

interface ChampionshipFormState {
  name: string
  slug: string
  description: string
  location: string
  starts_on: string
  ends_on: string
  registration_opens_at: string
  registration_closes_at: string
  status: string
  currency: string
  base_fee_rupees: string
  terms_text: string
  level: 'state' | 'national'
  nation: string
  state_name: string
  max_events_per_athlete: string
}

interface FormConfigState {
  require_email: boolean
  require_address: boolean
  require_emergency: boolean
  require_photo: boolean
  require_representing: boolean
  show_district: boolean
  allow_photo_upload: boolean
  age_calculation_mode: 'championship_start' | 'fixed'
  age_calculation_date: string
}

const EMPTY_FORM: ChampionshipFormState = {
  name: '',
  slug: '',
  description: '',
  location: '',
  starts_on: '',
  ends_on: '',
  registration_opens_at: '',
  registration_closes_at: '',
  status: 'draft',
  currency: 'INR',
  base_fee_rupees: '0',
  terms_text: '',
  level: 'state',
  nation: 'India',
  state_name: '',
  max_events_per_athlete: '',
}

function formConfigState(config: FormConfig | undefined): FormConfigState {
  return {
    require_email: config?.require_email === true,
    require_address: config?.require_address === true,
    require_emergency: config?.require_emergency === true,
    require_photo: config?.require_photo === true,
    require_representing: config?.require_representing === true,
    show_district: config?.show_district !== false,
    allow_photo_upload: config?.allow_photo_upload === true,
    age_calculation_mode: config?.age_calculation_mode === 'fixed' ? 'fixed' : 'championship_start',
    age_calculation_date: config?.age_calculation_date ?? '',
  }
}

function formState(championship: AdminChampionship | null): ChampionshipFormState {
  if (!championship) return EMPTY_FORM
  return {
    name: championship.name,
    slug: championship.slug,
    description: championship.description ?? '',
    location: championship.location ?? '',
    starts_on: championship.starts_on ?? '',
    ends_on: championship.ends_on ?? '',
    registration_opens_at: toLocalInput(championship.registration_opens_at),
    registration_closes_at: toLocalInput(championship.registration_closes_at),
    status: championship.status,
    currency: championship.currency,
    base_fee_rupees: paiseToRupees(championship.base_fee_paise),
    terms_text: championship.terms_text ?? '',
    level: championship.level === 'national' ? 'national' : 'state',
    nation: championship.nation ?? 'India',
    state_name: championship.state_name ?? '',
    max_events_per_athlete: championship.max_events_per_athlete !== undefined && championship.max_events_per_athlete !== null ? String(championship.max_events_per_athlete) : '',
  }
}

// ---------------------------------------------------------------------------
// Pre-create drafts of the standard categories / events
//
// While creating a championship the organiser sees the standard defaults
// pre-selected and may uncheck any of them, or add extra ones. The selection is
// submitted with the championship; nothing here touches the defaults.
// ---------------------------------------------------------------------------

interface DraftCategory {
  key: string
  name: string
  gender: string
  min_age: string
  max_age: string
  fee_rupees: string
  is_active: boolean
  included: boolean
  isDefault: boolean
}

interface DraftEvent {
  key: string
  name: string
  gender: string
  fee_rupees: string
  is_active: boolean
  included: boolean
  isDefault: boolean
}

let draftKeyCounter = 0
const nextDraftKey = (): string => `draft-${Date.now()}-${(draftKeyCounter += 1)}`

function draftCategoriesFromDefaults(categories: DefaultCategory[]): DraftCategory[] {
  return categories.map((category) => ({
    key: `default-category-${category.id}`,
    name: category.name,
    gender: category.gender,
    min_age: String(category.min_age),
    max_age: String(category.max_age),
    fee_rupees: paiseToRupees(category.fee_paise),
    is_active: category.is_active,
    included: true,
    isDefault: true,
  }))
}

function draftEventsFromDefaults(events: DefaultEvent[]): DraftEvent[] {
  return events.map((event) => ({
    key: `default-event-${event.id}`,
    name: event.name,
    gender: event.gender,
    fee_rupees: paiseToRupees(event.fee_paise),
    is_active: event.is_active,
    included: true,
    isDefault: true,
  }))
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ChampionshipsPage() {
  const [championships, setChampionships] = useState<AdminChampionship[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminChampionship | 'new' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await adminChampionships({ action: 'list' })
      setChampionships(result.rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load championships.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (editing) {
    return (
      <ChampionshipEditor
        championship={editing === 'new' ? null : editing}
        onClose={() => {
          setEditing(null)
          void load()
        }}
        onSaved={() => void load()}
      />
    )
  }

  return (
    <div>
      <PageHeader
        title="Championships"
        description="Configure championships, categories, events, fees, deadlines and numbering."
        actions={
          <Button variant="accent" size="sm" onClick={() => setEditing('new')}>
            New championship
          </Button>
        }
      />

      {error && (
        <Alert tone="danger" title="Could not load championships" className="mb-5">
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Loading championships" />
        </div>
      ) : championships.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-base font-semibold text-slate-800">No championships yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
              Create your first championship, then add its age categories, events and fees. Nothing is open to athletes
              until you set its status to <strong>Open</strong>.
            </p>
            <div className="mt-4">
              <Button variant="accent" onClick={() => setEditing('new')}>
                New championship
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Championship</Th>
                  <Th>Status</Th>
                  <Th>Dates</Th>
                  <Th>Entry closes</Th>
                  <Th className="text-right">Registrations</Th>
                  <Th>Bib format</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {championships.map((championship) => (
                  <tr key={championship.id}>
                    <Td>
                      <span className="font-medium text-slate-900">{championship.name}</span>
                      <span className="block text-xs text-slate-500">
                        {championship.level === 'national'
                          ? `National · ${championship.nation ?? 'Nation not set'}`
                          : championship.state_name
                            ? `State · ${championship.state_name}`
                            : 'State'}
                        {' · '}
                        {championship.championship_categories.length} categories ·{' '}
                        {championship.championship_events.length} events
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={championshipStatusTone(championship.status)}>{titleCase(championship.status)}</Badge>
                    </Td>
                    <Td className="text-xs text-slate-600">
                      {championship.starts_on ? formatDate(championship.starts_on) : '—'}
                      {championship.ends_on && championship.ends_on !== championship.starts_on
                        ? ` – ${formatDate(championship.ends_on)}`
                        : ''}
                    </Td>
                    <Td className="text-xs text-slate-600">
                      {championship.registration_closes_at
                        ? formatDateTime(championship.registration_closes_at)
                        : '—'}
                    </Td>
                    <Td className="text-right tabular-nums">
                      <span className="font-medium text-slate-900">{championship.registrations_total}</span>
                      <span className="block text-xs text-emerald-700">{championship.registrations_paid} paid</span>
                    </Td>
                    <Td className="font-mono text-xs text-slate-600">
                      M/W + age category
                      <span className="block text-[11px] text-slate-400">e.g. M4501, W35101</span>
                    </Td>
                    <Td>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(championship)}>
                        Manage
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function ChampionshipEditor({
  championship,
  onClose,
  onSaved,
}: {
  championship: AdminChampionship | null
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [current, setCurrent] = useState<AdminChampionship | null>(championship)
  const [form, setForm] = useState<ChampionshipFormState>(() => formState(championship))
  const [config, setConfig] = useState<FormConfigState>(() => formConfigState(championship?.form_config))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)

  // A brand-new championship is pre-filled from the standard defaults so the
  // organiser only has to trim or extend the list.
  const [draftCategories, setDraftCategories] = useState<DraftCategory[]>([])
  const [draftEvents, setDraftEvents] = useState<DraftEvent[]>([])
  const [defaultsLoading, setDefaultsLoading] = useState(championship === null)
  const [defaultsError, setDefaultsError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (championship) return
    let cancelled = false
    void (async () => {
      setDefaultsLoading(true)
      try {
        const result = await adminChampionships({ action: 'defaults' })
        if (cancelled) return
        setDraftCategories(draftCategoriesFromDefaults(result.categories ?? []))
        setDraftEvents(draftEventsFromDefaults(result.events ?? []))
        setDefaultsError(null)
      } catch (err) {
        if (!cancelled) setDefaultsError(err instanceof Error ? err.message : 'Could not load the standard defaults.')
      } finally {
        if (!cancelled) setDefaultsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [championship])

  const refreshCurrent = useCallback(
    async (id: string) => {
      try {
        const result = await adminChampionships({ action: 'list' })
        const found = result.rows.find((row) => row.id === id) ?? null
        setCurrent(found)
        return found
      } catch {
        return null
      }
    },
    [],
  )

  const setField = (patch: Partial<ChampionshipFormState>) => setForm((f) => ({ ...f, ...patch }))
  const setConfigField = (patch: Partial<FormConfigState>) => setConfig((c) => ({ ...c, ...patch }))

  const handleSave = async () => {
    setFormError(null)
    if (form.name.trim().length < 2) {
      setFormError('Please enter a championship name (at least 2 characters).')
      return
    }
    if (!current && draftCategories.some((category) => category.included && category.name.trim().length < 1)) {
      setFormError('Every selected age category needs a name.')
      return
    }
    if (!current && draftEvents.some((event) => event.included && event.name.trim().length < 1)) {
      setFormError('Every selected event needs a name.')
      return
    }
    if (form.level === 'state' && form.state_name.trim().length < 1) {
      setFormError('Please choose the state this championship belongs to.')
      return
    }
    if (form.level === 'national' && form.nation.trim().length < 1) {
      setFormError('Please choose the nation this championship belongs to.')
      return
    }
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      description: form.description.trim(),
      location: form.location.trim(),
      starts_on: form.starts_on || '',
      ends_on: form.ends_on || '',
      registration_opens_at: form.registration_opens_at,
      registration_closes_at: form.registration_closes_at,
      status: form.status,
      currency: form.currency.trim().toUpperCase() || 'INR',
      base_fee_paise: rupeesToPaise(form.base_fee_rupees),
      form_config: {
        require_email: config.require_email,
        require_address: config.require_address,
        require_emergency: config.require_emergency,
        require_photo: config.require_photo,
        require_representing: config.require_representing,
        show_district: config.show_district,
        allow_photo_upload: config.allow_photo_upload,
        age_calculation_mode: config.age_calculation_mode,
        ...(config.age_calculation_mode === 'fixed' && config.age_calculation_date
          ? { age_calculation_date: config.age_calculation_date }
          : {}),
      },
      terms_text: form.terms_text,
      level: form.level,
      nation: form.level === 'state' ? 'India' : form.nation.trim(),
      state_name: form.level === 'state' ? form.state_name.trim() : null,
      max_events_per_athlete: form.max_events_per_athlete.trim() === '' ? null : Number(form.max_events_per_athlete.trim()),
    }

    // A new championship carries the (possibly trimmed) standard list with it.
    if (!current) {
      payload.categories = draftCategories
        .filter((category) => category.included)
        .map((category, index) => ({
          name: category.name.trim(),
          gender: category.gender,
          min_age: Number(category.min_age || 0),
          max_age: Number(category.max_age || 0),
          fee_paise: rupeesToPaise(category.fee_rupees),
          is_active: category.is_active,
          sort_order: index + 1,
        }))
      payload.events = draftEvents
        .filter((event) => event.included)
        .map((event, index) => ({
          name: event.name.trim(),
          gender: event.gender,
          fee_paise: rupeesToPaise(event.fee_rupees),
          is_active: event.is_active,
          sort_order: index + 1,
        }))
    }

    setSaving(true)
    try {
      if (current) {
        await adminChampionships({ action: 'update', championshipId: current.id, ...payload })
        toast.success('Championship updated')
        await refreshCurrent(current.id)
      } else {
        const result = await adminChampionships({ action: 'create', ...payload, slug: form.slug.trim() || undefined })
        toast.success(
          'Championship created',
          `${result.categoriesAdded ?? 0} age categories and ${result.eventsAdded ?? 0} events added. Set the status to Open when you are ready.`,
        )
        const newId = result.championship?.id
        if (newId) {
          const found = await refreshCurrent(newId)
          if (found) setForm(formState(found))
        }
      }
      onSaved()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save the championship.')
    } finally {
      setSaving(false)
    }
  }

  const handleImportDefaults = async () => {
    if (!current) return
    setImporting(true)
    try {
      const result = await adminChampionships({ action: 'import_defaults', championshipId: current.id })
      const addedCategories = result.categoriesAdded ?? 0
      const addedEvents = result.eventsAdded ?? 0
      if (addedCategories === 0 && addedEvents === 0) {
        toast.success('Nothing to add', 'Every standard age category and event is already present.')
      } else {
        toast.success('Standard defaults applied', `${addedCategories} age categories and ${addedEvents} events added.`)
      }
      await refreshCurrent(current.id)
    } catch (err) {
      toast.error('Could not apply the defaults', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setImporting(false)
    }
  }

  const handleArchive = async () => {
    if (!current) return
    try {
      await adminChampionships({ action: 'archive', championshipId: current.id })
      toast.success('Championship archived', 'It is no longer open. Existing records are unchanged.')
      const found = await refreshCurrent(current.id)
      if (found) setForm(formState(found))
      setConfirmArchive(false)
      onSaved()
    } catch (err) {
      toast.error('Could not archive', err instanceof ApiError ? err.message : 'Please try again.')
    }
  }

  return (
    <div>
      <PageHeader
        title={current ? current.name : 'New championship'}
        description={
          current
            ? `Slug: ${current.slug} · created ${formatDateTime(current.created_at)}`
            : 'Create the championship first, then add categories and events.'
        }
        actions={
          <Button variant="outline" size="sm" onClick={onClose}>
            ← All championships
          </Button>
        }
      />

      {formError && (
        <Alert tone="danger" title="Could not save" className="mb-5">
          {formError}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="c-name" required className="sm:col-span-2">
                <Input id="c-name" value={form.name} onChange={(e) => setField({ name: e.target.value })} />
              </Field>
              <Field label="Web address (slug)" htmlFor="c-slug" hint="Lowercase letters, numbers and dashes. Used in the registration link.">
                <Input id="c-slug" value={form.slug} onChange={(e) => setField({ slug: e.target.value })} placeholder="state-meet-2026" />
              </Field>
              <Field label="Status" htmlFor="c-status">
                <Select id="c-status" value={form.status} onChange={(e) => setField({ status: e.target.value })}>
                  <option value="draft">Draft (hidden from athletes)</option>
                  <option value="open">Open (accepting registrations)</option>
                  <option value="closed">Closed</option>
                  <option value="archived">Archived</option>
                </Select>
              </Field>
              <Field label="Location / venue" htmlFor="c-location" className="sm:col-span-2">
                <Input id="c-location" value={form.location} onChange={(e) => setField({ location: e.target.value })} />
              </Field>
              <Field label="Starts on" htmlFor="c-start">
                <Input id="c-start" type="date" value={form.starts_on} onChange={(e) => setField({ starts_on: e.target.value })} />
              </Field>
              <Field label="Ends on" htmlFor="c-end">
                <Input id="c-end" type="date" value={form.ends_on} onChange={(e) => setField({ ends_on: e.target.value })} />
              </Field>
              <Field label="Registration opens" htmlFor="c-opens" hint="Local time. Leave blank to open immediately.">
                <Input
                  id="c-opens"
                  type="datetime-local"
                  value={form.registration_opens_at}
                  onChange={(e) => setField({ registration_opens_at: e.target.value })}
                />
              </Field>
              <Field label="Registration closes" htmlFor="c-closes" hint="Local time.">
                <Input
                  id="c-closes"
                  type="datetime-local"
                  value={form.registration_closes_at}
                  onChange={(e) => setField({ registration_closes_at: e.target.value })}
                />
              </Field>
              <Field label="Description" htmlFor="c-desc" className="sm:col-span-2">
                <Textarea id="c-desc" value={form.description} onChange={(e) => setField({ description: e.target.value })} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fees &amp; numbering</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Level" htmlFor="c-level" hint="Decides what athletes pick under “representing”.">
                <Select id="c-level" value={form.level} onChange={(e) => setField({ level: e.target.value as 'state' | 'national' })}>
                  <option value="state">State</option>
                  <option value="national">National</option>
                </Select>
              </Field>
              {form.level === 'state' ? (
                <Field
                  label="State (India)"
                  htmlFor="c-state"
                  required
                  hint="Athletes representing this meet pick a district of this state."
                >
                  <SearchCombobox
                    id="c-state"
                    value={form.state_name}
                    onChange={(value) => setField({ state_name: value })}
                    options={INDIAN_STATES}
                    placeholder="Search Indian states"
                  />
                </Field>
              ) : (
                <Field label="Nation" htmlFor="c-nation" required hint="Pick the country this championship belongs to.">
                  <SearchCombobox
                    id="c-nation"
                    value={form.nation}
                    onChange={(value) => setField({ nation: value })}
                    options={COUNTRIES}
                    placeholder="Search countries"
                  />
                </Field>
              )}
              <Field label="Max events per athlete" htmlFor="c-max-events" hint="Leave blank for no limit.">
                <Input
                  id="c-max-events"
                  inputMode="numeric"
                  value={form.max_events_per_athlete}
                  onChange={(e) => setField({ max_events_per_athlete: e.target.value.replace(/[^\d]/g, '') })}
                />
              </Field>
              <Field label="Currency" htmlFor="c-currency" hint="Three-letter code, e.g. INR">
                <Input id="c-currency" value={form.currency} onChange={(e) => setField({ currency: e.target.value })} maxLength={3} />
              </Field>
              <Field label="Base fee (₹)" htmlFor="c-fee" hint="Added to category and event fees. Use 0 for none.">
                <Input
                  id="c-fee"
                  inputMode="decimal"
                  value={form.base_fee_rupees}
                  onChange={(e) => setField({ base_fee_rupees: e.target.value.replace(/[^\d.]/g, '') })}
                />
              </Field>
              <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm sm:col-span-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Bib number</p>
                <p className="mt-1 font-mono text-lg font-semibold text-slate-900">M/W + age category + 2 digits</p>
                <p className="mt-1 text-xs text-slate-500">
                  Bib numbers are generated automatically from the athlete's sex and age category only after payment is verified.
                  The pre-payment reference stays unique for lookups.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Registration form fields</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Checkbox label="Require email address" checked={config.require_email} onChange={(e) => setConfigField({ require_email: e.target.checked })} />
                <Checkbox label="Require postal address" checked={config.require_address} onChange={(e) => setConfigField({ require_address: e.target.checked })} />
                <Checkbox label="Require emergency contact" checked={config.require_emergency} onChange={(e) => setConfigField({ require_emergency: e.target.checked })} />
                <Checkbox label="Require 'representing'" checked={config.require_representing} onChange={(e) => setConfigField({ require_representing: e.target.checked })} />
                <Checkbox label="Show district field" checked={config.show_district} onChange={(e) => setConfigField({ show_district: e.target.checked })} />
                <Checkbox label="Allow photo/document upload" checked={config.allow_photo_upload} onChange={(e) => setConfigField({ allow_photo_upload: e.target.checked })} />
              </div>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Age calculation" htmlFor="c-age-mode">
                  <Select
                    id="c-age-mode"
                    value={config.age_calculation_mode}
                    onChange={(e) => setConfigField({ age_calculation_mode: e.target.value as 'championship_start' | 'fixed' })}
                  >
                    <option value="championship_start">On the championship start date</option>
                    <option value="fixed">On a fixed cutoff date</option>
                  </Select>
                </Field>
                {config.age_calculation_mode === 'fixed' && (
                  <Field label="Cutoff date" htmlFor="c-age-date">
                    <Input
                      id="c-age-date"
                      type="date"
                      value={config.age_calculation_date}
                      onChange={(e) => setConfigField({ age_calculation_date: e.target.value })}
                    />
                  </Field>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Terms shown at registration</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={form.terms_text}
                onChange={(e) => setField({ terms_text: e.target.value })}
                placeholder="Championship-specific terms and conditions (optional)."
                className="min-h-32"
              />
            </CardContent>
          </Card>

          {!current && (
            <>
              <DraftCategoriesEditor
                categories={draftCategories}
                onChange={setDraftCategories}
                loading={defaultsLoading}
                error={defaultsError}
              />
              <DraftEventsEditor
                events={draftEvents}
                onChange={setDraftEvents}
                loading={defaultsLoading}
                error={defaultsError}
              />
            </>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{current ? 'Save changes' : 'Create championship'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="accent" className="w-full" loading={saving} onClick={() => void handleSave()}>
                {current ? 'Save changes' : 'Create championship'}
              </Button>
              <Button variant="outline" className="w-full" onClick={onClose}>
                {current ? 'Done' : 'Cancel'}
              </Button>
              {current && (
                <Button variant="ghost" className="w-full" loading={importing} onClick={() => void handleImportDefaults()}>
                  Re-add standard defaults
                </Button>
              )}
              {current && current.status !== 'archived' && (
                <Button variant="ghost" className="w-full" onClick={() => setConfirmArchive(true)}>
                  Archive championship
                </Button>
              )}
            </CardContent>
          </Card>

          {current ? (
            <>
              <CategoriesEditor championship={current} onChanged={() => void refreshCurrent(current.id)} />
              <EventsEditor championship={current} onChanged={() => void refreshCurrent(current.id)} />
            </>
          ) : (
            <Alert tone="info">
              Age categories and events start from the standard defaults (shown on the left). Uncheck what this championship
              does not need, add anything extra, then create it. They can be fine-tuned afterwards.
            </Alert>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title="Archive this championship?"
        description="Archived championships are hidden from new registrations. Existing registrations and payments are untouched."
        tone="danger"
        confirmLabel="Archive"
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => void handleArchive()}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const EMPTY_CATEGORY = { name: '', gender: 'any', min_age: '', max_age: '', fee_rupees: '0', is_active: true }

function CategoriesEditor({ championship, onChanged }: { championship: AdminChampionship; onChanged: () => void }) {
  const toast = useToast()
  const [draft, setDraft] = useState(EMPTY_CATEGORY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ChampionshipCategory | null>(null)

  const startEdit = (category: ChampionshipCategory) => {
    setEditingId(category.id)
    setDraft({
      name: category.name,
      gender: category.gender,
      min_age: String(category.min_age),
      max_age: String(category.max_age),
      fee_rupees: paiseToRupees(category.fee_paise),
      is_active: category.is_active,
    })
  }

  const reset = () => {
    setEditingId(null)
    setDraft(EMPTY_CATEGORY)
  }

  const submit = async () => {
    if (draft.name.trim().length < 1 || draft.min_age === '' || draft.max_age === '') {
      toast.error('Missing details', 'A name and both age limits are required.')
      return
    }
    const payload = {
      championshipId: championship.id,
      name: draft.name.trim(),
      gender: draft.gender,
      min_age: Number(draft.min_age),
      max_age: Number(draft.max_age),
      fee_paise: rupeesToPaise(draft.fee_rupees),
      is_active: draft.is_active,
    }
    setBusy(true)
    try {
      if (editingId) await adminChampionships({ action: 'category_update', categoryId: editingId, ...payload })
      else await adminChampionships({ action: 'category_create', ...payload })
      toast.success(editingId ? 'Category updated' : 'Category added')
      reset()
      onChanged()
    } catch (err) {
      toast.error('Could not save category', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await adminChampionships({ action: 'category_delete', categoryId: deleteTarget.id })
      toast.success('Category deleted')
      setDeleteTarget(null)
      onChanged()
    } catch (err) {
      toast.error('Could not delete category', err instanceof ApiError ? err.message : 'Please try again.')
      setDeleteTarget(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Age categories ({championship.championship_categories.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {championship.championship_categories.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {championship.championship_categories.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">
                    {category.name}
                    {!category.is_active && <span className="ml-2 text-xs text-slate-400">(inactive)</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {genderLabel(category.gender)} · {category.min_age}–{category.max_age} yrs ·{' '}
                    {formatMoney(category.fee_paise, championship.currency)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(category)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(category)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">{editingId ? 'Edit category' : 'Add category'}</p>
          <div className="grid gap-3">
            <Field label="Name" htmlFor="cat-name">
              <Input id="cat-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Under 16 Boys" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Gender" htmlFor="cat-gender">
                <Select id="cat-gender" value={draft.gender} onChange={(e) => setDraft({ ...draft, gender: e.target.value })}>
                  <option value="any">Any</option>
                  <option value="male">Men</option>
                  <option value="female">Women</option>
                </Select>
              </Field>
              <Field label="Fee (₹)" htmlFor="cat-fee">
                <Input
                  id="cat-fee"
                  inputMode="decimal"
                  value={draft.fee_rupees}
                  onChange={(e) => setDraft({ ...draft, fee_rupees: e.target.value.replace(/[^\d.]/g, '') })}
                />
              </Field>
              <Field label="Min age" htmlFor="cat-min">
                <Input
                  id="cat-min"
                  inputMode="numeric"
                  value={draft.min_age}
                  onChange={(e) => setDraft({ ...draft, min_age: e.target.value.replace(/\D/g, '') })}
                />
              </Field>
              <Field label="Max age" htmlFor="cat-max">
                <Input
                  id="cat-max"
                  inputMode="numeric"
                  value={draft.max_age}
                  onChange={(e) => setDraft({ ...draft, max_age: e.target.value.replace(/\D/g, '') })}
                />
              </Field>
            </div>
            <Checkbox
              label="Active (available to athletes)"
              checked={draft.is_active}
              onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
            />
            <div className="flex gap-2">
              <Button variant="accent" size="sm" loading={busy} onClick={() => void submit()}>
                {editingId ? 'Save category' : 'Add category'}
              </Button>
              {editingId && (
                <Button variant="ghost" size="sm" onClick={reset}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this category?"
        description="This cannot be undone. A category with existing registrations cannot be deleted — deactivate it instead."
        tone="danger"
        confirmLabel="Delete"
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const EMPTY_EVENT = { name: '', gender: 'any', fee_rupees: '0', category_ids: [] as string[], is_active: true }

function EventsEditor({ championship, onChanged }: { championship: AdminChampionship; onChanged: () => void }) {
  const toast = useToast()
  const [draft, setDraft] = useState(EMPTY_EVENT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ChampionshipEvent | null>(null)

  const categoryNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const category of championship.championship_categories) map.set(category.id, category.name)
    return map
  }, [championship.championship_categories])

  const startEdit = (event: ChampionshipEvent) => {
    setEditingId(event.id)
    setDraft({
      name: event.name,
      gender: event.gender,
      fee_rupees: paiseToRupees(event.fee_paise),
      category_ids: event.category_ids ?? [],
      is_active: event.is_active,
    })
  }

  const reset = () => {
    setEditingId(null)
    setDraft(EMPTY_EVENT)
  }

  const toggleCategory = (id: string) => {
    setDraft((current) => ({
      ...current,
      category_ids: current.category_ids.includes(id)
        ? current.category_ids.filter((item) => item !== id)
        : [...current.category_ids, id],
    }))
  }

  const submit = async () => {
    if (draft.name.trim().length < 1) {
      toast.error('Missing details', 'An event name is required.')
      return
    }
    const payload = {
      championshipId: championship.id,
      name: draft.name.trim(),
      gender: draft.gender,
      fee_paise: rupeesToPaise(draft.fee_rupees),
      category_ids: draft.category_ids,
      is_active: draft.is_active,
    }
    setBusy(true)
    try {
      if (editingId) await adminChampionships({ action: 'event_update', eventId: editingId, ...payload })
      else await adminChampionships({ action: 'event_create', ...payload })
      toast.success(editingId ? 'Event updated' : 'Event added')
      reset()
      onChanged()
    } catch (err) {
      toast.error('Could not save event', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await adminChampionships({ action: 'event_delete', eventId: deleteTarget.id })
      toast.success('Event deleted')
      setDeleteTarget(null)
      onChanged()
    } catch (err) {
      toast.error('Could not delete event', err instanceof ApiError ? err.message : 'Please try again.')
      setDeleteTarget(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Events ({championship.championship_events.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {championship.championship_events.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {championship.championship_events.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">
                    {event.name}
                    {!event.is_active && <span className="ml-2 text-xs text-slate-400">(inactive)</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {genderLabel(event.gender)} · {formatMoney(event.fee_paise, championship.currency)}
                    {event.category_ids && event.category_ids.length > 0
                      ? ` · ${event.category_ids.map((id) => categoryNames.get(id) ?? '?').join(', ')}`
                      : ' · all categories'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(event)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(event)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">{editingId ? 'Edit event' : 'Add event'}</p>
          <div className="grid gap-3">
            <Field label="Name" htmlFor="evt-name">
              <Input id="evt-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="100m Sprint" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Gender" htmlFor="evt-gender">
                <Select id="evt-gender" value={draft.gender} onChange={(e) => setDraft({ ...draft, gender: e.target.value })}>
                  <option value="any">Any</option>
                  <option value="male">Men</option>
                  <option value="female">Women</option>
                </Select>
              </Field>
              <Field label="Fee (₹)" htmlFor="evt-fee">
                <Input
                  id="evt-fee"
                  inputMode="decimal"
                  value={draft.fee_rupees}
                  onChange={(e) => setDraft({ ...draft, fee_rupees: e.target.value.replace(/[^\d.]/g, '') })}
                />
              </Field>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-slate-800">Restrict to categories</p>
              {championship.championship_categories.length === 0 ? (
                <p className="text-xs text-slate-500">Add categories first, or leave blank to offer to all categories.</p>
              ) : (
                <div className="grid gap-1.5">
                  {championship.championship_categories.map((category) => (
                    <Checkbox
                      key={category.id}
                      label={category.name}
                      checked={draft.category_ids.includes(category.id)}
                      onChange={() => toggleCategory(category.id)}
                    />
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-slate-500">Leave all unchecked to offer this event to every category.</p>
            </div>
            <Checkbox
              label="Active (selectable by athletes)"
              checked={draft.is_active}
              onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
            />
            <div className="flex gap-2">
              <Button variant="accent" size="sm" loading={busy} onClick={() => void submit()}>
                {editingId ? 'Save event' : 'Add event'}
              </Button>
              {editingId && (
                <Button variant="ghost" size="sm" onClick={reset}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this event?"
        description="This cannot be undone. An event with existing registrations cannot be deleted — deactivate it instead."
        tone="danger"
        confirmLabel="Delete"
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Pre-create selection of the standard categories / events
// ---------------------------------------------------------------------------

function DraftCategoriesEditor({
  categories,
  onChange,
  loading,
  error,
}: {
  categories: DraftCategory[]
  onChange: (next: DraftCategory[]) => void
  loading: boolean
  error: string | null
}) {
  const [draft, setDraft] = useState(EMPTY_CATEGORY)

  const selectedCount = categories.filter((category) => category.included).length
  const canAdd = draft.name.trim().length > 0 && draft.min_age !== '' && draft.max_age !== ''

  const toggle = (key: string, included: boolean) =>
    onChange(categories.map((category) => (category.key === key ? { ...category, included } : category)))

  const add = () => {
    if (!canAdd) return
    onChange([
      ...categories,
      {
        key: nextDraftKey(),
        name: draft.name.trim(),
        gender: draft.gender,
        min_age: draft.min_age,
        max_age: draft.max_age,
        fee_rupees: draft.fee_rupees || '0',
        is_active: draft.is_active,
        included: true,
        isDefault: false,
      },
    ])
    setDraft(EMPTY_CATEGORY)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Age categories for this championship</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          The standard categories are pre-selected. Uncheck any this championship should not offer, or add an extra one.
          Everything can be changed again after saving.
        </p>
        <p className="text-xs font-medium text-slate-500">{selectedCount} selected</p>

        {error && <Alert tone="warning">{error}</Alert>}

        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner label="Loading standard categories" />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {categories.map((category) => (
              <li key={category.key} className="flex items-start justify-between gap-3 py-2">
                <Checkbox
                  className="min-w-0 flex-1"
                  checked={category.included}
                  onChange={(event) => toggle(category.key, event.target.checked)}
                  label={
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-800">
                        {category.name}
                        {!category.isDefault && (
                          <span className="ml-2 text-xs font-normal text-emerald-700">(added)</span>
                        )}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {genderLabel(category.gender)} · {category.min_age}–{category.max_age} yrs ·{' '}
                        {formatMoney(rupeesToPaise(category.fee_rupees), 'INR')}
                      </span>
                    </span>
                  }
                />
                {!category.isDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange(categories.filter((item) => item.key !== category.key))}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">Add a category</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="draft-cat-name" className="sm:col-span-2">
              <Input
                id="draft-cat-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Under 20 Boys"
              />
            </Field>
            <Field label="Gender" htmlFor="draft-cat-gender">
              <Select
                id="draft-cat-gender"
                value={draft.gender}
                onChange={(event) => setDraft({ ...draft, gender: event.target.value })}
              >
                <option value="any">Any</option>
                <option value="male">Men</option>
                <option value="female">Women</option>
              </Select>
            </Field>
            <Field label="Fee (₹)" htmlFor="draft-cat-fee">
              <Input
                id="draft-cat-fee"
                inputMode="decimal"
                value={draft.fee_rupees}
                onChange={(event) => setDraft({ ...draft, fee_rupees: event.target.value.replace(/[^\d.]/g, '') })}
              />
            </Field>
            <Field label="Min age" htmlFor="draft-cat-min">
              <Input
                id="draft-cat-min"
                inputMode="numeric"
                value={draft.min_age}
                onChange={(event) => setDraft({ ...draft, min_age: event.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <Field label="Max age" htmlFor="draft-cat-max">
              <Input
                id="draft-cat-max"
                inputMode="numeric"
                value={draft.max_age}
                onChange={(event) => setDraft({ ...draft, max_age: event.target.value.replace(/\D/g, '') })}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Button variant="accent" size="sm" disabled={!canAdd} onClick={add}>
              Add category
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DraftEventsEditor({
  events,
  onChange,
  loading,
  error,
}: {
  events: DraftEvent[]
  onChange: (next: DraftEvent[]) => void
  loading: boolean
  error: string | null
}) {
  const [draft, setDraft] = useState(EMPTY_EVENT)

  const selectedCount = events.filter((event) => event.included).length
  const canAdd = draft.name.trim().length > 0

  const toggle = (key: string, included: boolean) =>
    onChange(events.map((event) => (event.key === key ? { ...event, included } : event)))

  const add = () => {
    if (!canAdd) return
    onChange([
      ...events,
      {
        key: nextDraftKey(),
        name: draft.name.trim(),
        gender: draft.gender,
        fee_rupees: draft.fee_rupees || '0',
        is_active: draft.is_active,
        included: true,
        isDefault: false,
      },
    ])
    setDraft(EMPTY_EVENT)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Events for this championship</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          The standard events are pre-selected. Uncheck any this championship should not run, or add an extra one. Gender
          restrictions and per-category limits can be set after saving.
        </p>
        <p className="text-xs font-medium text-slate-500">{selectedCount} selected</p>

        {error && <Alert tone="warning">{error}</Alert>}

        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner label="Loading standard events" />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {events.map((item) => (
              <li key={item.key} className="flex items-start justify-between gap-3 py-2">
                <Checkbox
                  className="min-w-0 flex-1"
                  checked={item.included}
                  onChange={(event) => toggle(item.key, event.target.checked)}
                  label={
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-800">
                        {item.name}
                        {!item.isDefault && <span className="ml-2 text-xs font-normal text-emerald-700">(added)</span>}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {genderLabel(item.gender)} · {formatMoney(rupeesToPaise(item.fee_rupees), 'INR')}
                      </span>
                    </span>
                  }
                />
                {!item.isDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange(events.filter((entry) => entry.key !== item.key))}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">Add an event</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="draft-evt-name" className="sm:col-span-2">
              <Input
                id="draft-evt-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Pole Vault"
              />
            </Field>
            <Field label="Gender" htmlFor="draft-evt-gender">
              <Select
                id="draft-evt-gender"
                value={draft.gender}
                onChange={(event) => setDraft({ ...draft, gender: event.target.value })}
              >
                <option value="any">Any</option>
                <option value="male">Men</option>
                <option value="female">Women</option>
              </Select>
            </Field>
            <Field label="Fee (₹)" htmlFor="draft-evt-fee">
              <Input
                id="draft-evt-fee"
                inputMode="decimal"
                value={draft.fee_rupees}
                onChange={(event) => setDraft({ ...draft, fee_rupees: event.target.value.replace(/[^\d.]/g, '') })}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Button variant="accent" size="sm" disabled={!canAdd} onClick={add}>
              Add event
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
