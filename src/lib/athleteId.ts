import type { PublicConfig } from './types'

type AthleteIdFormat = PublicConfig['athlete_id_format']

/**
 * A sample Athlete ID in the configured format, e.g. `CDMAA-2026-001`.
 *
 * Mirrors `generate_athlete_id()` in Postgres: `<prefix>-<year>-<padded seq>`.
 * Used for hints and the admin preview so the example always matches what will
 * actually be issued instead of a hardcoded `ATH-2026-000001`.
 */
export function athleteIdExample(format?: AthleteIdFormat, year = new Date().getFullYear()): string {
  const prefix =
    String(format?.prefix ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8) || 'ATH'
  const length = Math.min(12, Math.max(3, format?.sequence_length || 6))
  return `${prefix}-${year}-${'1'.padStart(length, '0')}`
}
