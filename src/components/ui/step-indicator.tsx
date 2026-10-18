import { cn } from '@/lib/utils'
import { REGISTRATION_STEPS } from '@/lib/constants'

/** Accessible multi-step progress indicator. */
export function StepIndicator({
  currentIndex,
  className,
}: {
  currentIndex: number
  className?: string
}) {
  return (
    <nav aria-label="Registration progress" className={cn('w-full', className)}>
      <ol className="grid grid-cols-3 gap-2">
        {REGISTRATION_STEPS.map((step, index) => {
          const state = index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming'
          return (
            <li key={step.id} className="flex flex-col gap-2">
              <div
                className={cn(
                  'h-1.5 w-full rounded-full',
                  state === 'complete' && 'bg-emerald-500',
                  state === 'current' && 'bg-orange-500',
                  state === 'upcoming' && 'bg-slate-200',
                )}
              />
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    state === 'complete' && 'bg-emerald-100 text-emerald-700',
                    state === 'current' && 'bg-orange-100 text-orange-700',
                    state === 'upcoming' && 'bg-slate-100 text-slate-500',
                  )}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block truncate text-xs font-semibold sm:text-sm',
                      state === 'upcoming' ? 'text-slate-500' : 'text-slate-900',
                    )}
                  >
                    {step.title}
                  </span>
                  <span className="hidden text-xs text-slate-500 sm:block">{step.description}</span>
                </span>
              </div>
              <span className="sr-only">
                {state === 'complete' ? 'Completed' : state === 'current' ? 'Current step' : 'Not started'}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
