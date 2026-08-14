import { describe, expect, test } from 'vitest'

import { APP_PATHS, pathForStage, pathForStageNumber, stageNumberForPath } from './routes'

describe('application routes', () => {
  test('maps internal stage identifiers to user-facing paths', () => {
    expect(pathForStage('stage1')).toBe(APP_PATHS.guidedDiscovery)
    expect(pathForStage('stage2')).toBe(APP_PATHS.conditionInvestigation)
    expect(pathForStage('stage3')).toBe(APP_PATHS.repairInvestigation)
    expect(pathForStage('transfer')).toBe(APP_PATHS.transferChallenge)
    expect(pathForStage('finished')).toBe(APP_PATHS.complete)
  })

  test('maps a refreshed path back to its stage transition', () => {
    expect(stageNumberForPath(APP_PATHS.conditionInvestigation)).toBe(2)
    expect(stageNumberForPath(APP_PATHS.repairInvestigation)).toBe(3)
    expect(stageNumberForPath(APP_PATHS.transferChallenge)).toBe(4)
    expect(pathForStageNumber(2)).toBe(APP_PATHS.conditionInvestigation)
    expect(pathForStageNumber(4)).toBe(APP_PATHS.transferChallenge)
  })
})
