import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ArrowRight, Mail, MapPin, Menu, Phone, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AssociationLogo } from '@/components/AssociationLogo'
import { Button } from '@/components/ui/button'
import { useConfig } from '@/context/ConfigContext'
import { ASSOCIATION_NAME, ASSOCIATION_TAGLINE } from '@/lib/brand'

const NAV_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/register', label: 'Register' },
  { to: '/returning', label: 'Already registered?' },
  { to: '/status', label: 'Check status' },
  { to: '/contact', label: 'Contact' },
]

function Brand() {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2.5">
      <AssociationLogo className="h-9 w-auto shrink-0 sm:h-11" alt="" />
      <span className="min-w-0 leading-tight">
        <span className="block text-xs font-bold text-brand-900 sm:text-sm">{ASSOCIATION_NAME}</span>
        <span className="block text-[11px] text-slate-500 sm:text-xs">{ASSOCIATION_TAGLINE}</span>
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

  const site = config?.site
  const organizer = site?.organizer_name?.trim() || ASSOCIATION_NAME
  const contactItems = [
    site?.support_email
      ? { icon: Mail, label: site.support_email, href: `mailto:${site.support_email}` }
      : null,
    site?.support_phone
      ? { icon: Phone, label: site.support_phone, href: `tel:${site.support_phone.replace(/[^\d+]/g, '')}` }
      : null,
    site?.address ? { icon: MapPin, label: site.address, href: null } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null)

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur print-hide">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:gap-4 sm:py-3">
          <Brand />
          <nav aria-label="Main" className="hidden items-center gap-1 xl:flex">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-900'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-brand-900',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 xl:flex">
            <Link to="/admin/login">
              <Button variant="outline" size="sm">
                Admin
              </Button>
            </Link>
            <Link to="/register">
              <Button variant="accent" size="sm">
                Register now
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
          </div>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 xl:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
        {menuOpen && (
          <nav id="mobile-nav" aria-label="Mobile" className="border-t border-slate-200 bg-white xl:hidden">
            <ul className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-3">
              {NAV_LINKS.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) =>
                      cn(
                        'block rounded-lg px-3 py-3 text-sm font-medium',
                        isActive ? 'bg-brand-50 text-brand-900' : 'text-slate-700 hover:bg-slate-50',
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
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
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
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-600">
              Online athlete self-registration and secure payment portal for masters athletics
              championships organised by {organizer}.
            </p>
            {contactItems.length > 0 && (
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                {contactItems.map((item) => (
                  <li key={item.label} className="flex items-start gap-2">
                    <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                    {item.href ? (
                      <a href={item.href} className="break-words hover:text-brand-900">
                        {item.label}
                      </a>
                    ) : (
                      <span className="break-words">{item.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-brand-900">Athletes</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>
                <Link to="/register" className="hover:text-brand-900">
                  New registration
                </Link>
              </li>
              <li>
                <Link to="/returning" className="hover:text-brand-900">
                  Retrieve my details
                </Link>
              </li>
              <li>
                <Link to="/status" className="hover:text-brand-900">
                  Registration status
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-brand-900">Information</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>
                <Link to="/privacy" className="hover:text-brand-900">
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-brand-900">
                  Terms &amp; conditions
                </Link>
              </li>
              <li>
                <Link to="/contact" className="hover:text-brand-900">
                  Contact organiser
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-100">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {new Date().getFullYear()} {organizer}. All rights reserved.
            </p>
            <p>Regd. No. 256/97 · Coimbatore · Secure payments</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
