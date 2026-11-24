import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { publicConfig } from '@/lib/api'
import type { Championship, PublicConfig } from '@/lib/types'
import { isSupabaseConfigured } from '@/lib/env'

interface ConfigContextValue {
  config: PublicConfig | null
  loading: boolean
  error: string | null
  /** `silent` skips the loading state, used for background refreshes. */
  refresh: (silent?: boolean) => Promise<void>
  championshipBySlug: (slug: string) => Championship | undefined
}

const ConfigContext = createContext<ConfigContextValue | null>(null)

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const location = useLocation()
  const lastPath = useRef(location.pathname)

  const refresh = useCallback(async (silent = false) => {
    if (!isSupabaseConfigured) {
      setError(
        'The backend is not configured yet. Copy .env.example to .env, add your Supabase URL and anon key, then restart the app.',
      )
      if (!silent) setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      const result = await publicConfig()
      setConfig(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load championship information.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Admin edits go straight to the database. Refetch silently when the
  // athlete navigates so a config loaded on the first mount is not reused.
  useEffect(() => {
    if (lastPath.current === location.pathname) return
    lastPath.current = location.pathname
    void refresh(true)
  }, [location.pathname, refresh])

  // Covers the common case where the admin saves in one tab and the athlete
  // form is already open in another; switching back refreshes the config.
  useEffect(() => {
    const onFocus = () => { void refresh(true) }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh(true)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const value = useMemo<ConfigContextValue>(
    () => ({
      config,
      loading,
      error,
      refresh,
      championshipBySlug: (slug: string) => config?.championships.find((c) => c.slug === slug),
    }),
    [config, loading, error, refresh],
  )

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

export function useConfig(): ConfigContextValue {
  const context = useContext(ConfigContext)
  if (!context) throw new Error('useConfig must be used inside ConfigProvider')
  return context
}
