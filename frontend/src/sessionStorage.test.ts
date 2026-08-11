import { afterEach, describe, expect, test } from 'vitest'

import { GAME_PROGRESS_STORAGE_KEY, loadGameProgress } from './sessionStorage'


describe('game progress restoration', () => {
  afterEach(() => sessionStorage.clear())

  test('restores a pristine Stage but discards an attempted Stage UI state', () => {
    const progress = {
      participant: { id: 'participant-1' },
      researchSession: { id: 'session-1' },
      activeStage: {
        caseIndex: 2,
        playerCase: { stage: 'stage2' },
        stageRun: { completion_status: 'in_progress', attempt_count: 0 },
      },
    }
    sessionStorage.setItem(GAME_PROGRESS_STORAGE_KEY, JSON.stringify(progress))
    expect(loadGameProgress().activeStage).not.toBeNull()

    progress.activeStage.stageRun.attempt_count = 1
    sessionStorage.setItem(GAME_PROGRESS_STORAGE_KEY, JSON.stringify(progress))
    expect(loadGameProgress()).toMatchObject({
      participant: { id: 'participant-1' },
      researchSession: { id: 'session-1' },
      activeStage: null,
    })
  })
})
