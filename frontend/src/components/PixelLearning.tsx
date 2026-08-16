export const PIXEL_MODIFICATION_EXPLANATION = 'Pixel modification makes small adjustments to the RGB values of many pixels in the image. Unlike a Patch, it may not add an obvious object, but it can still change the AI’s classification judgement.'

export const PIXEL_STRENGTH_EXPLANATION = 'Pixel modification strength means how strongly the system modifies the image’s pixel values. For example, 1/255 is a very small adjustment: up to one level on the 0–255 scale used for each RGB colour channel.'

export function PixelLearningNote({ includeStrength = false }: { includeStrength?: boolean }) {
  return <aside className="pixel-learning-note" aria-label="About Pixel modification">
    <strong>About Pixel modification</strong>
    <p>{PIXEL_MODIFICATION_EXPLANATION}</p>
    {includeStrength ? <p>{PIXEL_STRENGTH_EXPLANATION}</p> : null}
  </aside>
}

export function PixelStrengthChange({ current, next }: { current: number; next: number }) {
  return <div className="pixel-strength-change" aria-label={`Current strength ${current}/255, new strength ${next}/255`}>
    <strong>Current: {current}/255</strong><span aria-hidden="true">→</span><strong>New: {next}/255</strong>
    <small>Current is the strength used for the most recent classification. New is the strength selected for the next attempt.</small>
  </div>
}
