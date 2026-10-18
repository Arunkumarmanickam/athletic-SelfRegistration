import { Field, Input, useFieldId } from '@/components/ui/input'
import { Select } from '@/components/ui/form-controls'
import { COUNTRY_CODES, GENDER_OPTIONS, INDIAN_STATES } from '@/lib/constants'
import type { FormConfig } from '@/lib/types'
import type { PersonalStepValues } from '@/lib/validation'

export interface PersonalStepProps {
  values: PersonalStepValues
  errors: Record<string, string>
  formConfig: FormConfig
  onChange: (patch: Partial<PersonalStepValues>) => void
}

/**
 * Step 1 — who is registering. Field visibility and which fields are mandatory
 * are driven entirely by the championship's form_config, so organisers can
 * tailor the form without code changes.
 */
export function PersonalStep({ values, errors, formConfig, onChange }: PersonalStepProps) {
  const nameId = useFieldId('full_name')
  const dobId = useFieldId('date_of_birth')
  const genderId = useFieldId('gender')
  const countryId = useFieldId('mobile_country_code')
  const mobileId = useFieldId('mobile_number')
  const emailId = useFieldId('email')
  const stateId = useFieldId('state')
  const districtId = useFieldId('district')
  const addressId = useFieldId('address')
  const representingId = useFieldId('representing')

  const set = (patch: Partial<PersonalStepValues>) => onChange(patch)
  const today = new Date().toISOString().slice(0, 10)
  const showDistrict = formConfig.show_district !== false

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Full name" htmlFor={nameId} required error={errors.full_name} className="sm:col-span-2">
        <Input
          id={nameId}
          name="full_name"
          autoComplete="name"
          value={values.full_name}
          invalid={Boolean(errors.full_name)}
          onChange={(event) => set({ full_name: event.target.value })}
          placeholder="As it should appear on results and the bib"
        />
      </Field>

      <Field label="Date of birth" htmlFor={dobId} required error={errors.date_of_birth} hint="Used to place the athlete in the correct age category.">
        <Input
          id={dobId}
          name="date_of_birth"
          type="date"
          max={today}
          value={values.date_of_birth}
          invalid={Boolean(errors.date_of_birth)}
          onChange={(event) => set({ date_of_birth: event.target.value })}
        />
      </Field>

      <Field label="Gender" htmlFor={genderId} required error={errors.gender}>
        <Select
          id={genderId}
          name="gender"
          value={values.gender}
          invalid={Boolean(errors.gender)}
          onChange={(event) => set({ gender: event.target.value })}
        >
          <option value="">Select gender</option>
          {GENDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Mobile country code" htmlFor={countryId} required error={errors.mobile_country_code}>
        <Select
          id={countryId}
          name="mobile_country_code"
          value={values.mobile_country_code}
          invalid={Boolean(errors.mobile_country_code)}
          onChange={(event) => set({ mobile_country_code: event.target.value })}
        >
          {COUNTRY_CODES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Mobile number"
        htmlFor={mobileId}
        required
        error={errors.mobile_number}
        hint="Use this number with your date of birth to retrieve your details later."
      >
        <Input
          id={mobileId}
          name="mobile_number"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={values.mobile_number}
          invalid={Boolean(errors.mobile_number)}
          onChange={(event) => set({ mobile_number: event.target.value.replace(/[^\d]/g, '') })}
          placeholder="9876543210"
        />
      </Field>

      <Field
        label="Email address"
        htmlFor={emailId}
        required={formConfig.require_email === true}
        error={errors.email}
        hint={formConfig.require_email ? undefined : 'Optional — used for the payment confirmation email.'}
        className="sm:col-span-2"
      >
        <Input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          value={values.email}
          invalid={Boolean(errors.email)}
          onChange={(event) => set({ email: event.target.value })}
          placeholder="name@example.com"
        />
      </Field>

      <Field label="State / region" htmlFor={stateId} required error={errors.state}>
        <Input
          id={stateId}
          name="state"
          list="state-options"
          autoComplete="address-level1"
          value={values.state}
          invalid={Boolean(errors.state)}
          onChange={(event) => set({ state: event.target.value })}
          placeholder="Start typing your state"
        />
      </Field>

      {showDistrict && (
        <Field label="District" htmlFor={districtId} error={errors.district} hint="Optional">
          <Input
            id={districtId}
            name="district"
            autoComplete="address-level2"
            value={values.district}
            invalid={Boolean(errors.district)}
            onChange={(event) => set({ district: event.target.value })}
          />
        </Field>
      )}

      <Field
        label="Address"
        htmlFor={addressId}
        required={formConfig.require_address === true}
        error={errors.address}
        className="sm:col-span-2"
      >
        <Input
          id={addressId}
          name="address"
          autoComplete="street-address"
          value={values.address}
          invalid={Boolean(errors.address)}
          onChange={(event) => set({ address: event.target.value })}
          placeholder="House / street / city / PIN"
        />
      </Field>

      <Field
        label="Representing"
        htmlFor={representingId}
        required={formConfig.require_representing === true}
        error={errors.representing}
        hint="Club, association, school or state you represent. Optional unless required by the organiser."
        className="sm:col-span-2"
      >
        <Input
          id={representingId}
          name="representing"
          value={values.representing}
          invalid={Boolean(errors.representing)}
          onChange={(event) => set({ representing: event.target.value })}
        />
      </Field>

      {/* Suggestions only: the field accepts any region, not just Indian states. */}
      <datalist id="state-options">
        {INDIAN_STATES.map((state) => (
          <option key={state} value={state} />
        ))}
      </datalist>
    </div>
  )
}
