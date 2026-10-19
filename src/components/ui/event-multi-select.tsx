import { useMemo, useState } from 'react'
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

  const decorated = useMemo(
    () =>
      events.map((event) => {
        const genderOk = event.gender === 'any' || event.gender === gender
        const categoryOk =
          !event.category_ids || event.category_ids.length === 0 || event.category_ids.includes(categoryId)
        const reason = !genderOk
          ? 'Not open to your gender'
          : !categoryOk
            ? 'Not offered in your category'
            : null
        return { event, eligible: !reason, reason }
      }),
    [events, gender, categoryId],
  )

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
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-700">
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
                    className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-800 ring-1 ring-inset ring-orange-200 transition-colors hover:bg-orange-100"
                  >
                    {event.name}
                    <span aria-hidden="true" className="text-sm leading-none text-orange-500">
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
          {visible.map(({ event, eligible, reason }) => {
            const checked = selectedIds.includes(event.id)
            // A blocked box is disabled (and labelled) instead of silently
            // swallowing the click, so the athlete understands the cap.
            const blocked = !checked && atLimit
            const disabled = !eligible || blocked
            const note = reason ?? (blocked ? `Maximum ${maxSelected} events already selected` : null)
            return (
              <li key={event.id}>
                <label
                  className={cn(
                    'flex items-start gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                    disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-slate-50',
                    checked && eligible && 'bg-orange-50/70',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4.5 w-4.5 rounded border-slate-300 text-orange-600 focus:ring-orange-500 disabled:cursor-not-allowed"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onToggle(event.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-800">{event.name}</span>
                    <span className="block text-xs text-slate-500">
                      {event.fee_paise > 0 ? formatMoney(event.fee_paise) : 'No additional fee'}
                      {event.gender !== 'any' && ` · ${event.gender === 'male' ? 'Men' : 'Women'}`}
                      {note && ` · ${note}`}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
