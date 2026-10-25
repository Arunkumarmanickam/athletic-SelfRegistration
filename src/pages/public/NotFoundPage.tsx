import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-20 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-orange-600">404</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">Page not found</h1>
      <p className="mt-3 text-sm text-slate-600">
        Page not found. Go back home or start a registration.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link to="/">
          <Button variant="outline">Back to home</Button>
        </Link>
        <Link to="/register">
          <Button variant="accent">Register now</Button>
        </Link>
        <Link to="/status">
          <Button variant="ghost">Check status</Button>
        </Link>
      </div>
    </div>
  )
}
