import { Lock, Unlock } from 'lucide-react'

type PixelStrengthControlProps = {
  values: number[]
  value: number
  baselineUnlocked: boolean
  onChange: (value: number) => void
}

export function PixelStrengthControl({ values, value, baselineUnlocked, onChange }: PixelStrengthControlProps) {
  const selectedIndex = Math.max(0, values.indexOf(value))

  return <div className="pixel-strength-control">
    <div className="pixel-strength-heading"><strong>Adjust the Pixel strength</strong><span>Current: {value}/255</span></div>
    <input aria-label="Pixel strength" type="range" min="0" max={Math.max(0, values.length - 1)} step="1" value={selectedIndex} onChange={(event) => {
      const nextIndex = Number(event.target.value)
      onChange(values[nextIndex === 0 && !baselineUnlocked ? Math.min(1, values.length - 1) : nextIndex])
    }} />
    <div className="pixel-strength-ticks" aria-hidden="true">
      {values.map((option) => {
        const locked = option === 0 && !baselineUnlocked
        return <span key={option} className={value === option ? 'is-selected' : ''}>
          <strong>{option}/255</strong>
          {option === 0 ? <small>{locked ? <><Lock size={13} /> Locked</> : <><Unlock size={13} /> Baseline</>}</small> : null}
        </span>
      })}
    </div>
    <p className="control-description">{baselineUnlocked ? 'Baseline check unlocked: 0/255 removes the Pixel modification and returns to the original pixels.' : 'The full range is shown. First test a non-zero strength to unlock the 0/255 baseline check.'}</p>
  </div>
}
