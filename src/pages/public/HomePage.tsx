import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, Alert, Spinner, EmptyState, Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { useConfig } from '@/context/ConfigContext'
import { formatDate, formatMoney } from '@/lib/format'
import type { Championship } from '@/lib/types'

function ChampionshipCard({ championship }: { championship: Championship }) {
  const eventCount = championship.championship_events.length
  const categoryCount = championship.championship_categories.length

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>{championship.name}</CardTitle>
          <Badge tone="success">Open</Badge>
        </div>
        {championship.location && <p className="mt-1 text-sm text-slate-600">{championship.location}</p>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {championship.description && <p className="text-sm text-slate-600">{championship.description}</p>}
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Dates</dt>
            <dd className="text-slate-800">
              {championship.starts_on ? formatDate(championship.starts_on) : '—'}
              {championship.ends_on && championship.ends_on !== championship.starts_on
                ? ` – ${formatDate(championship.ends_on)}`
                : ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Entry closes</dt>
            <dd className="text-slate-800">{championship.registration_closes_at ? formatDate(championship.registration_closes_at) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Base fee</dt>
            <dd className="text-slate-800">{formatMoney(championship.base_fee_paise, championship.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Offering</dt>
            <dd className="text-slate-800">
              {categoryCount} {categoryCount === 1 ? 'category' : 'categories'} · {eventCount}{' '}
              {eventCount === 1 ? 'event' : 'events'}
            </dd>
          </div>
        </dl>
        <div className="mt-auto pt-2">
          <Link to={`/register/${championship.slug}`}>
            <Button variant="accent" className="w-full">
              Register for this championship
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

  return (
    <div>
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 lg:grid-cols-2 lg:py-20">
          <div className="flex flex-col justify-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-orange-600">
              {config?.site?.organizer_name?.trim() || 'Athletics championships'}
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight text-slate-900 sm:text-4xl lg:text-5xl">
              Register for your championship in minutes
            </h1>
            <p className="mt-4 max-w-xl text-base text-slate-600">
              A single, secure portal for athletes. Get a permanent Athlete ID, a championship bib number, and pay your
              entry fee online. Returning athletes can retrieve their details anytime.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/register">
                <Button variant="accent" size="lg">
                  Register now
                </Button>
              </Link>
              <Link to="/returning">
                <Button variant="outline" size="lg">
                  Already registered?
                </Button>
              </Link>
            </div>
            {config?.payments_configured === false && (
              <p className="mt-4 max-w-lg text-xs text-amber-700">
                Online payment is not enabled on this deployment yet. You can still register; the organiser will guide
                you to complete the fee.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3 lg:content-center">
            {[
              { title: '1. Enter your details', body: 'Tell us who is competing and choose a category.' },
              { title: '2. Pick your events', body: 'Select one or more events. Fees update live.' },
              { title: '3. Pay securely', body: 'Pay via Razorpay and get your confirmed bib number.' },
            ].map((step) => (
              <div key={step.title} className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                <p className="mt-2 text-sm text-slate-600">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">Open registrations</h2>
          <p className="text-sm text-slate-600">Choose a championship below to begin. Only open championships are shown.</p>
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
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-12 md:grid-cols-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">A permanent Athlete ID</h3>
            <p className="mt-2 text-sm text-slate-600">
              You only create your profile once. Each championship gives you a separate Registration ID and its own
              bib number.
            </p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">Secure identity checks</h3>
            <p className="mt-2 text-sm text-slate-600">
              Retrieving your details requires your Athlete ID (or registered mobile number) and date of birth. We
              never reveal personal details to unverified visitors.
            </p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">Verified payments</h3>
            <p className="mt-2 text-sm text-slate-600">
              Payments are processed by Razorpay and confirmed on our server before your entry is marked as paid.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
