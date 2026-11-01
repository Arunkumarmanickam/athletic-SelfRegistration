import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Clock,
  CreditCard,
  IdCard,
  MapPin,
  ShieldCheck,
  Trophy,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, Alert, Spinner, EmptyState, Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { useConfig } from '@/context/ConfigContext'
import { ASSOCIATION_NAME } from '@/lib/brand'
import { cn } from '@/lib/utils'
import { formatDate, formatMoney, type BadgeTone } from '@/lib/format'
import type { Championship } from '@/lib/types'

const DAY_MS = 86_400_000

const STEPS = [
  {
    icon: IdCard,
    title: 'Enter your details',
    description: 'Your profile, category, and contact information.',
  },
  {
    icon: Trophy,
    title: 'Pick your events',
    description: 'Only events you are eligible for are selectable.',
  },
  {
    icon: CreditCard,
    title: 'Pay securely',
    description: 'Instant confirmation, bib number, and receipt.',
  },
]

const FEATURES = [
  {
    icon: IdCard,
    title: 'A permanent Athlete ID',
    description: 'One profile for every championship you enter, with your details ready to reuse.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure identity checks',
    description: 'Your information is verified and kept private, with a clear record of every entry.',
  },
  {
    icon: CreditCard,
    title: 'Verified payments',
    description: 'Pay online through a secure gateway and download your receipt immediately.',
  },
]

function registrationStatus(championship: Championship): { label: string; tone: BadgeTone } {
  if (!championship.registration_closes_at) return { label: 'Open', tone: 'success' }
  const closes = new Date(championship.registration_closes_at).getTime()
  if (Number.isNaN(closes)) return { label: 'Open', tone: 'success' }
  const daysLeft = Math.ceil((closes - Date.now()) / DAY_MS)
  if (daysLeft < 0) return { label: 'Closed', tone: 'neutral' }
  if (daysLeft <= 7) return { label: 'Closing soon', tone: 'warning' }
  return { label: 'Open', tone: 'success' }
}

function dateRange(championship: Championship): string {
  if (!championship.starts_on) return 'Dates to be announced'
  if (championship.ends_on && championship.ends_on !== championship.starts_on) {
    return `${formatDate(championship.starts_on)} – ${formatDate(championship.ends_on)}`
  }
  return formatDate(championship.starts_on)
}

function TrackPattern() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 600"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id="lane-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4, 5, 6].map((lane) => (
        <path
          key={lane}
          d={`M-120 ${570 - lane * 32} C 260 ${440 - lane * 32}, 720 ${340 - lane * 30}, 1320 ${70 - lane * 28}`}
          fill="none"
          stroke="url(#lane-fade)"
          strokeWidth="1.5"
        />
      ))}
    </svg>
  )
}

function ChampionshipCard({ championship }: { championship: Championship }) {
  const eventCount = championship.championship_events.length
  const categoryCount = championship.championship_categories.length
  const status = registrationStatus(championship)

  const start = championship.starts_on ? new Date(`${championship.starts_on}T00:00:00`) : null
  const validStart = start && !Number.isNaN(start.getTime()) ? start : null
  const month = validStart ? validStart.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase() : null

  return (
    <Card className="group flex h-full flex-col overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-brand-50 py-2 ring-1 ring-inset ring-brand-100">
            <span className="text-[10px] font-bold uppercase tracking-wider text-accent-600">
              {month ?? 'TBA'}
            </span>
            <span className="font-display text-2xl font-bold leading-none text-brand-800">
              {validStart ? validStart.getDate() : '—'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <CardTitle className="font-display text-lg leading-snug">{championship.name}</CardTitle>
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-600">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden="true" />
              <span className="truncate">{championship.location || 'Venue to be announced'}</span>
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {championship.description && (
          <p className="line-clamp-2 text-sm leading-relaxed text-slate-600">{championship.description}</p>
        )}

        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-50 px-2 py-2">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Events</dt>
            <dd className="mt-0.5 text-sm font-semibold text-brand-900">{eventCount}</dd>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-2">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Categories</dt>
            <dd className="mt-0.5 text-sm font-semibold text-brand-900">{categoryCount}</dd>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-2">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Base fee</dt>
            <dd className="mt-0.5 text-sm font-semibold text-brand-900">
              {formatMoney(championship.base_fee_paise, championship.currency)}
            </dd>
          </div>
        </dl>

        <p className="flex items-center gap-2 text-sm text-slate-600">
          <CalendarDays className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
          {dateRange(championship)}
        </p>

        {championship.registration_closes_at && (
          <p
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset',
              status.tone === 'warning'
                ? 'bg-accent-50 text-accent-800 ring-accent-200'
                : 'bg-slate-50 text-slate-700 ring-slate-200',
            )}
          >
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            Entries close {formatDate(championship.registration_closes_at)}
          </p>
        )}

        <div className="mt-auto pt-1">
          <Link to={`/register/${championship.slug}`}>
            <Button variant="accent" className="w-full">
              Register for this championship
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

export function HomePage() {
  const { config, loading, error } = useConfig()

  const championships = config?.championships ?? []
  const organizer = config?.site?.organizer_name?.trim() || ASSOCIATION_NAME

  const nextDeadline = championships
    .map((championship) => championship.registration_closes_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((item) => !Number.isNaN(item.time) && item.time > Date.now())
    .sort((a, b) => a.time - b.time)[0]?.value

  return (
    <div>
      <section className="surface-dark relative overflow-hidden bg-brand-900">
        <TrackPattern />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-500/20 blur-3xl"
        />

        <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-4 py-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-24">
          <div>
            <p className="flex items-start gap-2 text-sm font-semibold text-brand-200">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" aria-hidden="true" />
              {organizer}
            </p>
            <h1 className="mt-4 max-w-2xl text-balance font-display text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Register for your championship <span className="text-accent-300">in minutes</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-brand-100 sm:text-lg">
              A single, secure portal for masters athletes. Get a permanent Athlete ID, a championship
              bib number, and pay your entry fee online.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register">
                <Button variant="accent" size="lg">
                  Register now
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Link>
              <Link to="/returning">
                <Button variant="inverse" size="lg">
                  Already registered?
                </Button>
              </Link>
            </div>

            <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-brand-200">
              <li className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-accent-300" aria-hidden="true" />
                Secure online payment
              </li>
              <li className="inline-flex items-center gap-1.5">
                <BadgeCheck className="h-4 w-4 text-accent-300" aria-hidden="true" />
                Regd. No. 256/97
              </li>
              <li className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-accent-300" aria-hidden="true" />
                Coimbatore
              </li>
            </ul>

            {config?.payments_configured === false && (
              <p className="mt-5 max-w-lg rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
                Online payment is not enabled on this deployment yet. You can still register; the
                organiser will guide you to complete the fee.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-2 backdrop-blur">
            <div className="rounded-xl bg-white p-5 shadow-2xl sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-600">
                How it works
              </p>
              <ol className="mt-4 space-y-4">
                {STEPS.map((step, index) => (
                  <li key={step.title} className="flex gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100">
                      <step.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-brand-900">
                        {index + 1}. {step.title}
                      </p>
                      <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{step.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {nextDeadline && (
                <p className="mt-5 flex items-center gap-2 rounded-lg bg-accent-50 px-3 py-2 text-sm font-medium text-accent-800 ring-1 ring-inset ring-accent-200">
                  <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Entries close {formatDate(nextDeadline)}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:py-16">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-bold tracking-tight text-brand-900 sm:text-3xl">
            Open registrations
          </h2>
          <p className="text-sm text-slate-600 sm:text-base">Choose a championship below to begin.</p>
        </div>

        <div className="mt-6">
          {loading && (
            <div className="flex justify-center py-12">
              <Spinner label="Loading championships" />
            </div>
          )}

          {!loading && error && (
            <Alert tone="danger" title="Could not load championships">
              {error}
            </Alert>
          )}

          {!loading && !error && championships.length === 0 && (
            <Card>
              <EmptyState
                title="No championships are open right now"
                description="Registration is either not open yet or has closed. Please check back later, or contact the organiser."
                action={
                  <Link to="/contact">
                    <Button variant="outline">Contact the organiser</Button>
                  </Link>
                }
              />
            </Card>
          )}

          {!loading && !error && championships.length > 0 && (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {championships.map((championship) => (
                <ChampionshipCard key={championship.id} championship={championship} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:py-16">
          <div className="grid gap-8 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="flex gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100">
                  <feature.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-display text-base font-bold text-brand-900">{feature.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
