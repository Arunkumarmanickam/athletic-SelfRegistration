import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { publicConfig } from '@/lib/api'
import type { Championship, PublicConfig } from '@/lib/types'
import { isSupabaseConfigured } from '@/lib/env'

interface ConfigContextValue {
  config: PublicConfig | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  championshipBySlug: (slug: string) => Championship | undefined
}

const ConfigContext = createContext<ConfigContextValue | null>(null)

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError(
        'The backend is not configured yet. Copy .env.example to .env, add your Supabase URL and anon key, then restart the app.',
      )
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await publicConfig()
      setConfig(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load championship information.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
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
