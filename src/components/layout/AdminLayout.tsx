import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/display'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { isSupabaseConfigured } from '@/lib/env'

const ADMIN_LINKS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/registrations', label: 'Registrations' },
  { to: '/admin/athletes', label: 'Athletes' },
  { to: '/admin/payments', label: 'Payments' },
  { to: '/admin/championships', label: 'Championships' },
  { to: '/admin/settings', label: 'Settings' },
  { to: '/admin/audit', label: 'Audit trail' },
  { to: '/admin/users', label: 'Administrators' },
]

export function AdminLayout() {
  const { admin, loading, signOut } = useAdminAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <h1 className="text-xl font-semibold text-slate-900">Backend not configured</h1>
        <p className="mt-2 text-sm text-slate-600">
          Add your Supabase URL and anon key to <code className="rounded bg-slate-100 px-1">.env</code> and restart the
          app. See the README for step-by-step instructions.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking administrator access" />
      </div>
    )
  }

  if (!admin) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Administrator sign-in required</h1>
        <p className="mt-2 text-sm text-slate-600">
          This area is restricted to championship administrators.
        </p>
        <Link to="/admin/login" className="mt-6 inline-block">
          <Button variant="accent">Go to sign-in</Button>
        </Link>
      </div>
    )
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/admin/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white print-hide">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-orange-400"
              >
                AR
              </span>
              <span className="text-sm font-bold text-slate-900">Admin dashboard</span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium text-slate-900">{admin.full_name || admin.email}</p>
              <p className="text-xs text-slate-500">Role: {admin.role}</p>
            </div>
            <Link to="/" className="hidden sm:block">
              <Button variant="ghost" size="sm">
                View site
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
            <button
              type="button"
              className="rounded-lg border border-slate-300 p-2 lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="admin-nav"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span aria-hidden="true" className="block text-lg leading-none">
                {menuOpen ? '×' : '☰'}
              </span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6">
        <nav
          id="admin-nav"
          aria-label="Admin sections"
          className={cn(
            'w-56 shrink-0 print-hide',
            menuOpen ? 'absolute inset-x-4 top-16 z-30 rounded-xl border border-slate-200 bg-white p-2 shadow-lg lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none' : 'hidden lg:block',
          )}
        >
          <ul className="flex flex-col gap-1">
            {ADMIN_LINKS.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-white hover:text-slate-900',
                    )
                  }
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
