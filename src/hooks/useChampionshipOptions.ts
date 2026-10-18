import { useEffect, useState } from 'react'
import { adminChampionships } from '@/lib/api'
import type { ChampionshipStatus } from '@/lib/types'

export interface ChampionshipOption {
  id: string
  name: string
  status: ChampionshipStatus
}

/**
 * Loads the championship list for admin filter dropdowns. Unlike the public
 * config it includes drafts and closed championships, which administrators
 * still need to filter by.
 */
export function useChampionshipOptions(): { options: ChampionshipOption[]; loading: boolean } {
  const [options, setOptions] = useState<ChampionshipOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    adminChampionships({ action: 'list' })
      .then((result) => {
        if (cancelled) return
        setOptions(result.rows.map((row) => ({ id: row.id, name: row.name, status: row.status })))
      })
      .catch(() => {
        /* the filter simply stays empty; the page still works */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { options, loading }
}
