import type { ActiveStage, Participant, ResearchSession } from './types'


export const GAME_PROGRESS_STORAGE_KEY = 'ai-image-game-progress-v1'

export type StoredGameProgress = {
  participant: Participant | null
  researchSession: ResearchSession | null
  activeStage: ActiveStage | null
}

const EMPTY_PROGRESS: StoredGameProgress = {
  participant: null,
  researchSession: null,
  activeStage: null,
}

export function loadGameProgress(): StoredGameProgress {
  const stored = sessionStorage.getItem(GAME_PROGRESS_STORAGE_KEY)
  if (stored === null) {
    return EMPTY_PROGRESS
  }
  try {
    const parsed = JSON.parse(stored) as Partial<StoredGameProgress>
    const activeStage = parsed.activeStage
    const canSafelyRestoreStage = activeStage?.stageRun.completion_status === 'in_progress'
      && activeStage.stageRun.attempt_count === 0
    return {
      participant: parsed.participant ?? null,
      researchSession: parsed.researchSession ?? null,
      // A pristine Stage can be restored. Once attempts exist, the component's
      // multi-step state cannot be reconstructed safely from this one record.
      activeStage: canSafelyRestoreStage ? activeStage ?? null : null,
    }
  } catch {
    sessionStorage.removeItem(GAME_PROGRESS_STORAGE_KEY)
    return EMPTY_PROGRESS
  }
}

export function saveGameProgress(progress: StoredGameProgress): void {
  sessionStorage.setItem(GAME_PROGRESS_STORAGE_KEY, JSON.stringify(progress))
}
