import { resolveApiUrl } from '../api'
import { GAME_CASES } from '../gameConfig'
import type { ActiveStage } from '../types'


type StageShellProps = {
  activeStage: ActiveStage
}

export function StageShell({ activeStage }: StageShellProps) {
  const config = GAME_CASES[activeStage.caseIndex]
  const { playerCase, stageRun } = activeStage
  const progress = ((activeStage.caseIndex + 1) / GAME_CASES.length) * 100

  return (
    <section className="stage-shell" aria-labelledby="stage-title">
      <div className="stage-toolbar">
        <div>
          <p className="eyebrow">
            {config.stageLabel} · {config.methodLabel}
          </p>
          <p className="case-counter">
            Case {activeStage.caseIndex + 1} of {GAME_CASES.length}
          </p>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Game progress"
          aria-valuemin={0}
          aria-valuemax={GAME_CASES.length}
          aria-valuenow={activeStage.caseIndex + 1}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="stage-grid">
        <div className="case-image-card">
          <img
            src={resolveApiUrl(playerCase.initial_image_url)}
            alt={`${playerCase.subject} case for ${config.methodLabel} exploration`}
          />
          <div className="case-image-caption">
            <span>Initial model result</span>
            <strong>{playerCase.initial_top1.label}</strong>
          </div>
        </div>

        <div className="stage-content-card">
          <p className="step-label">Observe</p>
          <h1 id="stage-title">Investigate the {playerCase.subject} image</h1>
          <p>
            Look at the image and the model result. In the next step, you will
            predict what happens when the image condition changes.
          </p>

          <dl className="case-facts">
            <div>
              <dt>Method</dt>
              <dd>{config.methodLabel}</dd>
            </div>
            <div>
              <dt>Stage run</dt>
              <dd>{stageRun.completion_status.replace('_', ' ')}</dd>
            </div>
          </dl>

          <div className="stage-placeholder" role="note">
            Stage 1 prediction and fixed-choice controls are the next implementation step.
          </div>
        </div>
      </div>
    </section>
  )
}
