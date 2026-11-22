import type { Championship, ChampionshipCategory, ChampionshipEvent } from '@/lib/types'
import { formatMoney } from '@/lib/format'
import { Separator } from '@/components/ui/display'

export interface FeeSummaryProps {
  championship: Championship
  category?: ChampionshipCategory | null
  events?: ChampionshipEvent[]
  className?: string
}

/**
 * Transparent fee breakdown shown before payment. The authoritative amount is
 * always calculated again on the server from the same configuration.
 */
export function FeeSummary({ championship, category, events = [], className }: FeeSummaryProps) {
  if (category?.is_free) {
    return (
      <div className={className}>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-900">Free entry</p>
              <p className="mt-0.5 text-xs text-emerald-700">
                Age category {category.name} — no payment is required.
              </p>
            </div>
            <span className="shrink-0 text-lg font-bold text-emerald-900">
              {formatMoney(0, championship.currency)}
            </span>
          </div>
        </div>
      </div>
    )
  }

  const categoryFee = category?.fee_paise ?? 0
  const eventFee = events.reduce((total, event) => total + (event.fee_paise ?? 0), 0)
  const total = (championship.base_fee_paise ?? 0) + categoryFee + eventFee

  // Only show a line when it actually contributes something, so a ₹0 category
  // or an empty event list does not clutter the breakdown.
  const showCategory = category != null && categoryFee > 0
  const showEvents = events.length > 0

  return (
    <div className={className}>
      <dl className="space-y-2 text-sm">
        <div className="flex items-start justify-between gap-4">
          <dt className="text-slate-600">Championship base fee</dt>
          <dd className="font-medium text-slate-900">{formatMoney(championship.base_fee_paise, championship.currency)}</dd>
        </div>
        {showCategory && (
          <div className="flex items-start justify-between gap-4">
            <dt className="text-slate-600">Category fee — {category.name}</dt>
            <dd className="font-medium text-slate-900">{formatMoney(categoryFee, championship.currency)}</dd>
          </div>
        )}
        {showEvents && (
          <div className="flex items-start justify-between gap-4">
            <dt className="text-slate-600">
              Events ({events.length}: {events.map((event) => event.name).join(', ')})
            </dt>
            {eventFee > 0 && (
              <dd className="font-medium text-slate-900">{formatMoney(eventFee, championship.currency)}</dd>
            )}
          </div>
        )}
      </dl>
      <Separator className="my-3" />
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-900">Total payable</span>
        <span className="text-lg font-bold text-slate-900">{formatMoney(total, championship.currency)}</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        This is an estimate based on the current configuration. The exact amount is confirmed by the server when the
        payment order is created.
      </p>
    </div>
  )
}
