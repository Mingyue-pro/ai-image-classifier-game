export const PIXEL_INTRODUCTION_EXPLANATION = 'A Pixel-level modification changes RGB values across many pixels—not just one pixel.'

export const PIXEL_MODIFICATION_EXPLANATION = 'Many pixel values across the image are changed slightly—not just one pixel. These changes may be difficult to notice, but they may still affect the AI’s prediction.'

export const PIXEL_SUBTLE_OBSERVATION = 'Pixel-level changes can be very subtle and may be difficult to notice with the naked eye.'

export const PIXEL_STRENGTH_EXPLANATION = 'Pixel Strength controls the size of the changes made to the RGB values. A higher strength allows larger changes. It does not simply adjust one visual property such as brightness or saturation.'

export const PIXEL_STRENGTH_DETAIL = 'The changes can increase or decrease different RGB values rather than adjusting the whole image in one uniform way.'

export const PIXEL_CLASSIFIER_DIRECTION_DETAIL = 'The direction of the changes is calculated using the classifier.'

export const PIXEL_RECLASSIFY_EXPLANATION = "Visual inspection shows whether the image has changed; reclassification tests whether that change affected the AI image classifier's prediction."

export const PIXEL_LEARNING_SUMMARY = 'Even subtle pixel-level changes that are difficult to see may affect classification. Whether they actually affect the prediction cannot be assumed—it needs to be tested by reclassifying the image.'

export const ENHANCED_DIFFERENCE_EXPLANATION = 'The Enhanced Difference view magnifies small RGB differences so they are easier to see. Each displayed colour represents the relative size of the changes in the R, G and B channels; it is not the pixel’s original colour. This is a visual aid and is not the image sent to the classifier.'

export function PixelConceptNote({ variant = 'full' }: { variant?: 'introduction' | 'full' }) {
  return <aside className="pixel-learning-note" aria-label="About Pixel modification">
    <strong>About Pixel modification</strong>
    <p>{variant === 'introduction' ? PIXEL_INTRODUCTION_EXPLANATION : PIXEL_MODIFICATION_EXPLANATION}</p>
  </aside>
}

export function PixelStrengthHelp({ variant = 'full' }: { variant?: 'compact' | 'full' }) {
  const content = <><p>{PIXEL_STRENGTH_EXPLANATION}</p>{variant === 'full' ? <p>{PIXEL_STRENGTH_DETAIL}</p> : null}</>
  return variant === 'compact'
    ? <details className="pixel-learning-note pixel-strength-help"><summary>What is Pixel Strength?</summary>{content}</details>
    : <aside className="pixel-learning-note pixel-strength-help" aria-label="What is Pixel Strength?"><strong>What is Pixel Strength?</strong>{content}</aside>
}

export function PixelSubtleObservation() {
  return <p>{PIXEL_SUBTLE_OBSERVATION}</p>
}

export function PixelReclassifyConnection({ context = 'before' }: { context?: 'before' | 'after' }) {
  return context === 'before'
    ? <aside className="pixel-learning-note pixel-reclassify-connection" aria-label="Why reclassify the image?"><strong>Why reclassify?</strong><p>Visual inspection shows whether the image has changed; reclassification tests whether that change affected the <strong>AI image classifier&apos;s prediction</strong>. Reclassify the image to obtain classification evidence.</p></aside>
    : <aside className="pixel-learning-note pixel-reclassify-connection" aria-label="Compare RGB and classification evidence"><strong>Connect the evidence</strong><p>Finding RGB differences does not prove that the classification changed. Compare them with the reclassification result to see what happened to the AI’s prediction.</p></aside>
}

export function PixelLearningSummary() {
  return <p className="pixel-learning-summary">{PIXEL_LEARNING_SUMMARY}</p>
}

export function EnhancedDifferenceExplanation() {
  return <div className="enhanced-difference-explanation"><p>{ENHANCED_DIFFERENCE_EXPLANATION}</p><ul className="pixel-inspector__difference-legend" aria-label="Enhanced difference colour guide"><li><strong>Black:</strong> No stored RGB difference.</li><li><strong>Grey:</strong> R, G and B changed by similar amounts. Darker grey means smaller changes; lighter grey means larger changes.</li><li><strong>Coloured:</strong> The RGB channels changed by different amounts. The stronger channel changes shape the displayed colour.</li></ul><p className="enhanced-difference-example"><strong>Example:</strong> If R, G and B each change by 4, the ×32 helper displays (128, 128, 128), which is grey. Grey means equal channel changes—not no change.</p><p>Pixel modification changes RGB values across many pixels, but this does not mean that every pixel or every RGB channel must change.</p></div>
}

// Backwards-compatible composition for existing Stage 2/3 call sites. New flows
// should choose PixelConceptNote and PixelStrengthHelp explicitly.
export function PixelLearningNote({ includeStrength = false }: { includeStrength?: boolean }) {
  return <div className="pixel-learning-stack"><PixelConceptNote />{includeStrength ? <PixelStrengthHelp /> : null}</div>
}

export function PixelStrengthChange({ current, next }: { current: number; next: number }) {
  return <div className="pixel-strength-change" aria-label={`Current strength ${current}/255, new strength ${next}/255`}>
    <strong>Current: {current}/255</strong><span aria-hidden="true">→</span><strong>New: {next}/255</strong>
    <small>Current is the strength used for the most recent classification. New is the strength selected for the next attempt.</small>
  </div>
}
