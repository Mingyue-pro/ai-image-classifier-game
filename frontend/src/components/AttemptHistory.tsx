import type { RepairAttempt } from '../types'

type AttemptHistoryProps = {
  attempts: RepairAttempt[]
  initialLabels: Record<'Patch' | 'Pixel', string>
  title?: string
}

function parameterSummary(parameters: Record<string, number>): string {
  if (parameters.size_fraction === 0) return 'Patch removed'
  return Object.entries(parameters).map(([name, value]) => {
    if (name === 'epsilon_pixels') return `Strength ${value}/255`
    if (name === 'size_fraction') return `Size ${Math.round(value * 100)}%`
    if (name === 'position_x') return `X ${value.toFixed(2)}`
    if (name === 'position_y') return `Y ${value.toFixed(2)}`
    return `${name} ${value}`
  }).join(' · ')
}

export function AttemptHistory({ attempts, initialLabels, title = 'Investigation history' }: AttemptHistoryProps) {
  if (attempts.length === 0) return null
  return <section className="attempt-history" aria-label={title}>
    <div className="card-heading"><div><p className="step-label">Evidence review</p><h3>{title}</h3></div><span>{attempts.length} recorded result{attempts.length === 1 ? '' : 's'}</span></div>
    <div className="attempt-history-list">{attempts.map((attempt, index) => { const baselineCheck = !attempt.fallback && attempt.method === 'Pixel' && attempt.parameters.epsilon_pixels === 0; return <article className={attempt.fallback ? 'is-fallback' : ''} key={`${attempt.method}-${attempt.action.attempt_number}-${index}`}>
      <div className="attempt-history-heading"><strong>{attempt.method} · {attempt.fallback ? 'System verified repair' : baselineCheck ? 'User baseline check' : `Attempt ${attempt.action.attempt_number}`}</strong><span>{attempt.action.classification_restored ? 'Correct class restored' : 'Still misclassified'}</span></div>
      <dl>
        <div><dt>Parameters</dt><dd>{parameterSummary(attempt.parameters)}</dd></div>
        <div><dt>Classification</dt><dd>{initialLabels[attempt.method]} → {attempt.action.top1.label}</dd></div>
        <div><dt>Result source</dt><dd>{attempt.fallback ? 'Verified fallback' : baselineCheck ? 'User-selected 0/255 baseline' : 'User-selected repair'}</dd></div>
      </dl>
    </article> })}</div>
  </section>
}
