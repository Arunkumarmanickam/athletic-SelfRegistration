import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/form-controls'
import { ConfirmDialog } from '@/components/ui/dialog'
import { PageHeader } from '@/components/admin/PageHeader'
import { ApiError, adminAthleteDetail, adminUpdateAthlete } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { COUNTRY_CODES } from '@/lib/constants'
import {
  formatDate,
  formatDateTime,
  formatMoney,
  genderLabel,
  paymentStatusTone,
  registrationStatusTone,
  titleCase,
  toE164,
} from '@/lib/format'
import type { AthleteProfile } from '@/lib/types'

interface AthleteRegistration {
  id: string
  registration_code: string
  status: string
  payment_status: string
  fee_paise: number
  currency: string
  registered_at: string
  confirmed_at: string | null
  championships: { id: string; name: string } | null
  championship_categories: { name: string } | null
  registration_events: { event_name: string }[] | null
}

interface EditState {
  full_name: string
  date_of_birth: string
  gender: string
  mobile_country_code: string
  mobile_number: string
  email: string
  state: string
  district: string
  address: string
  representing: string
  emergency_contact_name: string
  emergency_contact_phone: string
}

function toEditState(profile: AthleteProfile): EditState {
  return {
    full_name: profile.full_name,
    date_of_birth: profile.date_of_birth,
    gender: profile.gender,
    mobile_country_code: profile.mobile_country_code || '+91',
    mobile_number: profile.mobile_number,
    email: profile.email ?? '',
    state: profile.state ?? '',
    district: profile.district ?? '',
    address: profile.address ?? '',
    representing: profile.representing ?? '',
    emergency_contact_name: profile.emergency_contact_name ?? '',
    emergency_contact_phone: profile.emergency_contact_phone ?? '',
  }
}

export function AthleteDetailPage() {
  const { athleteId = '' } = useParams<{ athleteId: string }>()
  const navigate = useNavigate()
  const toast = useToast()

  const [profile, setProfile] = useState<AthleteProfile | null>(null)
  const [registrations, setRegistrations] = useState<AthleteRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [edit, setEdit] = useState<EditState | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const load = useCallback(async () => {
    if (!athleteId) return
    setLoading(true)
    try {
      const result = await adminAthleteDetail(athleteId)
      const loaded = result.profile as AthleteProfile
      setProfile(loaded)
      setRegistrations(result.registrations as unknown as AthleteRegistration[])
      setEdit(toEditState(loaded))
      setReason('')
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this athlete.')
    } finally {
      setLoading(false)
    }
  }, [athleteId])

  useEffect(() => {
    void load()
  }, [load])

  // Recompute the canonical E.164 value whenever the dial code or number changes.
  const mobileE164 = useMemo(
    () => (edit ? toE164(edit.mobile_country_code, edit.mobile_number) : ''),
    [edit],
  )

  const changes = useMemo(() => {
    if (!profile || !edit) return {}
    const original = toEditState(profile)
    const fields: Record<string, unknown> = {}
    for (const key of Object.keys(edit) as (keyof EditState)[]) {
      if (edit[key] !== original[key]) fields[key] = edit[key]
    }
    if ((mobileE164 ?? '') !== (profile.mobile_e164 ?? '')) fields.mobile_e164 = mobileE164
    return fields
  }, [profile, edit, mobileE164])

  const dirty = Object.keys(changes).length > 0

  const handleSave = async () => {
    if (!dirty) {
      setConfirmOpen(false)
      return
    }
    if (!reason.trim()) {
      toast.error('Reason required', 'Please explain why the profile is being edited.')
      setConfirmOpen(false)
      return
    }
    setSaving(true)
    try {
      await adminUpdateAthlete({ athleteId, fields: changes, reason: reason.trim() })
      toast.success('Profile updated')
      setConfirmOpen(false)
      await load()
    } catch (err) {
      toast.error('Could not update profile', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="Loading athlete" />
      </div>
    )
  }

  if (loadError || !profile || !edit) {
    return (
      <div>
        <Alert tone="danger" title="Could not load this athlete">
          {loadError ?? 'Athlete not found.'}
        </Alert>
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate('/admin/athletes')}>
            Back to athletes
          </Button>
        </div>
      </div>
    )
  }

  const setField = (patch: Partial<EditState>) => setEdit((current) => (current ? { ...current, ...patch } : current))

  return (
    <div>
      <PageHeader
        title={profile.full_name}
        description={`Athlete ID ${profile.athlete_id}`}
        actions={
          <Link to="/admin/athletes">
            <Button variant="outline" size="sm">
              ← All athletes
            </Button>
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Registrations</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {registrations.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-600">This athlete has no registrations yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2.5">Registration ID</th>
                        <th className="px-3 py-2.5">Championship</th>
                        <th className="px-3 py-2.5">Fee</th>
                        <th className="px-3 py-2.5">Payment</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Registered</th>
                        <th className="px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {registrations.map((registration) => (
                        <tr key={registration.id} className="border-b border-slate-100">
                          <td className="px-3 py-2.5 font-mono text-xs font-semibold text-slate-900">
                            {registration.registration_code}
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">
                            {registration.championships?.name ?? '—'}
                            {registration.championship_categories?.name && (
                              <span className="block text-xs text-slate-500">
                                {registration.championship_categories.name}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-slate-700">
                            {formatMoney(registration.fee_paise, registration.currency)}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge tone={paymentStatusTone(registration.payment_status)}>
                              {titleCase(registration.payment_status)}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge tone={registrationStatusTone(registration.status)}>
                              {titleCase(registration.status)}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">
                            {formatDate(registration.registered_at)}
                          </td>
                          <td className="px-3 py-2.5">
                            <Link
                              to={`/admin/registrations/${registration.id}`}
                              className="text-sm font-medium text-orange-700 hover:underline"
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                {(
                  [
                    ['Created', formatDateTime((profile as unknown as { created_at?: string }).created_at)],
                    ['Last updated', formatDateTime((profile as unknown as { updated_at?: string }).updated_at)],
                    ['Current mobile', profile.mobile_e164],
                    ['Current gender', genderLabel(profile.gender)],
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                    <dd className="mt-0.5 break-words text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Edit profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Full name" htmlFor="a-name" required>
                <Input id="a-name" value={edit.full_name} onChange={(event) => setField({ full_name: event.target.value })} />
              </Field>
              <Field label="Date of birth" htmlFor="a-dob" required>
                <Input
                  id="a-dob"
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={edit.date_of_birth}
                  onChange={(event) => setField({ date_of_birth: event.target.value })}
                />
              </Field>
              <Field label="Gender" htmlFor="a-gender" required>
                <Select id="a-gender" value={edit.gender} onChange={(event) => setField({ gender: event.target.value })}>
                  <option value="male">Men</option>
                  <option value="female">Women</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Country code" htmlFor="a-cc">
                  <Select
                    id="a-cc"
                    value={edit.mobile_country_code}
                    onChange={(event) => setField({ mobile_country_code: event.target.value })}
                  >
                    {COUNTRY_CODES.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Mobile number" htmlFor="a-mobile" hint={mobileE164 ? `Stored as ${mobileE164}` : undefined}>
                  <Input
                    id="a-mobile"
                    inputMode="numeric"
                    value={edit.mobile_number}
                    onChange={(event) => setField({ mobile_number: event.target.value.replace(/[^\d]/g, '') })}
                  />
                </Field>
              </div>
              <Field label="Email" htmlFor="a-email">
                <Input id="a-email" type="email" value={edit.email} onChange={(event) => setField({ email: event.target.value })} />
              </Field>
              <Field label="State / region" htmlFor="a-state" required>
                <Input id="a-state" value={edit.state} onChange={(event) => setField({ state: event.target.value })} />
              </Field>
              <Field label="District" htmlFor="a-district">
                <Input id="a-district" value={edit.district} onChange={(event) => setField({ district: event.target.value })} />
              </Field>
              <Field label="Address" htmlFor="a-address">
                <Input id="a-address" value={edit.address} onChange={(event) => setField({ address: event.target.value })} />
              </Field>
              <Field label="Representing" htmlFor="a-rep">
                <Input id="a-rep" value={edit.representing} onChange={(event) => setField({ representing: event.target.value })} />
              </Field>
              <Field label="Emergency contact name" htmlFor="a-ec-name">
                <Input
                  id="a-ec-name"
                  value={edit.emergency_contact_name}
                  onChange={(event) => setField({ emergency_contact_name: event.target.value })}
                />
              </Field>
              <Field label="Emergency contact phone" htmlFor="a-ec-phone">
                <Input
                  id="a-ec-phone"
                  value={edit.emergency_contact_phone}
                  onChange={(event) => setField({ emergency_contact_phone: event.target.value })}
                />
              </Field>
              <Field
                label="Reason for change"
                htmlFor="a-reason"
                required
                hint="Recorded in the audit trail."
              >
                <Input
                  id="a-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. Corrected spelling per email request"
                />
              </Field>
              <Button
                variant="primary"
                disabled={!dirty}
                onClick={() => {
                  if (!reason.trim()) {
                    toast.error('Reason required', 'Please explain why the profile is being edited.')
                    return
                  }
                  setConfirmOpen(true)
                }}
              >
                Review changes
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Save profile changes?"
        description="The change and your reason will be recorded in the audit trail."
        confirmLabel="Save changes"
        loading={saving}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void handleSave()}
      >
        <ul className="space-y-1 text-sm text-slate-700">
          {Object.keys(changes).map((key) => (
            <li key={key}>
              <span className="font-medium">{key.replaceAll('_', ' ')}</span> updated
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  )
}
