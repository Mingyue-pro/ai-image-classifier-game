import { useEffect, useRef, useState } from 'react'

import type { ComplexTransferAttempt, Prediction } from '../types'
import { ClassificationResultCard, ImagePreviewCard, PanelTitle } from './GameUi'
import { FixedPixelRegionImage, PixelInspector } from './PixelInspector'
import { PixelStrengthHelp } from './PixelLearning'
import { PixelManipulateLayout } from './PixelManipulateLayout'
import { PixelCompareLayout } from './PixelCompareLayout'
import { useComplexTransferTiming } from '../hooks/useComplexTransferTiming'
import type { ComplexTransferTimingEvent, TimedTransferFactor } from '../hooks/useComplexTransferTiming'


export type ComplexTransferFactor = 'patch' | 'pixel' | 'blur' | 'not_sure'
export type ComplexTransferPrediction = 'restore_correct' | 'change_uncertain' | 'stay_same' | 'not_sure'

export type ComplexTransferPlan = {
  selectedFactor: ComplexTransferFactor
  prediction: ComplexTransferPrediction
  reason: string | null
}

export type ComplexTransferParameters = {
  patch: { size: number; positionX: number; positionY: number }
  pixelStrength: number
  blurLevel: 'high' | 'medium' | 'low' | 'none'
}

export type ComplexTransferManipulation = {
  selectedFactor: Exclude<ComplexTransferFactor, 'not_sure'>
  beforeParameters: ComplexTransferParameters
  afterParameters: ComplexTransferParameters
}

export type ComplexTransferReclassifyResult = {
  imageUrl: string
  beforePrediction: Prediction
  prediction: Prediction
  classificationRestored: boolean
  attemptIndex: number
  remainingAttempts: number
  finished?: boolean
  attemptHistory?: ComplexTransferAttempt[]
  initialClassification?: string
  maxAttempts?: number
}

type ComplexTransferFlowProps = {
  imageUrl: string
  originalImageUrl?: string
  subject: string
  currentPrediction: Prediction
  attemptIndex?: number
  maxAttempts?: number
  initialClassification?: string
  attemptHistory?: ComplexTransferAttempt[]
  runFinished?: boolean
  runSuccess?: boolean
  referenceParameters?: ComplexTransferParameters
  referenceTop1Label?: string
  onPlanConfirmed: (plan: ComplexTransferPlan) => void
  currentParameters?: ComplexTransferParameters
  onManipulationConfirmed?: (manipulation: ComplexTransferManipulation) => void
  onPreview?: (manipulation: ComplexTransferManipulation) => Promise<string>
  onReclassify?: (manipulation: ComplexTransferManipulation, plan: ComplexTransferPlan) => Promise<ComplexTransferReclassifyResult>
  onDecideNext?: () => Promise<void>
  reflectionCompleted?: boolean
  onSubmitReflection?: (answers: { learningReflection: string; newErrorStrategy: string }) => Promise<void>
  onViewReport?: () => Promise<void>
  onTimingEvent?: (event: ComplexTransferTimingEvent) => void
}

const INITIAL_PARAMETERS: ComplexTransferParameters = {
  patch: { size: 0.30, positionX: 0.75, positionY: 0.25 },
  pixelStrength: 4,
  blurLevel: 'high',
}

const BLUR_RADII = { high: 16, medium: 8, low: 4, none: 0 } as const
const BLUR_LABELS = { high: 'High', medium: 'Medium', low: 'Low', none: 'None' } as const
const BLUR_LEVELS = ['none', 'low', 'medium', 'high'] as const
const PIXEL_STRENGTHS = [0, 0.5, 1, 2, 4] as const
const PATCH_SIZES = [0, 0.15, 0.25, 0.30, 0.35] as const

function blurSetting(level: keyof typeof BLUR_RADII): string {
  return `${BLUR_LABELS[level]} · Setting ${BLUR_RADII[level]}`
}

const FACTOR_OPTIONS: Array<[ComplexTransferFactor, string]> = [
  ['patch', 'Patch / visible region'],
  ['pixel', 'Pixel-level modification'],
  ['blur', 'Blur / image clarity'],
  ['not_sure', 'Not sure'],
]

const FIRST_FACTOR_OPTIONS: Array<[ComplexTransferFactor, string]> = [
  ['patch', 'Patch'],
  ['pixel', 'Pixel-level modification'],
  ['blur', 'Blur'],
  ['not_sure', 'Not sure'],
]

const PREDICTION_OPTIONS: Array<[ComplexTransferPrediction, string]> = [
  ['restore_correct', 'The AI may return to the correct category'],
  ['change_uncertain', 'The AI may change category, but I am not sure whether it will be correct'],
  ['stay_same', 'The AI may stay the same'],
  ['not_sure', 'Not sure'],
]

export function ComplexTransferFlow({ imageUrl, subject, currentPrediction, attemptIndex = 0, maxAttempts = 5, initialClassification = currentPrediction.label, attemptHistory = [], runFinished = false, runSuccess = false, referenceParameters, referenceTop1Label = subject, onPlanConfirmed, currentParameters = INITIAL_PARAMETERS, onManipulationConfirmed, onPreview, onReclassify, onDecideNext, reflectionCompleted = false, onSubmitReflection, onViewReport, onTimingEvent }: ComplexTransferFlowProps) {
  const [phase, setPhase] = useState<'observe' | 'plan' | 'manipulate' | 'reclassify' | 'compare' | 'decide' | 'summary' | 'reflection' | 'complete'>(reflectionCompleted ? 'complete' : runFinished ? 'summary' : 'observe')
  const [selectedFactor, setSelectedFactor] = useState<ComplexTransferFactor | ''>('')
  const [activeFactor, setActiveFactor] = useState<Exclude<ComplexTransferFactor, 'not_sure'> | ''>('')
  const [prediction, setPrediction] = useState<ComplexTransferPrediction | ''>('')
  const [reason, setReason] = useState('')
  const [patchMode, setPatchMode] = useState<'position' | 'size' | 'both'>('position')
  const [draftParameters, setDraftParameters] = useState<ComplexTransferParameters>(currentParameters)
  const [confirmedPlan, setConfirmedPlan] = useState<ComplexTransferPlan | null>(null)
  const [pendingManipulation, setPendingManipulation] = useState<ComplexTransferManipulation | null>(null)
  const [reclassifyResult, setReclassifyResult] = useState<ComplexTransferReclassifyResult | null>(null)
  const [isReclassifying, setIsReclassifying] = useState(false)
  const [reclassifyError, setReclassifyError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [attemptBeforeImageUrl, setAttemptBeforeImageUrl] = useState(imageUrl)
  const [nextFactor, setNextFactor] = useState<Exclude<ComplexTransferFactor, 'not_sure'> | ''>('')
  const [isStartingNextAttempt, setIsStartingNextAttempt] = useState(false)
  const [nextAttemptError, setNextAttemptError] = useState<string | null>(null)
  const [learningReflection, setLearningReflection] = useState('')
  const [newErrorStrategy, setNewErrorStrategy] = useState('')
  const [isSubmittingReflection, setIsSubmittingReflection] = useState(false)
  const [reflectionError, setReflectionError] = useState<string | null>(null)
  const reflectionSubmittingRef = useRef(false)
  const timingFactor: TimedTransferFactor = activeFactor || (phase === 'plan' && selectedFactor && selectedFactor !== 'not_sure' ? selectedFactor : null) || (phase === 'decide' && nextFactor ? nextFactor : null) || pendingManipulation?.selectedFactor || null
  const timingAttemptIndex = phase === 'compare' && reclassifyResult
    ? reclassifyResult.attemptIndex
    : ['plan', 'manipulate', 'reclassify', 'decide'].includes(phase)
      ? Math.min(attemptIndex + 1, maxAttempts)
      : attemptIndex

  useComplexTransferTiming(
    { page: phase, factor: timingFactor, attemptIndex: timingAttemptIndex },
    onTimingEvent,
  )

  async function submitReflection() {
    if (!learningReflection.trim() || !newErrorStrategy.trim() || !onSubmitReflection || reflectionSubmittingRef.current) return
    reflectionSubmittingRef.current = true
    setIsSubmittingReflection(true)
    setReflectionError(null)
    try {
      await onSubmitReflection({ learningReflection, newErrorStrategy })
      setPhase('complete')
    } catch (caught) {
      setReflectionError(caught instanceof Error ? caught.message : 'The reflection could not be saved.')
    } finally {
      reflectionSubmittingRef.current = false
      setIsSubmittingReflection(false)
    }
  }

  function confirmPlan() {
    if (!selectedFactor || !prediction) return
    const plan: ComplexTransferPlan = {
      selectedFactor,
      prediction,
      reason: reason.trim() || null,
    }
    onPlanConfirmed(plan)
    setConfirmedPlan(plan)
    setActiveFactor(selectedFactor === 'not_sure' ? '' : selectedFactor)
    setDraftParameters(currentParameters)
    setPhase('manipulate')
  }

  const parametersChanged = activeFactor === 'patch'
    ? JSON.stringify(draftParameters.patch) !== JSON.stringify(currentParameters.patch)
    : activeFactor === 'pixel'
      ? draftParameters.pixelStrength !== currentParameters.pixelStrength
      : activeFactor === 'blur'
        ? draftParameters.blurLevel !== currentParameters.blurLevel
        : false

  useEffect(() => {
    if (phase !== 'manipulate' || !activeFactor || !parametersChanged || !onPreview) {
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const url = await onPreview({ selectedFactor: activeFactor, beforeParameters: currentParameters, afterParameters: draftParameters })
        if (!cancelled) setPreviewUrl(url)
      } catch (caught) {
        if (!cancelled) setReclassifyError(caught instanceof Error ? caught.message : 'The preview could not be generated.')
      }
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [activeFactor, currentParameters, draftParameters, onPreview, parametersChanged, phase])

  function confirmManipulation() {
    if (!activeFactor || !parametersChanged) return
    const manipulation: ComplexTransferManipulation = {
      selectedFactor: activeFactor,
      beforeParameters: currentParameters,
      afterParameters: draftParameters,
    }
    onManipulationConfirmed?.(manipulation)
    setAttemptBeforeImageUrl(imageUrl)
    setPendingManipulation(manipulation)
    setReclassifyResult(null)
    setPhase('reclassify')
  }

  async function runReclassification() {
    if (!pendingManipulation || !confirmedPlan || !onReclassify || isReclassifying) return
    setIsReclassifying(true)
    setReclassifyError(null)
    try {
      const result = await onReclassify(pendingManipulation, confirmedPlan)
      setReclassifyResult(result)
    } catch (caught) {
      setReclassifyError(caught instanceof Error ? caught.message : 'The image could not be reclassified.')
    } finally {
      setIsReclassifying(false)
    }
  }

  async function continueWithNextFactor() {
    if (!nextFactor || !prediction || !onDecideNext || isStartingNextAttempt) return
    setIsStartingNextAttempt(true)
    setNextAttemptError(null)
    try {
      await onDecideNext()
      const plan: ComplexTransferPlan = {
        selectedFactor: nextFactor,
        prediction,
        reason: reason.trim() || null,
      }
      onPlanConfirmed(plan)
      setSelectedFactor(nextFactor)
      setActiveFactor(nextFactor)
      setConfirmedPlan(plan)
      setDraftParameters(currentParameters)
      setPendingManipulation(null)
      setPreviewUrl(null)
      setReclassifyError(null)
      setNextFactor('')
      setPhase('manipulate')
    } catch (caught) {
      setNextAttemptError(caught instanceof Error ? caught.message : 'The current Transfer state could not be loaded.')
    } finally {
      setIsStartingNextAttempt(false)
    }
  }

  function beginNextDecision() {
    setDraftParameters(currentParameters)
    setNextFactor('')
    setPrediction('')
    setReason('')
    setPhase('decide')
  }

  function patchSummary(parameters: ComplexTransferParameters): string {
    return parameters.patch.size === 0 ? 'Removed' : `Size ${Math.round(parameters.patch.size * 100)}% · X ${parameters.patch.positionX.toFixed(2)} · Y ${parameters.patch.positionY.toFixed(2)}`
  }

  function patchStateSummary(parameters: ComplexTransferParameters): string {
    if (parameters.patch.size === 0) return 'Removed · Size 0%'
    const status = parameters.patch.size === 0 ? 'Removed' : 'Enabled'
    return `${status} · Size ${Math.round(parameters.patch.size * 100)}% · X ${parameters.patch.positionX.toFixed(2)} · Y ${parameters.patch.positionY.toFixed(2)}`
  }

  function attemptParameterChange(attempt: ComplexTransferAttempt): string {
    if (attempt.selected_factor === 'patch') {
      return `${patchSummary({ ...currentParameters, patch: { size: attempt.before_parameters.patch.size_fraction, positionX: attempt.before_parameters.patch.position_x, positionY: attempt.before_parameters.patch.position_y } })} → ${patchSummary({ ...currentParameters, patch: { size: attempt.after_parameters.patch.size_fraction, positionX: attempt.after_parameters.patch.position_x, positionY: attempt.after_parameters.patch.position_y } })}`
    }
    if (attempt.selected_factor === 'pixel') return `${attempt.before_parameters.pixel_strength}/255 → ${attempt.after_parameters.pixel_strength}/255`
    return `${blurSetting(attempt.before_parameters.blur_level)} → ${blurSetting(attempt.after_parameters.blur_level)}`
  }

  function renderTransferAttemptHistory() {
    return <div className="stage-three-attempt-records">{attemptHistory.length ? <ol>{attemptHistory.map((attempt) => <li key={attempt.attempt_number}><strong>Attempt {attempt.attempt_number}: {attempt.selected_factor[0].toUpperCase() + attempt.selected_factor.slice(1)} · {attemptParameterChange(attempt)}</strong><span>{attempt.classification_restored ? `Correct · ${attempt.after_classification}` : `Incorrect · ${attempt.after_classification}`}</span></li>)}</ol> : <p>No previous Transfer attempts yet.</p>}</div>
  }

  function renderPixelTransferManipulate() {
    const previewReady = parametersChanged && previewUrl !== null
    const selectedStrengthIndex = Math.max(0, PIXEL_STRENGTHS.indexOf(draftParameters.pixelStrength as (typeof PIXEL_STRENGTHS)[number]))
    return <PixelManipulateLayout modules={[
      {
        key: 'transfer-whole-images',
        title: 'Before · Current Cumulative State | Preview · Selected Strength',
        description: 'The Preview keeps the current Patch and Blur settings and changes only Pixel Strength.',
        content: <div className="stage-two-pixel-whole-images">
          <FixedPixelRegionImage title="Before · Current cumulative state" imageUrl={imageUrl} alt={`Current cumulative ${subject} state with fixed 32 by 32 region`} details={`Current Pixel Strength: ${currentParameters.pixelStrength}/255`} />
          {previewReady ? <FixedPixelRegionImage title="Preview · Selected Strength" imageUrl={previewUrl!} alt={`${subject} Pixel preview with fixed 32 by 32 region`} details={`Selected Strength: ${draftParameters.pixelStrength}/255 · preview only`} /> : <figure className="image-preview-card stage-two-pixel-preview-placeholder"><div className="card-heading"><strong>Preview · Selected Strength</strong></div><div role="status">Choose a new Pixel Strength to preview the modified cumulative state.</div></figure>}
        </div>,
      },
      {
        key: 'transfer-strength',
        title: 'Select a Pixel Strength',
        description: <>Current cumulative state: <strong>{currentParameters.pixelStrength}/255</strong>. Change only this factor for the current attempt.</>,
        content: <><p className="stage-three-repair-goal"><strong>Investigation Goal</strong><span>Investigate the image and find a way to restore the correct classification.</span></p><PixelStrengthHelp variant="compact" /><fieldset><legend>Pixel Strength</legend><div className="pixel-strength-control"><input aria-label="Transfer Pixel Strength" aria-valuetext={`${draftParameters.pixelStrength}/255`} type="range" min="0" max={PIXEL_STRENGTHS.length - 1} step="1" value={selectedStrengthIndex} onChange={(event) => { const value = PIXEL_STRENGTHS[Number(event.target.value)]; setDraftParameters((current) => ({ ...current, pixelStrength: value })) }} /><div className="pixel-strength-ticks transfer-pixel-strength-ticks" aria-hidden="true">{PIXEL_STRENGTHS.map((value) => <span key={value} className={draftParameters.pixelStrength === value ? 'is-selected' : ''}><strong>{value}/255</strong></span>)}</div><p className="field-hint">Each slider stop corresponds exactly to the labelled Pixel Strength below it.</p></div></fieldset><div className="complex-transfer-carried-state"><strong>Current factors retained in this preview</strong><span>Patch: {patchSummary(currentParameters)}</span><span>Blur: {blurSetting(currentParameters.blurLevel)}</span></div></>,
      },
      {
        key: 'transfer-region',
        title: '32×32 Selected Region',
        description: 'This is a basic manipulation preview of the same fixed region before and after this round’s Pixel change.',
        content: <PixelInspector mode="preview" originalUrl={imageUrl} modifiedUrl={previewReady ? previewUrl! : imageUrl} subject={subject} observedStrength={currentParameters.pixelStrength} strength={draftParameters.pixelStrength} previewReady={previewReady} beforeLabelOverride="Before" afterLabelOverride="Preview" />,
      },
      {
        key: 'transfer-attempts',
        title: 'Previous attempts / results',
        content: renderTransferAttemptHistory(),
      },
    ]} />
  }

  const summaryAttempts = reclassifyResult?.attemptHistory ?? attemptHistory
  const summarySuccess = reclassifyResult?.finished ? reclassifyResult.classificationRestored : runSuccess
  const summaryInitialClassification = reclassifyResult?.initialClassification ?? initialClassification
  const summaryMaxAttempts = reclassifyResult?.maxAttempts ?? maxAttempts
  const summaryFinalClassification = reclassifyResult?.prediction.label ?? currentPrediction.label
  const finalAttempt = summaryAttempts[summaryAttempts.length - 1]
  const summaryFinalParameters = finalAttempt ? {
    patch: {
      size: finalAttempt.after_parameters.patch.size_fraction,
      positionX: finalAttempt.after_parameters.patch.position_x,
      positionY: finalAttempt.after_parameters.patch.position_y,
    },
    pixelStrength: finalAttempt.after_parameters.pixel_strength,
    blurLevel: finalAttempt.after_parameters.blur_level,
  } : currentParameters

  return <div className="complex-transfer-flow">
    {phase === 'observe' ? <>
      <PanelTitle
        label="Complex Transfer"
        title="Investigate a new classification error"
        description="The AI has classified this image incorrectly. Investigate what might be affecting the classification."
      />
      <div className="complex-transfer-observation">
        <ImagePreviewCard title="New image" imageUrl={imageUrl} alt={`New Transfer image showing ${subject}`} />
        <ClassificationResultCard title="Starting classification" prediction={currentPrediction} correctLabel={subject} details={<div className="attempt-limit-detail"><dt>Investigation limit</dt><dd>Up to {maxAttempts} valid attempts</dd></div>} />
      </div>
      <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={() => setPhase('plan')}>Plan the first investigation</button></div>
    </> : null}

    {phase === 'plan' ? <>
      <PanelTitle label="Complex Transfer" title="Choose your investigation" description="Choose one factor and predict what its next change may do. You will test only that factor in this attempt." />
      <p className="factor-neutral-note"><strong>Patch and Pixel were examples used for practice in Stage 3.</strong> Patch, Pixel-level modification, and Blur are examples of factors you can investigate here. They are not required steps, and there is no fixed order. Use the evidence to decide what to investigate.</p>
      <fieldset className="choice-group choice-card-grid complex-transfer-first-factor"><legend>What would you like to investigate first?</legend>{FIRST_FACTOR_OPTIONS.map(([value, label]) => <label key={value} className={selectedFactor === value ? 'is-selected' : ''}><input type="radio" name="complex-transfer-factor" checked={selectedFactor === value} onChange={() => setSelectedFactor(value)} />{label}</label>)}</fieldset>
      <fieldset className="choice-group"><legend>What do you expect will happen if you make this change?</legend>{PREDICTION_OPTIONS.map(([value, label]) => <label key={value} className={prediction === value ? 'is-selected' : ''}><input type="radio" name="complex-transfer-prediction" checked={prediction === value} onChange={() => setPrediction(value)} />{label}</label>)}</fieldset>
      <label className="open-response"><strong>Why do you want to test this {attemptIndex > 0 ? 'next' : 'first'}? <span>(optional)</span></strong><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('observe')}>Back to Observe</button><button className="primary-button" type="button" disabled={!selectedFactor || !prediction} onClick={confirmPlan}>Confirm plan</button></div>
    </> : null}

    {phase === 'manipulate' ? <>
      <PanelTitle label="Complex Transfer" title={activeFactor ? `Adjust the ${activeFactor === 'pixel' ? 'Pixel-level modification' : activeFactor}` : 'Choose one tool for this attempt'} description="Only one factor can be changed in this attempt. The other two factors keep their current values." />
      {!activeFactor ? <fieldset className="choice-group choice-card-grid"><legend>You were not sure which factor to investigate. Choose one tool to test now.</legend>{FACTOR_OPTIONS.filter(([value]) => value !== 'not_sure').map(([value, label]) => <label key={value}><input type="radio" name="complex-transfer-active-tool" onChange={() => setActiveFactor(value as Exclude<ComplexTransferFactor, 'not_sure'>)} />{label}</label>)}</fieldset> : null}
      {activeFactor === 'pixel' ? renderPixelTransferManipulate() : null}
      {activeFactor && activeFactor !== 'pixel' ? <div className="complex-transfer-manipulate-layout">
        <ImagePreviewCard title={previewUrl ? 'Preview of this change' : 'Current image before this change'} imageUrl={previewUrl ?? imageUrl} alt={`Current Complex Transfer image showing ${subject}`} />
        <section className="complex-transfer-tool" aria-label={`${activeFactor} manipulation tool`}>
          <div className="complex-transfer-carried-state"><strong>Current state carried into this attempt</strong><span>Patch: {patchSummary(currentParameters)}</span><span>Pixel: {currentParameters.pixelStrength}/255</span><span>Blur: {blurSetting(currentParameters.blurLevel)}</span></div>
          {activeFactor === 'patch' ? <>
            <fieldset className="choice-group choice-card-grid complex-transfer-patch-mode"><legend>What will you adjust?</legend>{([['position', 'Position'], ['size', 'Size'], ['both', 'Both']] as const).map(([value, label]) => <label key={value} className={patchMode === value ? 'is-selected' : ''}><input type="radio" name="complex-transfer-patch-mode" checked={patchMode === value} onChange={() => setPatchMode(value)} />{label}</label>)}</fieldset>
            {patchMode !== 'size' ? <><label className="repair-slider"><span>Horizontal position <strong>{draftParameters.patch.positionX.toFixed(2)}</strong></span><input aria-label="Patch horizontal position" type="range" min="0" max="1" step="0.05" value={draftParameters.patch.positionX} onChange={(event) => setDraftParameters((current) => ({ ...current, patch: { ...current.patch, positionX: Number(event.target.value) } }))} /></label><label className="repair-slider"><span>Vertical position <strong>{draftParameters.patch.positionY.toFixed(2)}</strong></span><input aria-label="Patch vertical position" type="range" min="0" max="1" step="0.05" value={draftParameters.patch.positionY} onChange={(event) => setDraftParameters((current) => ({ ...current, patch: { ...current.patch, positionY: Number(event.target.value) } }))} /></label></> : <p className="fixed-parameter-note">Current position stays at X {currentParameters.patch.positionX.toFixed(2)}, Y {currentParameters.patch.positionY.toFixed(2)} for this attempt.</p>}
            {patchMode !== 'position' ? <fieldset><legend>Patch size</legend><div className="patch-option-row">{PATCH_SIZES.map((value) => <button type="button" key={value} className={draftParameters.patch.size === value ? 'is-selected' : ''} aria-pressed={draftParameters.patch.size === value} onClick={() => setDraftParameters((current) => ({ ...current, patch: { ...current.patch, size: value } }))}>{value === 0 ? 'Remove' : `${Math.round(value * 100)}%`}</button>)}</div></fieldset> : <p className="fixed-parameter-note">Current Patch size stays at {Math.round(currentParameters.patch.size * 100)}% for this attempt.</p>}
          </> : null}
          {activeFactor === 'blur' ? <fieldset><legend>Blur Strength</legend><p className="factor-neutral-note">Blur Strength controls how strongly and broadly neighbouring pixel values are blended. A higher value produces a stronger, more widespread blur.</p><div className="complex-transfer-level-options">{BLUR_LEVELS.map((level) => <button type="button" key={level} className={draftParameters.blurLevel === level ? 'is-selected' : ''} aria-pressed={draftParameters.blurLevel === level} onClick={() => setDraftParameters((current) => ({ ...current, blurLevel: level }))}><strong>{BLUR_LABELS[level]}</strong><span>Setting {BLUR_RADII[level]}</span></button>)}</div><details className="pixel-strength-help"><summary>? What do the Blur values mean?</summary><p>The values are Gaussian Blur settings selected for this investigation. 0 means no blur. Higher values produce stronger blur across a broader neighbourhood. Other values are possible, but this investigation uses four controlled settings. The values are not pixel counts or circular boundaries.</p></details></fieldset> : null}
        </section>
      </div> : null}
      {activeFactor === 'patch' || activeFactor === 'blur' ? <section className="stage-three-previous-attempts" aria-label={`Previous Transfer attempts and results for ${activeFactor}`}><h3>Previous attempts / results</h3>{renderTransferAttemptHistory()}</section> : null}
      {activeFactor && !parametersChanged ? <p className="reclassify-required-notice" role="status">Please make a change before reclassifying.</p> : null}
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase(reclassifyResult ? 'decide' : 'plan')}>Back to Choose</button><button className="primary-button" type="button" disabled={!activeFactor || !parametersChanged} onClick={confirmManipulation}>Continue</button></div>
    </> : null}

    {phase === 'reclassify' && pendingManipulation ? <>
      <PanelTitle label="Complex Transfer" title="Image after manipulation" description="Send the image after this adjustment to the classifier, then review the new classification before comparing the evidence." />
      <div className="reclassify-action-layout"><ImagePreviewCard title="Image after manipulation" imageUrl={reclassifyResult?.imageUrl ?? previewUrl ?? imageUrl} alt={`Complex Transfer ${subject} after manipulation`} /><div className="reclassify-center-action"><span>Send this image to the classifier</span><button className="primary-button" type="button" disabled={!onReclassify || isReclassifying || reclassifyResult !== null} onClick={() => void runReclassification()}>{isReclassifying ? 'Reclassifying…' : reclassifyResult ? 'Reclassified' : 'Reclassify image'}</button></div><ClassificationResultCard title="New classification" prediction={reclassifyResult?.prediction} correctLabel={subject} reveal={reclassifyResult !== null} /></div>
      {reclassifyError ? <p className="error-message" role="alert">{reclassifyError}</p> : null}
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('manipulate')}>Back to Manipulate</button>{reclassifyResult ? <button className="primary-button" type="button" onClick={() => setPhase('compare')}>Next</button> : null}</div>
    </> : null}

    {phase === 'compare' && pendingManipulation && reclassifyResult ? <>
      <PanelTitle label="Complex Transfer" title={reclassifyResult.classificationRestored ? 'Classification restored' : 'Still incorrect'} description="Compare the state before and after this single-factor change." />
      <div className="comparison-evidence"><div><ImagePreviewCard title="Before this adjustment" imageUrl={attemptBeforeImageUrl} alt={`${subject} before the ${pendingManipulation.selectedFactor} adjustment`} /><ClassificationResultCard title="Before classification" prediction={reclassifyResult.beforePrediction} correctLabel={subject} details={<><div><dt>Patch</dt><dd>{patchSummary(pendingManipulation.beforeParameters)}</dd></div><div><dt>Pixel strength</dt><dd>{pendingManipulation.beforeParameters.pixelStrength}/255</dd></div><div><dt>Blur Strength</dt><dd>{blurSetting(pendingManipulation.beforeParameters.blurLevel)}</dd></div></>} /></div><div><ImagePreviewCard title="After this adjustment" imageUrl={reclassifyResult.imageUrl} alt={`${subject} after the ${pendingManipulation.selectedFactor} adjustment`} /><ClassificationResultCard title="After classification" prediction={reclassifyResult.prediction} correctLabel={subject} details={<><div><dt>Patch {pendingManipulation.selectedFactor === 'patch' ? <small className="modified-factor-badge">Modified factor</small> : null}</dt><dd>{patchSummary(pendingManipulation.afterParameters)}</dd></div><div><dt>Pixel strength {pendingManipulation.selectedFactor === 'pixel' ? <small className="modified-factor-badge">Modified factor</small> : null}</dt><dd>{pendingManipulation.afterParameters.pixelStrength}/255</dd></div><div><dt>Blur Strength {pendingManipulation.selectedFactor === 'blur' ? <small className="modified-factor-badge">Modified factor</small> : null}</dt><dd>{blurSetting(pendingManipulation.afterParameters.blurLevel)}</dd></div></>} /></div></div>
      {pendingManipulation.selectedFactor === 'pixel' ? <PixelCompareLayout mode="two-state" beforeImageUrl={attemptBeforeImageUrl} afterImageUrl={reclassifyResult.imageUrl} subject={subject} beforeStrength={pendingManipulation.beforeParameters.pixelStrength} afterStrength={pendingManipulation.afterParameters.pixelStrength} beforeLabel="Pre-round cumulative state" afterLabel="Post-round state" showEnhancedDifference collapsible /> : null}
      <dl className="complex-transfer-result-facts"><div><dt>Result</dt><dd>{reclassifyResult.classificationRestored ? 'Classification restored' : 'Still incorrect'}</dd></div><div><dt>Remaining attempts</dt><dd>{reclassifyResult.remainingAttempts}</dd></div></dl>
      <div className="stage-navigation stage-navigation--end">{!reclassifyResult.classificationRestored && reclassifyResult.remainingAttempts > 0 ? <button className="primary-button" type="button" onClick={beginNextDecision}>Continue repair</button> : <button className="primary-button" type="button" onClick={() => setPhase('summary')}>Continue to Summary</button>}</div>
    </> : null}

    {phase === 'decide' && reclassifyResult ? <>
      <PanelTitle label="Complex Transfer" title="Choose and predict the next adjustment" description="Choose one factor based on the previous result, then record what you expect from this adjustment." />
      <section className="complex-transfer-decide-next" aria-label="Next factor selection">
        <p><strong>What would you like to investigate next?</strong> You may continue with the same factor or investigate a different one, based on the evidence.</p>
        <div className="choice-group choice-card-grid" role="radiogroup" aria-label="Next factor to investigate">{FACTOR_OPTIONS.filter(([value]) => value !== 'not_sure').map(([value, label]) => <label key={value} className={nextFactor === value ? 'is-selected' : ''}><input type="radio" name="complex-transfer-next-factor" checked={nextFactor === value} onChange={() => setNextFactor(value as Exclude<ComplexTransferFactor, 'not_sure'>)} />{label}</label>)}</div>
        <fieldset className="choice-group"><legend>What do you expect will happen if you make this adjustment?</legend>{PREDICTION_OPTIONS.map(([value, label]) => <label key={value} className={prediction === value ? 'is-selected' : ''}><input type="radio" name="complex-transfer-next-prediction" checked={prediction === value} onChange={() => setPrediction(value)} />{label}</label>)}</fieldset>
        <label className="open-response"><strong>Why do you want to test this next? <span>(optional)</span></strong><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        {nextAttemptError ? <p className="error-message" role="alert">{nextAttemptError}</p> : null}
        <div className="stage-navigation stage-navigation--end"><button className="secondary-button" type="button" onClick={() => setPhase('compare')}>Back to Compare</button><button className="primary-button" type="button" disabled={!nextFactor || !prediction || !onDecideNext || isStartingNextAttempt} onClick={() => void continueWithNextFactor()}>{isStartingNextAttempt ? 'Loading current state…' : 'Continue to Manipulate'}</button></div>
      </section>
    </> : null}

    {phase === 'summary' ? <>
      <PanelTitle label="Complex Transfer" title={summarySuccess ? 'Classification restored' : 'Investigation complete'} description={summarySuccess ? 'The AI classification returned to the expected class.' : 'The classification was not restored within five attempts.'} />
      <section className="complex-transfer-summary-result" aria-label="Transfer result">
        <dl><div><dt>Initial AI classification</dt><dd>{summaryInitialClassification}</dd></div><div><dt>Final AI classification</dt><dd>{summaryFinalClassification}</dd></div><div><dt>Attempts used</dt><dd>{summaryAttempts.length} / {summaryMaxAttempts}</dd></div></dl>
      </section>
      {summarySuccess ? <section className="complex-transfer-final-state" aria-labelledby="complex-transfer-final-repair-title"><h3 id="complex-transfer-final-repair-title">Final repair parameters</h3><dl><div><dt>Patch</dt><dd>{patchStateSummary(summaryFinalParameters)}</dd></div><div><dt>Pixel strength</dt><dd>{summaryFinalParameters.pixelStrength}/255</dd></div><div><dt>Blur Strength</dt><dd>{blurSetting(summaryFinalParameters.blurLevel)}</dd></div><div><dt>Final classification</dt><dd>{summaryFinalClassification}</dd></div></dl></section> : null}
      <section className="complex-transfer-history" aria-labelledby="complex-transfer-history-title">
        <h3 id="complex-transfer-history-title">Attempt sequence</h3>
        <ol>{summaryAttempts.map((attempt) => <li key={attempt.attempt_number}><div className="card-heading"><strong>Attempt {attempt.attempt_number} — {attempt.selected_factor[0].toUpperCase() + attempt.selected_factor.slice(1)}</strong></div><dl><div><dt>Prediction</dt><dd>{PREDICTION_OPTIONS.find(([value]) => value === attempt.prediction)?.[1] ?? attempt.prediction}</dd></div><div><dt>Parameter change</dt><dd>{attemptParameterChange(attempt)}</dd></div><div><dt>Classification</dt><dd>{attempt.before_classification} → {attempt.after_classification}</dd></div></dl></li>)}</ol>
      </section>
      {summarySuccess ? <p className="complex-transfer-neutral-summary">These changes were associated with the classification returning in this case. The results show what happened for this image and this model under the changes you tested.</p> : <>
        <p className="complex-transfer-neutral-summary">The attempts made during this investigation were not enough to restore the classification.</p>
        {referenceParameters ? <>
          <section className="complex-transfer-state-comparison" aria-labelledby="complex-transfer-state-comparison-title"><h3 id="complex-transfer-state-comparison-title">Your final state vs one verified reference</h3><p>One verified reference is a parameter configuration that produced the correct classification for this case. Other parameter combinations may also produce different results.</p><div><section aria-label="Your final state"><h4>Your final state</h4><dl><div><dt>Patch</dt><dd>{patchStateSummary(summaryFinalParameters)}</dd></div><div><dt>Pixel strength</dt><dd>{summaryFinalParameters.pixelStrength}/255</dd></div><div><dt>Blur Strength</dt><dd>{blurSetting(summaryFinalParameters.blurLevel)}</dd></div><div><dt>Final state classification</dt><dd>{summaryFinalClassification}</dd></div></dl></section><section aria-label="One verified reference"><h4>One verified reference</h4><dl><div><dt>Patch</dt><dd>{patchStateSummary(referenceParameters)}</dd></div><div><dt>Pixel strength</dt><dd>{referenceParameters.pixelStrength}/255</dd></div><div><dt>Blur Strength</dt><dd>{blurSetting(referenceParameters.blurLevel)}</dd></div><div><dt>Verified classification</dt><dd>{referenceTop1Label}</dd></div></dl></section></div></section>
        </> : null}
      </>}
      <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={() => setPhase('reflection')}>Continue to reflection</button></div>
    </> : null}

    {phase === 'reflection' ? <>
      <PanelTitle label="Complex Transfer" title="Reflect on your investigation" description="Answer both questions based on your own investigation." />
      <section className="complex-transfer-reflection" aria-labelledby="complex-transfer-reflection-title">
        <h3 id="complex-transfer-reflection-title">Transfer reflection</h3>
        <label>What did you learn from the results of your different attempts?<textarea value={learningReflection} onChange={(event) => setLearningReflection(event.target.value)} /></label>
        <label>If you encountered a new AI image-classification error and did not know the cause, how would you investigate it?<textarea value={newErrorStrategy} onChange={(event) => setNewErrorStrategy(event.target.value)} /></label>
        {reflectionError ? <p className="error-message" role="alert">{reflectionError}</p> : null}
        <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" disabled={!learningReflection.trim() || !newErrorStrategy.trim() || !onSubmitReflection || isSubmittingReflection} onClick={() => void submitReflection()}>{isSubmittingReflection ? 'Saving reflection…' : 'Finish transfer'}</button></div>
      </section>
    </> : null}

    {phase === 'complete' ? <>
      <PanelTitle label="Complex Transfer" title="Transfer complete" description="Patch, Pixel and Blur were examples; the reusable outcome is the investigation process." />
      {onViewReport ? <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={() => void onViewReport()}>View Investigator Report</button></div> : null}
    </> : null}
  </div>
}
