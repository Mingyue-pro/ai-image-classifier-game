import type { Prediction } from '../types'
import { PixelCompareEvidence } from './PixelCompareEvidence'
import { PixelInspector } from './PixelInspector'

type TwoStateProps = {
  mode: 'two-state'
  beforeImageUrl: string
  afterImageUrl: string
  subject: string
  beforeStrength: number
  afterStrength: number
  beforeLabel: string
  afterLabel: string
  teaching?: boolean
  allowRegionSelection?: boolean
  showEnhancedDifference?: boolean
  collapsible?: boolean
}

type ThreeStateProps = {
  mode: 'three-state'
  originalImageUrl?: string
  attackedImageUrl: string
  adjustedImageUrl: string
  subject: string
  attackedStrength: number
  adjustedStrength: number
  attackedPrediction: Prediction
  adjustedPrediction: Prediction
  correctLabel: string
  classificationRestored: boolean
  revealOriginalStrength?: boolean
  cropSelectionSource?: 'original' | 'attacked'
  cropSelectionLabel?: string
  showConfidenceExplanation?: boolean
}

export type PixelCompareLayoutProps = TwoStateProps | ThreeStateProps

export function PixelCompareLayout(props: PixelCompareLayoutProps) {
  if (props.mode === 'three-state') {
    return <PixelCompareEvidence
      beforeImageUrl={props.attackedImageUrl}
      beforeStrength={props.attackedStrength}
      beforePrediction={props.attackedPrediction}
      afterImageUrl={props.adjustedImageUrl}
      afterStrength={props.adjustedStrength}
      afterPrediction={props.adjustedPrediction}
      correctLabel={props.correctLabel}
      subject={props.subject}
      classificationRestored={props.classificationRestored}
      revealOriginalStrength={props.revealOriginalStrength}
      originalImageUrl={props.originalImageUrl}
      cropSelectionSource={props.cropSelectionSource}
      cropSelectionLabel={props.cropSelectionLabel}
      showConfidenceExplanation={props.showConfidenceExplanation}
    />
  }

  const inspector = <PixelInspector
    mode={props.teaching ? 'teaching' : 'comparison'}
    originalUrl={props.beforeImageUrl}
    referenceOriginalUrl={props.beforeImageUrl}
    modifiedUrl={props.afterImageUrl}
    subject={props.subject}
    observedStrength={props.beforeStrength}
    strength={props.afterStrength}
    beforeLabelOverride={props.beforeLabel}
    afterLabelOverride={props.afterLabel}
    allowRegionSelection={props.allowRegionSelection}
    showEnhancedDifference={props.showEnhancedDifference}
  />
  return props.collapsible ? <details className="pixel-compare-disclosure"><summary>Inspect pixel-level differences</summary>{inspector}</details> : inspector
}
