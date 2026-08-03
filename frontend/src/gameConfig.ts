export type GameCaseConfig = {
  caseId: string
  stageLabel: string
  methodLabel: 'Patch' | 'Pixel'
}

export const GAME_CASES: GameCaseConfig[] = [
  { caseId: 'stage1-banana-patch', stageLabel: 'Stage 1', methodLabel: 'Patch' },
  { caseId: 'stage1-banana-pixel', stageLabel: 'Stage 1', methodLabel: 'Pixel' },
  { caseId: 'stage2-strawberry-patch', stageLabel: 'Stage 2', methodLabel: 'Patch' },
  { caseId: 'stage2-strawberry-pixel', stageLabel: 'Stage 2', methodLabel: 'Pixel' },
  { caseId: 'stage3-trafficlight-patch', stageLabel: 'Stage 3', methodLabel: 'Patch' },
  { caseId: 'stage3-trafficlight-pixel', stageLabel: 'Stage 3', methodLabel: 'Pixel' },
  { caseId: 'transfer-icecream-patch', stageLabel: 'Transfer', methodLabel: 'Patch' },
  { caseId: 'transfer-icecream-pixel', stageLabel: 'Transfer', methodLabel: 'Pixel' },
]
