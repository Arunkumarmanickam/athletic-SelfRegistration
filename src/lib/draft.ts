// Keeps the athlete's in-progress registration in localStorage so data is not
// lost when navigating between steps, refreshing, or reconnecting.

import type { ParticipationStepValues, PersonalStepValues } from './validation'

const KEY = 'arp:registration-draft:v1'

export interface RegistrationDraft {
  championshipId: string
  personal: PersonalStepValues
  participation: ParticipationStepValues
  stepIndex: number
  updatedAt: string
}

export function loadDraft(championshipId: string): RegistrationDraft | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RegistrationDraft
    if (parsed.championshipId !== championshipId) return null
    return parsed
  } catch {
    return null
  }
}

export function saveDraft(draft: RegistrationDraft): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }))
  } catch {
    /* storage may be unavailable (private mode): drafts are a convenience only */
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
