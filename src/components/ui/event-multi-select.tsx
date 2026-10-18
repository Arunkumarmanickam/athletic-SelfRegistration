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

  const selectedLabel = `${selectedIds.length} selected`

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
          'max-h-80 overflow-y-auto rounded-lg border p-1',
          invalid ? 'border-red-400' : 'border-slate-200',
        )}
      >
        {visible.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-slate-500">No events match your search.</p>
        )}
        <ul className="divide-y divide-slate-100">
          {visible.map(({ event, eligible, reason }) => {
            const checked = selectedIds.includes(event.id)
            return (
              <li key={event.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                    eligible ? 'hover:bg-slate-50' : 'cursor-not-allowed opacity-60',
                    checked && eligible && 'bg-orange-50/70',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4.5 w-4.5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                    checked={checked}
                    disabled={!eligible}
                    onChange={() => onToggle(event.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-800">{event.name}</span>
                    <span className="block text-xs text-slate-500">
                      {event.fee_paise > 0 ? formatMoney(event.fee_paise) : 'No additional fee'}
                      {event.gender !== 'any' && ` · ${event.gender === 'male' ? 'Boys/Men' : 'Girls/Women'}`}
                      {reason && ` · ${reason}`}
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
