import { Checkbox } from '@/components/ui/form-controls'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/display'
import { FeeSummary } from './FeeSummary'
import { formatDate, genderLabel } from '@/lib/format'
import type { Championship, ChampionshipCategory, ChampionshipEvent } from '@/lib/types'
import type { ParticipationStepValues, PersonalStepValues, ReviewStepValues } from '@/lib/validation'

export interface ReviewStepProps {
  values: ReviewStepValues
  errors: Record<string, string>
  onChange: (patch: Partial<ReviewStepValues>) => void
  championship: Championship
  category: ChampionshipCategory | null
  events: ChampionshipEvent[]
  personal: PersonalStepValues
  participation: ParticipationStepValues
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="w-48 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-800">{value || '—'}</dd>
    </div>
  )
}

/**
 * Step 3 — a final, plain-language review of everything that will be submitted
 * (and sent to the server, which recalculates the fee independently).
 */
export function ReviewStep({
  values,
  errors,
  onChange,
  championship,
  category,
  events,
  personal,
  participation,
}: ReviewStepProps) {
  const mobile = `${personal.mobile_country_code} ${personal.mobile_number}`.trim()

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Athlete details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-slate-100">
            <Row label="Full name" value={personal.full_name} />
            <Row label="Date of birth" value={formatDate(personal.date_of_birth)} />
            <Row label="Gender" value={genderLabel(personal.gender)} />
            <Row label="Mobile" value={mobile} />
            <Row label="Email" value={personal.email} />
            <Row label="State" value={personal.state} />
            {personal.district && <Row label="District" value={personal.district} />}
            {personal.address && <Row label="Address" value={personal.address} />}
            {personal.representing && <Row label="Representing" value={personal.representing} />}
            {participation.emergency_contact_name && (
              <Row
                label="Emergency contact"
                value={`${participation.emergency_contact_name}${
                  participation.emergency_contact_phone ? ` · ${participation.emergency_contact_phone}` : ''
                }`}
              />
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Championship entry</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-slate-100">
            <Row label="Championship" value={championship.name} />
            <Row label="Category" value={category?.name ?? '—'} />
            <Row label="Events" value={events.map((event) => event.name).join(', ')} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fee summary</CardTitle>
        </CardHeader>
        <CardContent>
          <FeeSummary championship={championship} category={category} events={events} />
        </CardContent>
      </Card>

      <div className="space-y-4">
        {championship.terms_text && (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="mb-2 font-semibold text-slate-900">Terms and conditions</p>
            <div className="whitespace-pre-line">{championship.terms_text}</div>
          </div>
        )}
        <Checkbox
          checked={values.accept_terms}
          error={errors.accept_terms}
          onChange={(event) => onChange({ accept_terms: event.target.checked })}
          label={
            <>
              I have read and accept the terms and conditions
              {championship.terms_text ? '' : ' and the privacy policy'} for this championship.
            </>
          }
        />
        <Checkbox
          checked={values.confirm_details}
          error={errors.confirm_details}
          onChange={(event) => onChange({ confirm_details: event.target.checked })}
          label="I confirm that the details above are correct and complete."
        />
      </div>
    </div>
  )
}
