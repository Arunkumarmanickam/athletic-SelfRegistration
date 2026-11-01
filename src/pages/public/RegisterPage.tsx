import { Link, useParams } from 'react-router-dom'
import { ArrowRight, CalendarDays, Clock, MapPin } from 'lucide-react'
import { Alert, Card, EmptyState, Spinner } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { RegistrationForm } from '@/components/registration/RegistrationForm'
import { useConfig } from '@/context/ConfigContext'
import { formatDate } from '@/lib/format'
import type { Championship } from '@/lib/types'

function ChampionshipHeader({ championship }: { championship: Championship }) {
  const dates = championship.starts_on
    ? `${formatDate(championship.starts_on)}${
        championship.ends_on && championship.ends_on !== championship.starts_on
          ? ` – ${formatDate(championship.ends_on)}`
          : ''
      }`
    : null

  return (
    <div className="mb-6 border-b border-slate-200 pb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-600">Registration</p>
      <h1 className="mt-1 text-balance font-display text-2xl font-bold tracking-tight text-brand-900 sm:text-3xl">
        {championship.name}
      </h1>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
        {championship.location && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-brand-500" aria-hidden="true" />
            {championship.location}
          </span>
        )}
        {dates && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-brand-500" aria-hidden="true" />
            {dates}
          </span>
        )}
        {championship.registration_closes_at && (
          <span className="inline-flex items-center gap-1.5 font-medium text-accent-700">
            <Clock className="h-4 w-4" aria-hidden="true" />
            Entry closes {formatDate(championship.registration_closes_at)}
          </span>
        )}
      </div>
    </div>
  )
}

export function RegisterPage() {
  const { slug } = useParams<{ slug: string }>()
  const { config, loading, error } = useConfig()

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Loading registration" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <Alert tone="danger" title="Could not load registration information">
          {error}
        </Alert>
      </div>
    )
  }

  const championships = config?.championships ?? []

  // Explicit championship in the URL.
  if (slug) {
    const championship = championships.find((item) => item.slug === slug)
    if (!championship) {
      return (
        <div className="mx-auto w-full max-w-2xl px-4 py-16">
          <Card>
            <EmptyState
              title="This championship is not open"
              description="The registration link may have expired, the championship may be closed, or the web address may be incorrect."
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  <Link to="/register">
                    <Button variant="outline">See open championships</Button>
                  </Link>
                  <Link to="/">
                    <Button variant="ghost">Back to home</Button>
                  </Link>
                </div>
              }
            />
          </Card>
        </div>
      )
    }
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <ChampionshipHeader championship={championship} />
        <RegistrationForm championship={championship} />
      </div>
    )
  }

  // No slug: if there is exactly one open championship, go straight to it.
  if (championships.length === 1) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <ChampionshipHeader championship={championships[0]} />
        <RegistrationForm championship={championships[0]} />
      </div>
    )
  }

  if (championships.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <Card>
          <EmptyState
            title="Registration is not open"
            description="There are no championships open for registration right now. Please check back later or contact the organiser."
            action={
              <Link to="/contact">
                <Button variant="outline">Contact the organiser</Button>
              </Link>
            }
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12">
      <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900 sm:text-3xl">
        Choose a championship
      </h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {championships.map((championship) => (
          <Card key={championship.id} className="flex flex-col transition hover:shadow-md">
            <div className="flex flex-1 flex-col p-5">
              <h2 className="font-display text-base font-bold text-brand-900">{championship.name}</h2>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                <MapPin className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
                {championship.location || 'Location to be announced'}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden="true" />
                {championship.starts_on ? formatDate(championship.starts_on) : 'Dates to be announced'}
              </p>
              <div className="mt-4">
                <Link to={`/register/${championship.slug}`}>
                  <Button variant="accent" className="w-full">
                    Start registration
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
