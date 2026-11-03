import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Alert, Card, CardContent, CardHeader, CardTitle, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { PageHeader } from '@/components/admin/PageHeader'
import { ApiError, adminSettings } from '@/lib/api'
import { athleteIdExample } from '@/lib/athleteId'
import { splitPhones } from '@/lib/site'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useToast } from '@/context/ToastContext'

interface SiteSettings {
  organizer_name: string
  support_email: string
  /** One entry per published number; always has at least one row. */
  support_phones: string[]
  address: string
}

interface AthleteIdFormat {
  prefix: string
  sequence_length: number
}

/** Enough for every committee member, small enough to stay tidy in the UI. */
const MAX_PHONES = 10

const EMPTY_SITE: SiteSettings = { organizer_name: '', support_email: '', support_phones: [''], address: '' }
const DEFAULT_FORMAT: AthleteIdFormat = { prefix: 'ATH', sequence_length: 6 }

function readSettings(raw: Record<string, unknown>): { site: SiteSettings; format: AthleteIdFormat } {
  const siteRaw = (raw.site ?? {}) as Record<string, unknown>
  const formatRaw = (raw.athlete_id_format ?? {}) as Record<string, unknown>

  const savedPhones = Array.isArray(siteRaw.support_phones)
    ? siteRaw.support_phones.map((phone) => String(phone ?? '').trim()).filter(Boolean)
    : []
  const legacyPhone = String(siteRaw.support_phone ?? '').trim()
  // Older settings kept several numbers in one comma-separated field; split it
  // so each number gets its own input row.
  const phones = splitPhones(savedPhones.length > 0 ? savedPhones : legacyPhone)
  if (phones.length === 0) phones.push('')

  return {
    site: {
      organizer_name: String(siteRaw.organizer_name ?? ''),
      support_email: String(siteRaw.support_email ?? ''),
      support_phones: phones,
      address: String(siteRaw.address ?? ''),
    },
    format: {
      prefix: String(formatRaw.prefix ?? DEFAULT_FORMAT.prefix),
      sequence_length: Number(formatRaw.sequence_length ?? DEFAULT_FORMAT.sequence_length) || DEFAULT_FORMAT.sequence_length,
    },
  }
}

/**
 * Organisation-wide settings. Site details appear on the public site and
 * receipts; the Athlete ID format controls how new permanent Athlete IDs are
 * generated (existing IDs never change).
 */
export function SettingsPage() {
  const toast = useToast()
  const { admin } = useAdminAuth()
  const readOnly = admin?.role === 'viewer'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [site, setSite] = useState<SiteSettings>(EMPTY_SITE)
  const [format, setFormat] = useState<AthleteIdFormat>(DEFAULT_FORMAT)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = (await adminSettings({ action: 'settings_get' })) as { settings: Record<string, unknown> }
      const parsed = readSettings(result.settings ?? {})
      setSite(parsed.site)
      setFormat(parsed.format)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async () => {
    setSaving(true)
    try {
      const phones = site.support_phones.map((phone) => phone.trim()).filter(Boolean)
      await adminSettings({
        action: 'settings_update',
        settings: {
          site: {
            organizer_name: site.organizer_name.trim(),
            support_email: site.support_email.trim(),
            // `support_phone` stays the first number for older clients and the
            // receipt templates; `support_phones` is the full published list.
            support_phone: phones[0] ?? '',
            support_phones: phones,
            address: site.address.trim(),
          },
          athlete_id_format: {
            prefix: format.prefix.trim().toUpperCase() || 'ATH',
            sequence_length: format.sequence_length,
          },
        },
      })
      toast.success('Settings saved')
      await load()
    } catch (err) {
      toast.error('Could not save settings', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const previewId = athleteIdExample(format)

  const setPhone = (index: number, value: string) => {
    setSite((current) => {
      const next = [...current.support_phones]
      next[index] = value
      return { ...current, support_phones: next }
    })
  }

  const addPhone = () => {
    setSite((current) =>
      current.support_phones.length >= MAX_PHONES
        ? current
        : { ...current, support_phones: [...current.support_phones, ''] },
    )
  }

  const removePhone = (index: number) => {
    setSite((current) =>
      current.support_phones.length <= 1
        ? current
        : { ...current, support_phones: current.support_phones.filter((_, i) => i !== index) },
    )
  }

  return (
    <div>
      <PageHeader title="Settings" />

      {readOnly && (
        <Alert tone="info" className="mb-5">
          You are signed in with a read-only (viewer) account. Settings cannot be changed.
        </Alert>
      )}

      {error && (
        <Alert tone="danger" title="Could not load settings" className="mb-5">
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Loading settings" />
        </div>
      ) : (
        <form
          className="grid gap-5 lg:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!readOnly) void handleSave()
          }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Organisation &amp; support</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Organiser name" htmlFor="set-organiser" hint="Shown in the site header and on receipts.">
                <Input
                  id="set-organiser"
                  value={site.organizer_name}
                  disabled={readOnly}
                  onChange={(event) => setSite({ ...site, organizer_name: event.target.value })}
                />
              </Field>
              <Field label="Support email" htmlFor="set-email">
                <Input
                  id="set-email"
                  type="email"
                  value={site.support_email}
                  disabled={readOnly}
                  onChange={(event) => setSite({ ...site, support_email: event.target.value })}
                />
              </Field>
              <Field
                label="Support phone numbers"
                htmlFor="set-phone-0"
                hint="Shown in the site footer, the contact page and on receipts. Add as many numbers as you need."
              >
                <div className="space-y-2">
                  {site.support_phones.map((phone, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        id={`set-phone-${index}`}
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder={index === 0 ? 'e.g. +91 98765 43210' : 'Another number'}
                        value={phone}
                        disabled={readOnly}
                        onChange={(event) => setPhone(index, event.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove phone number ${index + 1}`}
                        title="Remove this number"
                        disabled={readOnly || site.support_phones.length === 1}
                        onClick={() => removePhone(index)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={readOnly || site.support_phones.length >= MAX_PHONES}
                    onClick={addPhone}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add mobile number
                  </Button>
                  {site.support_phones.length >= MAX_PHONES && (
                    <p className="text-xs text-slate-500">Up to {MAX_PHONES} numbers can be shown.</p>
                  )}
                </div>
              </Field>
              <Field label="Postal address" htmlFor="set-address">
                <Input
                  id="set-address"
                  value={site.address}
                  disabled={readOnly}
                  onChange={(event) => setSite({ ...site, address: event.target.value })}
                />
              </Field>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Athlete ID format</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <Alert tone="warning">
                  This affects only newly issued Athlete IDs. Existing athletes keep their current permanent Athlete ID
                  forever. Changing the prefix can make IDs look different between sports seasons.
                </Alert>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Prefix" htmlFor="set-prefix" hint="Up to 8 letters/numbers.">
                    <Input
                      id="set-prefix"
                      value={format.prefix}
                      maxLength={8}
                      disabled={readOnly}
                      onChange={(event) => setFormat({ ...format, prefix: event.target.value.toUpperCase() })}
                    />
                  </Field>
                  <Field label="Sequence digits" htmlFor="set-seq" hint="3–12 digits.">
                    <Input
                      id="set-seq"
                      inputMode="numeric"
                      value={String(format.sequence_length)}
                      disabled={readOnly}
                      onChange={(event) =>
                        setFormat({
                          ...format,
                          sequence_length: Number(event.target.value.replace(/\D/g, '')) || 0,
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Next Athlete ID looks like</p>
                  <p className="mt-1 font-mono text-lg font-semibold text-slate-900">{previewId}</p>
                </div>
              </CardContent>
            </Card>

            {!readOnly && (
              <div className="flex justify-end">
                <Button type="submit" variant="accent" loading={saving}>
                  Save settings
                </Button>
              </div>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
