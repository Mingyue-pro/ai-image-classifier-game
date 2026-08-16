import { Lock, Unlock } from 'lucide-react'
import { PixelLearningNote } from './PixelLearning'

type PixelStrengthControlProps = {
  values: number[]
  value: number
  currentValue?: number
  showExplanation?: boolean
  baselineUnlocked: boolean
  onChange: (value: number) => void
}

const lockedStrengthsByOptions = new WeakMap<number[], Set<number>>()

export function PixelStrengthControl({ values, value, currentValue, baselineUnlocked, onChange }: PixelStrengthControlProps) {
  const selectedIndex = Math.max(0, values.indexOf(value))
  const lockedStrengths = lockedStrengthsByOptions.get(values) ?? new Set<number>()
  if (!lockedStrengthsByOptions.has(values)) lockedStrengthsByOptions.set(values, lockedStrengths)
  if (currentValue !== undefined) lockedStrengths.add(currentValue)

  return <div className="pixel-strength-control">
    <div className="pixel-strength-heading"><strong>Adjust the Pixel strength</strong></div>
    <PixelLearningNote includeStrength />
    <input aria-label="Pixel strength" type="range" min="0" max={Math.max(0, values.length - 1)} step="1" value={selectedIndex} onChange={(event) => {
      const nextIndex = Number(event.target.value)
      const requested = values[nextIndex === 0 && !baselineUnlocked ? Math.min(1, values.length - 1) : nextIndex]
      if (requested === 0 || !lockedStrengths.has(requested)) onChange(requested)
    }} />
    <div className="pixel-strength-ticks" aria-hidden="true">
      {values.map((option) => {
        const locked = (option === 0 && !baselineUnlocked) || (option !== 0 && lockedStrengths.has(option))
        return <span key={option} className={`${value === option ? 'is-selected' : ''} ${locked ? 'is-locked' : ''}`.trim()}>
          <strong>{option}/255</strong>
          {locked ? <small><Lock size={13} /> Locked</small> : option === 0 ? <small><Unlock size={13} /> Baseline</small> : null}
        </span>
      })}
    </div>
    <p className="control-description">Previously classified strengths are locked so that the next attempt tests a different setting.</p>
    <p className="control-description">{baselineUnlocked ? 'Baseline check unlocked: 0/255 removes the Pixel modification and returns to the original pixels.' : 'The full range is shown. First test a non-zero strength to unlock the 0/255 baseline check.'}</p>
  </div>
}
