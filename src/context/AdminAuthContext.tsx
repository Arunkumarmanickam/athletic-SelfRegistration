import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { adminMe } from '@/lib/api'
import { requireSupabase } from '@/lib/supabase'
import type { AdminRole } from '@/lib/types'

export interface AdminIdentity {
  id: string
  email: string
  full_name: string | null
  role: AdminRole
}

interface AdminAuthContextValue {
  admin: AdminIdentity | null
  loading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<AdminIdentity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const client = requireSupabase()
      const { data } = await client.auth.getSession()
      if (!data.session) {
        setAdmin(null)
        return
      }
      // Verify server-side that this account is an active administrator.
      const result = await adminMe()
      setAdmin({
        id: result.admin.id,
        email: result.admin.email,
        full_name: result.admin.full_name,
        role: result.admin.role,
      })
      setError(null)
    } catch (err) {
      setAdmin(null)
      setError(err instanceof Error ? err.message : 'Administrator verification failed.')
      try {
        await requireSupabase().auth.signOut()
      } catch {
        /* ignore */
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signIn = useCallback(async (email: string, password: string) => {
    const client = requireSupabase()
    const { error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError) throw new Error(signInError.message)
    const result = await adminMe()
    setAdmin({
      id: result.admin.id,
      email: result.admin.email,
      full_name: result.admin.full_name,
      role: result.admin.role,
    })
    setError(null)
  }, [])

  const signOut = useCallback(async () => {
    await requireSupabase().auth.signOut()
    setAdmin(null)
  }, [])

  const value = useMemo<AdminAuthContextValue>(
    () => ({ admin, loading, error, signIn, signOut, refresh }),
    [admin, loading, error, signIn, signOut, refresh],
  )

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminAuth(): AdminAuthContextValue {
  const context = useContext(AdminAuthContext)
  if (!context) throw new Error('useAdminAuth must be used inside AdminAuthProvider')
  return context
}
