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
  originalImageUrl?: string
  cropSelectionSource?: 'original' | 'attacked'
  cropSelectionLabel?: string
  showConfidenceExplanation?: boolean
}

export function PixelCompareEvidence({ beforeImageUrl, beforeStrength, beforePrediction, afterImageUrl, afterStrength, afterPrediction, correctLabel, subject, classificationRestored, revealOriginalStrength = classificationRestored, originalImageUrl, cropSelectionSource, cropSelectionLabel, showConfidenceExplanation = true }: PixelCompareEvidenceProps) {
  const resolvedOriginalImageUrl = originalImageUrl ?? beforeImageUrl.replace(/\/states\/[^/]+\/image(?:\?.*)?$/, '/original-image')
  return <section className="pixel-compare-evidence pixel-compare-evidence--three-state" aria-label="Pixel strength and classification comparison"><PixelThreeStateComparison originalUrl={resolvedOriginalImageUrl} attackedUrl={beforeImageUrl} repairedUrl={afterImageUrl} attackedStrength={beforeStrength} repairedStrength={afterStrength} attackedPrediction={beforePrediction} repairedPrediction={afterPrediction} correctLabel={correctLabel} subject={subject} classificationRestored={classificationRestored} revealOriginalStrength={revealOriginalStrength} cropSelectionSource={cropSelectionSource} cropSelectionLabel={cropSelectionLabel} showConfidenceExplanation={showConfidenceExplanation} /></section>
}
