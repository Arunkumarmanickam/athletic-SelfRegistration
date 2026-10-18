import { Field, Input, useFieldId } from '@/components/ui/input'
import { EventMultiSelect } from '@/components/ui/event-multi-select'
import { formatAge, formatDate, formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Championship, ChampionshipCategory, FormConfig } from '@/lib/types'
import type { ParticipationStepValues } from '@/lib/validation'

export interface ParticipationStepProps {
  values: ParticipationStepValues
  errors: Record<string, string>
  championship: Championship
  gender: string
  dateOfBirth: string
  onChange: (patch: Partial<ParticipationStepValues>) => void
}

/** Resolves the date on which age eligibility is evaluated. */
export function ageCutoffDate(championship: Championship): string {
  const config: FormConfig = championship.form_config ?? {}
  if (config.age_calculation_mode === 'fixed' && config.age_calculation_date) {
    return config.age_calculation_date
  }
  return championship.starts_on ?? new Date().toISOString().slice(0, 10)
}

interface CategoryOption {
  category: ChampionshipCategory
  eligible: boolean
  reason: string | null
}

function evaluateCategories(
  categories: ChampionshipCategory[],
  gender: string,
  age: number | null,
): CategoryOption[] {
  return categories.map((category) => {
    const genderOk = category.gender === 'any' || category.gender === gender
    const ageOk = age === null ? true : age >= category.min_age && age <= category.max_age
    const reason = !genderOk
      ? 'Not open to your gender'
      : !ageOk
        ? `For ages ${category.min_age}–${category.max_age}`
        : null
    return { category, eligible: genderOk && ageOk, reason }
  })
}

/**
 * Step 2 — category and events. Eligibility (gender and age) is shown live and
 * mirrors the server-side rules; the server re-checks everything on submit.
 */
export function ParticipationStep({
  values,
  errors,
  championship,
  gender,
  dateOfBirth,
  onChange,
}: ParticipationStepProps) {
  const emergencyNameId = useFieldId('emergency_contact_name')
  const emergencyPhoneId = useFieldId('emergency_contact_phone')

  const formConfig = championship.form_config ?? {}
  const age = dateOfBirth ? Number(formatAge(dateOfBirth, ageCutoffDate(championship))) : null
  const options = evaluateCategories(championship.championship_categories, gender, age)
  const selectedEvents = championship.championship_events.filter((event) =>
    values.event_ids.includes(event.id),
  )

  const toggleEvent = (eventId: string) => {
    const next = values.event_ids.includes(eventId)
      ? values.event_ids.filter((id) => id !== eventId)
      : [...values.event_ids, eventId]
    onChange({ event_ids: next })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Age category</h3>
        <p className="mt-1 text-sm text-slate-600">
          Age is calculated on {formatDate(ageCutoffDate(championship))}
          {age !== null && <> — you are {age} years old on that date</>}.
        </p>

        <div
          role="radiogroup"
          aria-label="Age category"
          aria-invalid={Boolean(errors.category_id) || undefined}
          className={cn(
            'mt-3 space-y-2 rounded-lg border p-2',
            errors.category_id ? 'border-red-400' : 'border-slate-200',
          )}
        >
          {options.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              No categories are configured for this championship yet.
            </p>
          )}
          {options.map(({ category, eligible, reason }) => {
            const checked = values.category_id === category.id
            return (
              <label
                key={category.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                  eligible ? 'hover:bg-slate-50' : 'cursor-not-allowed opacity-60',
                  checked && eligible && 'bg-orange-50/70',
                )}
              >
                <input
                  type="radio"
                  name="category_id"
                  className="mt-0.5 h-4.5 w-4.5 shrink-0 border-slate-300 text-orange-600 focus:ring-orange-500"
                  value={category.id}
                  checked={checked}
                  disabled={!eligible}
                  onChange={() => onChange({ category_id: category.id })}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-800">{category.name}</span>
                  <span className="block text-xs text-slate-500">
                    Ages {category.min_age}–{category.max_age}
                    {' · '}
                    {category.fee_paise > 0 ? `${formatMoney(category.fee_paise, championship.currency)} category fee` : 'No category fee'}
                    {category.gender !== 'any' && ` · ${category.gender === 'male' ? 'Boys/Men' : 'Girls/Women'}`}
                    {reason && !eligible && ` · ${reason}`}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
        {errors.category_id && (
          <p className="mt-1 text-xs font-medium text-red-600" role="alert">
            {errors.category_id}
          </p>
        )}
      </div>

      <div>
        <h3 className="text-base font-semibold text-slate-900">Events</h3>
        <p className="mt-1 text-sm text-slate-600">
          Choose one or more events. Events that are not open to your gender or category are shown but disabled.
        </p>
        <div className="mt-3">
          <EventMultiSelect
            events={championship.championship_events}
            selectedIds={values.event_ids}
            onToggle={toggleEvent}
            gender={gender}
            categoryId={values.category_id}
            invalid={Boolean(errors.event_ids)}
          />
        </div>
        {errors.event_ids && (
          <p className="mt-1 text-xs font-medium text-red-600" role="alert">
            {errors.event_ids}
          </p>
        )}
        {selectedEvents.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Selected: {selectedEvents.map((event) => event.name).join(', ')}
          </p>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Emergency contact name"
          htmlFor={emergencyNameId}
          required={formConfig.require_emergency === true}
          error={errors.emergency_contact_name}
        >
          <Input
            id={emergencyNameId}
            name="emergency_contact_name"
            value={values.emergency_contact_name}
            invalid={Boolean(errors.emergency_contact_name)}
            onChange={(event) => onChange({ emergency_contact_name: event.target.value })}
          />
        </Field>
        <Field
          label="Emergency contact phone"
          htmlFor={emergencyPhoneId}
          required={formConfig.require_emergency === true}
          error={errors.emergency_contact_phone}
        >
          <Input
            id={emergencyPhoneId}
            name="emergency_contact_phone"
            type="tel"
            value={values.emergency_contact_phone}
            invalid={Boolean(errors.emergency_contact_phone)}
            onChange={(event) => onChange({ emergency_contact_phone: event.target.value })}
          />
        </Field>
      </div>
    </div>
  )
}
