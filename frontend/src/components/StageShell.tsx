import { GAME_CASES } from '../gameConfig'
import { MissionHeader } from './GameUi'
import type { ActiveStage } from '../types'
import type { ReactNode } from 'react'


type StageShellProps = {
  activeStage: ActiveStage
  children: ReactNode
}

export function StageShell({ activeStage, children }: StageShellProps) {
  const config = GAME_CASES[activeStage.caseIndex]
  const { playerCase } = activeStage
  const copy = playerCase.stage === 'stage1' ? {
    subtitle: 'Complete four fixed investigations using Patch and Pixel modifications.',
  } : playerCase.stage === 'stage2' ? {
    subtitle: 'Investigate how Patch and Pixel parameter conditions affect the classifier.',
  } : playerCase.stage === 'stage3' ? {
    subtitle: 'Plan, test, and revise repairs for a misclassified traffic light image.',
  } : {
    subtitle: 'Apply the investigation process to a new mailbox image and evaluate the evidence.',
  }
  return (
    <section className="stage-shell" aria-labelledby="stage-title">
      <MissionHeader
        stage={config.stageLabel}
        title={`Investigate the ${playerCase.subject} image`}
        subtitle={copy.subtitle}
      />

      <div className="stage-content-card stage-content-card--wide">{children}</div>
    </section>
  )
}
