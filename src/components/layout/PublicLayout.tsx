import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useConfig } from '@/context/ConfigContext'

const NAV_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/register', label: 'Register' },
  { to: '/returning', label: 'Already registered?' },
  { to: '/status', label: 'Check status' },
  { to: '/contact', label: 'Contact' },
]

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-orange-400"
      >
        AR
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-bold text-slate-900">Athlete Registration</span>
        <span className="block text-xs text-slate-500">Championship portal</span>
      </span>
    </Link>
  )
}

export function PublicLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const { config } = useConfig()

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  const organizer = config?.site?.organizer_name?.trim()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur print-hide">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Brand />
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <Link to="/admin/login">
              <Button variant="outline" size="sm">
                Admin
              </Button>
            </Link>
            <Link to="/register">
              <Button variant="accent" size="sm">
                Register now
              </Button>
            </Link>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-300 p-2 lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true" className="block text-lg leading-none">
              {menuOpen ? '×' : '☰'}
            </span>
          </button>
        </div>
        {menuOpen && (
          <nav id="mobile-nav" aria-label="Mobile" className="border-t border-slate-200 bg-white lg:hidden">
            <ul className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-3">
              {NAV_LINKS.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) =>
                      cn(
                        'block rounded-lg px-3 py-2.5 text-sm font-medium',
                        isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50',
                      )
                    }
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
              <li className="mt-2 flex gap-2">
                <Link to="/register" className="flex-1">
                  <Button variant="accent" className="w-full">
                    Register now
                  </Button>
                </Link>
                <Link to="/admin/login" className="flex-1">
                  <Button variant="outline" className="w-full">
                    Admin
                  </Button>
                </Link>
              </li>
            </ul>
          </nav>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="mt-16 border-t border-slate-200 bg-white print-hide">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Brand />
            <p className="mt-3 max-w-sm text-sm text-slate-600">
              {organizer
                ? `${organizer} — online athlete self-registration and secure payment portal.`
                : 'Online athlete self-registration and secure payment portal for athletics championships.'}
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Athletes</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>
                <Link to="/register" className="hover:text-slate-900">
                  New registration
                </Link>
              </li>
              <li>
                <Link to="/returning" className="hover:text-slate-900">
                  Retrieve my details
                </Link>
              </li>
              <li>
                <Link to="/status" className="hover:text-slate-900">
                  Registration status
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Information</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>
                <Link to="/privacy" className="hover:text-slate-900">
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-slate-900">
                  Terms &amp; conditions
                </Link>
              </li>
              <li>
                <Link to="/contact" className="hover:text-slate-900">
                  Contact organiser
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-100">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} {organizer || 'Championship organisers'}. All rights reserved.</p>
            <p>Payments are processed securely through a payment gateway.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
