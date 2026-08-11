export type GameCaseConfig = {
  caseId: string
  stageLabel: string
  methodLabel: 'Patch' | 'Pixel'
}

export const GAME_CASES: GameCaseConfig[] = [
  { caseId: 'stage1-banana-patch', stageLabel: 'Guided Discovery', methodLabel: 'Patch' },
  { caseId: 'stage1-banana-pixel', stageLabel: 'Guided Discovery', methodLabel: 'Pixel' },
  { caseId: 'stage2-strawberry-patch', stageLabel: 'Condition Investigation', methodLabel: 'Patch' },
  { caseId: 'stage2-strawberry-pixel', stageLabel: 'Condition Investigation', methodLabel: 'Pixel' },
  { caseId: 'stage3-trafficlight-patch', stageLabel: 'Repair Investigation', methodLabel: 'Patch' },
  { caseId: 'stage3-trafficlight-pixel', stageLabel: 'Repair Investigation', methodLabel: 'Pixel' },
  { caseId: 'transfer-icecream-patch', stageLabel: 'Transfer Challenge', methodLabel: 'Patch' },
  { caseId: 'transfer-icecream-pixel', stageLabel: 'Transfer Challenge', methodLabel: 'Pixel' },
]
