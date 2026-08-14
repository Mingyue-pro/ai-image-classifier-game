export const APP_PATHS = {
  agreement: '/agreement',
  guidedDiscovery: '/guided-discovery',
  conditionInvestigation: '/condition-investigation',
  repairInvestigation: '/repair-investigation',
  transferChallenge: '/transfer-challenge',
  complete: '/complete',
} as const

export function pathForStage(stage: string): string {
  if (stage === 'stage1') return APP_PATHS.guidedDiscovery
  if (stage === 'stage2') return APP_PATHS.conditionInvestigation
  if (stage === 'stage3') return APP_PATHS.repairInvestigation
  if (stage === 'transfer') return APP_PATHS.transferChallenge
  return APP_PATHS.complete
}

export function stageNumberForPath(pathname: string): 1 | 2 | 3 | 4 {
  if (pathname === APP_PATHS.conditionInvestigation) return 2
  if (pathname === APP_PATHS.repairInvestigation) return 3
  if (pathname === APP_PATHS.transferChallenge || pathname === APP_PATHS.complete) return 4
  return 1
}

export function pathForStageNumber(stage: 1 | 2 | 3 | 4): string {
  if (stage === 2) return APP_PATHS.conditionInvestigation
  if (stage === 3) return APP_PATHS.repairInvestigation
  if (stage === 4) return APP_PATHS.transferChallenge
  return APP_PATHS.guidedDiscovery
}
