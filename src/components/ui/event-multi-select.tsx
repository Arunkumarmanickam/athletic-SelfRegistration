import { Fragment, useMemo, useState } from 'react'
import type { ChampionshipEvent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/format'

export interface EventMultiSelectProps {
  events: ChampionshipEvent[]
  selectedIds: string[]
  onToggle: (eventId: string) => void
  gender: string
  categoryId: string
  invalid?: boolean
  /** When true, ineligible events are shown but disabled with a reason. */
  showIneligible?: boolean
  /** Hard cap on how many events may be selected (null/undefined = unlimited). */
  maxSelected?: number | null
}

/**
 * Multi-select event picker with live eligibility feedback (gender and
 * category restrictions come from the championship configuration).
 */
export function EventMultiSelect({
  events,
  selectedIds,
  onToggle,
  gender,
  categoryId,
  invalid,
  showIneligible = true,
  maxSelected = null,
}: EventMultiSelectProps) {
  const [search, setSearch] = useState('')

  const decorated = useMemo(() => {
    const items = events.map((event) => {
      const genderOk = event.gender === 'any' || event.gender === gender
      // Prefer the list for the athlete's gender, falling back to the legacy
      // shared list only when neither gender-specific list is configured.
      const genderList =
        gender === 'male'
          ? event.male_category_ids
          : gender === 'female'
            ? event.female_category_ids
            : null
      const applicable = genderList ?? event.category_ids
      const categoryOk =
        !applicable || applicable.length === 0 || applicable.includes(categoryId)
      const reason = !genderOk
        ? 'Not open to your gender'
        : !categoryOk
          ? 'Not offered in your category'
          : null
      return { event, eligible: !reason, reason }
    })
    // Registrable events first; the stable sort keeps the programme order
    // within each group so the list only moves when eligibility changes.
    return items.sort((a, b) => Number(b.eligible) - Number(a.eligible))
  }, [events, gender, categoryId])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = term
      ? decorated.filter((item) => item.event.name.toLowerCase().includes(term))
      : decorated
    return showIneligible ? filtered : filtered.filter((item) => item.eligible)
  }, [decorated, search, showIneligible])

  const selectedLabel = `${selectedIds.length}${maxSelected != null ? ` / ${maxSelected}` : ''} selected`

  // Sticky chips follow the catalogue order so they never jump around.
  const selectedEvents = useMemo(
    () => events.filter((event) => selectedIds.includes(event.id)),
    [events, selectedIds],
  )

  // Once the cap is reached, only the already-selected boxes stay clickable so
  // the athlete can swap one out — every other box is disabled, not ignored.
  const atLimit = maxSelected != null && selectedIds.length >= maxSelected

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search events"
          aria-label="Search events"
          className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm sm:w-64"
        />
        <span className="text-xs font-medium text-slate-600">{selectedLabel}</span>
      </div>

      <div
        role="group"
        aria-label="Available events"
        aria-invalid={invalid || undefined}
        className={cn(
          'max-h-80 overflow-y-auto rounded-lg border',
          invalid ? 'border-red-400' : 'border-slate-200',
        )}
      >
        {selectedEvents.length > 0 && (
          <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-3 py-2 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your selection</span>
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                {selectedEvents.length}
                {maxSelected != null ? ` / ${maxSelected}` : ''}
              </span>
              {atLimit && (
                <span className="text-[11px] font-medium text-amber-700">
                  Maximum reached — remove one to choose a different event
                </span>
              )}
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {selectedEvents.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(event.id)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-800 ring-1 ring-inset ring-accent-200 transition-colors hover:bg-accent-100"
                  >
                    {event.name}
                    <span aria-hidden="true" className="text-sm leading-none text-accent-500">
                      &times;
                    </span>
                    <span className="sr-only">Remove {event.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {visible.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-slate-500">No events match your search.</p>
        )}
        <ul className="divide-y divide-slate-100 p-1">
          {visible.map(({ event, eligible, reason }, index) => {
            const checked = selectedIds.includes(event.id)
            // A blocked box is disabled (and labelled) instead of silently
            // swallowing the click, so the athlete understands the cap.
            const blocked = !checked && atLimit
            const disabled = !eligible || blocked
            const note = reason ?? (blocked ? `Maximum ${maxSelected} events already selected` : null)
            const meta = [
              event.fee_paise > 0 ? `Additional fee ${formatMoney(event.fee_paise)}` : null,
              event.gender !== 'any' ? (event.gender === 'male' ? 'Men' : 'Women') : null,
              note,
            ].filter((value): value is string => Boolean(value))
            const previous = index > 0 ? visible[index - 1] : null
            const showIneligibleHeader = !eligible && (!previous || previous.eligible)
            return (
              <Fragment key={event.id}>
                {showIneligibleHeader && (
                  <li className="flex items-center gap-2 px-3 pb-1 pt-3">
                    <span className="h-px flex-1 bg-slate-200" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Not eligible for your selection
                    </span>
                    <span className="h-px flex-1 bg-slate-200" />
                  </li>
                )}
                <li>
                  <label
                    className={cn(
                      'flex items-start gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                      !eligible
                        ? 'cursor-not-allowed bg-amber-50/50'
                        : blocked
                          ? 'cursor-not-allowed opacity-60'
                          : 'cursor-pointer hover:bg-slate-50',
                      checked && eligible && 'bg-brand-50/70',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4.5 w-4.5 rounded border-slate-300 text-brand-700 focus:ring-brand-500 disabled:cursor-not-allowed"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggle(event.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={cn('font-medium', eligible ? 'text-slate-800' : 'text-slate-500')}>
                          {event.name}
                        </span>
                        {!eligible && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                            Not eligible
                          </span>
                        )}
                      </span>
                      {meta.length > 0 && (
                        <span
                          className={cn(
                            'mt-0.5 block text-xs',
                            eligible ? 'text-slate-500' : 'text-amber-700',
                          )}
                        >
                          {meta.join(' · ')}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              </Fragment>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
