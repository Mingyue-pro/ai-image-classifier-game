import type { Prediction } from '../types'
import { PixelThreeStateComparison } from './PixelThreeStateComparison'

type PixelCompareEvidenceProps = {
  beforeImageUrl: string
  beforeStrength: number
  beforePrediction: Prediction
  afterImageUrl: string
  afterStrength: number
  afterPrediction: Prediction
  correctLabel: string
  subject: string
  classificationRestored: boolean
  revealOriginalStrength?: boolean
}

export function PixelCompareEvidence({ beforeImageUrl, beforeStrength, beforePrediction, afterImageUrl, afterStrength, afterPrediction, correctLabel, subject, classificationRestored, revealOriginalStrength = classificationRestored }: PixelCompareEvidenceProps) {
  const originalImageUrl = beforeImageUrl.replace(/\/states\/[^/]+\/image(?:\?.*)?$/, '/original-image')
  return <section className="pixel-compare-evidence pixel-compare-evidence--three-state" aria-label="Pixel strength and classification comparison"><PixelThreeStateComparison originalUrl={originalImageUrl} attackedUrl={beforeImageUrl} repairedUrl={afterImageUrl} attackedStrength={beforeStrength} repairedStrength={afterStrength} attackedPrediction={beforePrediction} repairedPrediction={afterPrediction} correctLabel={correctLabel} subject={subject} classificationRestored={classificationRestored} revealOriginalStrength={revealOriginalStrength} /></section>
}
