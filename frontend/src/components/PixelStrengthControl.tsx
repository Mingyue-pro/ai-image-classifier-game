import { PixelLearningNote, PixelStrengthHelp } from './PixelLearning'

type PixelStrengthControlProps = {
  values: number[]
  value: number
  currentValue?: number
  initialValue?: number
  showExplanation?: boolean
  learningMode?: 'full' | 'compact'
  baselineUnlocked: boolean
  onChange: (value: number) => void
}

const lockedStrengthsByOptions = new WeakMap<number[], Set<number>>()

export function PixelStrengthControl({ values, value, currentValue, initialValue, learningMode = 'full', baselineUnlocked, onChange }: PixelStrengthControlProps) {
  const selectedIndex = Math.max(0, values.indexOf(value))
  const lockedStrengths = lockedStrengthsByOptions.get(values) ?? new Set<number>()
  if (!lockedStrengthsByOptions.has(values)) lockedStrengthsByOptions.set(values, lockedStrengths)
  if (currentValue !== undefined) lockedStrengths.add(currentValue)

  return <div className="pixel-strength-control">
    <div className="pixel-strength-heading"><strong>Adjust the Pixel strength</strong></div>
    {learningMode === 'full' ? <PixelLearningNote includeStrength /> : <PixelStrengthHelp variant="compact" />}
    <input aria-label="Pixel strength" type="range" min="0" max={Math.max(0, values.length - 1)} step="1" value={selectedIndex} onChange={(event) => {
      const nextIndex = Number(event.target.value)
      const requested = values[nextIndex]
      if (requested === 0 && !baselineUnlocked) return
      if (requested === 0 || !lockedStrengths.has(requested)) onChange(requested)
    }} />
    <div className="pixel-strength-ticks" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(48px, 1fr))` }}>
      {values.map((option) => {
        const previouslySelected = option !== 0 && lockedStrengths.has(option)
        return <span key={option} className={value === option ? 'is-selected' : ''}>
          <strong>{option}/255</strong>
          {option === initialValue ? <small>Initial value</small> : previouslySelected ? <small>Previously selected</small> : option === 0 ? <small>Remove</small> : null}
        </span>
      })}
    </div>
    <p className="control-description">Choose a value you have not previously tested in this repair investigation.</p>
  </div>
}
