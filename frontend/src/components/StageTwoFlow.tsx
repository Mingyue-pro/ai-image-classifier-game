import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Move, Sparkles } from 'lucide-react'

import { completeStageRun, previewRuntimeImage, reclassifyRuntimeImage, resolveApiUrl, saveStageResponse } from '../api'
import type { ActiveStage, ParameterRule, StageTwoAttempt } from '../types'
import { ClassificationResultCard, ImagePreviewCard, PanelTitle, SimulationNotice, StatusBadge, StepProgress } from './GameUi'
import { FixedPixelRegionImage, PixelInspector } from './PixelInspector'
import { PixelCompareLayout } from './PixelCompareLayout'
import { PixelConceptNote, PixelReclassifyConnection, PixelStrengthHelp } from './PixelLearning'
import { PixelManipulateLayout } from './PixelManipulateLayout'

type Phase = 'observe' | 'manipulate' | 'predict' | 'reclassify' | 'compare' | 'reflection' | 'summary' | 'complete'
type Method = 'Patch' | 'Pixel'
type PredictionChoice = 'classification_changes' | 'classification_stays_same' | 'uncertain'

type StageTwoFlowProps = {
  cases: ActiveStage[]
  nextError: string | null
  onStageComplete: (cases: ActiveStage[]) => void
  onContinue: () => void
  isMovingNext: boolean
}

const STEPS = ['Observe', 'Manipulate', 'Predict', 'Reclassify', 'Compare', 'Reflection'] as const
const PHASE_INDEX: Record<Phase, number> = { observe: 0, manipulate: 1, predict: 2, reclassify: 3, compare: 4, reflection: 5, summary: 5, complete: 5 }
const PATCH_POSITIONS = [
  { label: 'Top left', x: 0.4, y: 0.4, left: '18%', top: '20%' },
  { label: 'Top right', x: 0.6, y: 0.4, left: '82%', top: '20%' },
  { label: 'Centre', x: 0.5, y: 0.5, left: '50%', top: '50%' },
  { label: 'Bottom left', x: 0.4, y: 0.7, left: '18%', top: '80%' },
  { label: 'Bottom right', x: 0.6, y: 0.7, left: '82%', top: '80%' },
] as const

function methodFor(activeCase: ActiveStage): Method {
  return activeCase.playerCase.attack_type === 'fgsm' ? 'Pixel' : 'Patch'
}

function initialParameters(rules: ParameterRule[]): Record<string, number> {
  return Object.fromEntries(rules.flatMap((rule) => typeof rule.initial_value === 'number' ? [[rule.parameter, rule.initial_value]] : []))
}

function nonZeroValues(values: number[] | undefined): number[] {
  return (values ?? []).filter((value) => value > 0)
}

function parameterLabel(name: string, value: number): string {
  if (name === 'epsilon_pixels') return `${value}/255`
  if (name === 'size_fraction') return `${Math.round(value * 100)}%`
  return value.toFixed(2)
}

function parameterSummary(parameters: Record<string, number>): string {
  return Object.entries(parameters).map(([name, value]) => {
    if (name === 'size_fraction') return `Size ${parameterLabel(name, value)}`
    if (name === 'position_x') return `X ${parameterLabel(name, value)}`
    if (name === 'position_y') return `Y ${parameterLabel(name, value)}`
    return `Strength ${parameterLabel(name, value)}`
  }).join(' · ')
}

function attemptKey(parameters: Record<string, number>): string {
  return Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${name}:${value}`).join('|')
}

export function StageTwoFlow({ cases, nextError, onStageComplete, onContinue, isMovingNext }: StageTwoFlowProps) {
  const [phase, setPhase] = useState<Phase>('observe')
  const [selectedMethod, setSelectedMethod] = useState<Method>('Patch')
  const [methodChosen, setMethodChosen] = useState(false)
  const [parametersByMethod, setParametersByMethod] = useState<Record<Method, Record<string, number>>>(() => ({
    Patch: initialParameters(cases.find((item) => methodFor(item) === 'Patch')?.playerCase.parameter_rules ?? []),
    Pixel: initialParameters(cases.find((item) => methodFor(item) === 'Pixel')?.playerCase.parameter_rules ?? []),
  }))
  const [prediction, setPrediction] = useState<PredictionChoice | ''>('')
  const [attempts, setAttempts] = useState<StageTwoAttempt[]>([])
  const [currentAttempt, setCurrentAttempt] = useState<StageTwoAttempt | null>(null)
  const [reflectionChoice, setReflectionChoice] = useState('')
  const [completedCases, setCompletedCases] = useState<ActiveStage[] | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pixelStrengthSelected, setPixelStrengthSelected] = useState(false)
  const [pixelSelectionError, setPixelSelectionError] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submissionLock = useRef(false)
  const [reclassifyPrompt, setReclassifyPrompt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedCase = cases.find((item) => methodFor(item) === selectedMethod) ?? cases[0]
  const caseAttempts = (method: Method) => attempts.filter((attempt) => attempt.method === method)
  const changedFromStartingResult = (attempt: StageTwoAttempt) => {
    const activeCase = cases.find((item) => methodFor(item) === attempt.method)
    return attempt.action.top1.label !== activeCase?.playerCase.initial_top1.label
  }
  const predictionResult = (attempt: StageTwoAttempt) => {
    if (attempt.prediction === 'uncertain') return 'Not scored'
    const predictedChange = attempt.prediction === 'classification_changes'
    return predictedChange === changedFromStartingResult(attempt) ? 'Matched' : 'Did not match'
  }
  const methodReady = (method: Method) => {
    const methodAttempts = caseAttempts(method)
    const uniqueParameters = new Set(methodAttempts.map((attempt) => attemptKey(attempt.parameters)))
    const outcomes = new Set(methodAttempts.map((attempt) => attempt.action.correct_label_is_top1))
    return uniqueParameters.size >= 2 && outcomes.size >= 2
  }
  const allReady = methodReady('Patch') && methodReady('Pixel')

  const attemptedKeys = useMemo(() => new Set(attempts.filter((item) => item.method === selectedMethod).map((item) => attemptKey(item.parameters))), [attempts, selectedMethod])
  const currentParameters = parametersByMethod[selectedMethod]
  const pixelStartingStrength = initialParameters(cases.find((item) => methodFor(item) === 'Pixel')?.playerCase.parameter_rules ?? []).epsilon_pixels ?? 0
  const pixelStrengthValues = nonZeroValues(cases.find((item) => methodFor(item) === 'Pixel')?.playerCase.parameter_rules[0].allowed_values)
  const attemptedPixelStrengths = new Set(caseAttempts('Pixel').map((attempt) => attempt.parameters.epsilon_pixels))
  const duplicateParameters = attemptedKeys.has(attemptKey(currentParameters))
  const startingParameters = initialParameters(selectedCase.playerCase.parameter_rules)
  const startingParametersSelected = attemptKey(currentParameters) === attemptKey(startingParameters)
  const cannotPredict = duplicateParameters || startingParametersSelected
  const pixelPreviewReady = selectedMethod === 'Pixel' && pixelStrengthSelected && !cannotPredict && previewUrl !== null && !isPreviewing

  useEffect(() => {
    if (phase !== 'manipulate' || !methodChosen || (selectedMethod === 'Pixel' && (!pixelStrengthSelected || cannotPredict))) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setIsPreviewing(true)
      try {
        const preview = await previewRuntimeImage(selectedCase.stageRun.id, {
          tool_type: selectedMethod === 'Patch' ? 'adjust_patch' : 'change_epsilon',
          parameters: currentParameters,
        })
        if (!cancelled) setPreviewUrl(`${resolveApiUrl(preview.image_url)}?v=${Date.now()}`)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'The preview could not be generated.')
      } finally {
        if (!cancelled) setIsPreviewing(false)
      }
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [cannotPredict, currentParameters, methodChosen, phase, pixelStrengthSelected, selectedCase.stageRun.id, selectedMethod])

  function updateParameter(method: Method, name: string, value: number) {
    setParametersByMethod((current) => ({ ...current, [method]: { ...current[method], [name]: value } }))
  }

  function updatePatchPosition(positionX: number, positionY: number) {
    setParametersByMethod((current) => ({
      ...current,
      Patch: { ...current.Patch, position_x: positionX, position_y: positionY },
    }))
  }

  function beginPrediction(method: Method) {
    setSelectedMethod(method); setPrediction(''); setCurrentAttempt(null); setPhase('predict')
  }

  function selectPixelStrength(value: number) {
    setPixelStrengthSelected(true)
    setPixelSelectionError(null)
    setPreviewUrl(null)
    updateParameter('Pixel', 'epsilon_pixels', value)
  }

  function beginPixelPrediction() {
    if (!pixelStrengthSelected || startingParametersSelected) {
      setPixelSelectionError('Choose a new Pixel Strength before continuing.')
      return
    }
    if (duplicateParameters) {
      setPixelSelectionError('Choose an untested Pixel Strength before continuing.')
      return
    }
    if (!pixelPreviewReady) return
    beginPrediction('Pixel')
  }

  function resetMethodManipulation(method: Method) {
    const activeCase = cases.find((item) => methodFor(item) === method)
    if (activeCase) {
      setParametersByMethod((current) => ({
        ...current,
        [method]: initialParameters(activeCase.playerCase.parameter_rules),
      }))
    }
    setPreviewUrl(null)
    setPixelStrengthSelected(false)
    setPixelSelectionError(null)
  }

  function chooseMethod(method: Method) {
    setSelectedMethod(method)
    setMethodChosen(false)
    resetMethodManipulation(method)
  }

  function beginMethodInvestigation() {
    resetMethodManipulation(selectedMethod)
    setMethodChosen(true)
    setPhase('manipulate')
  }

  async function reclassify() {
    if (!prediction || cannotPredict || submissionLock.current || isSubmitting) return
    submissionLock.current = true
    setIsSubmitting(true); setError(null); setReclassifyPrompt(null)
    try {
      const action = await reclassifyRuntimeImage(selectedCase.stageRun.id, {
        tool_type: selectedMethod === 'Patch' ? 'adjust_patch' : 'change_epsilon',
        parameters: currentParameters,
        predicted_outcome: prediction,
      })
      const attempt: StageTwoAttempt = { method: selectedMethod, parameters: { ...currentParameters }, prediction, action }
      setAttempts((current) => [...current, attempt]); setCurrentAttempt(attempt)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The image could not be reclassified.')
    } finally { submissionLock.current = false; setIsSubmitting(false) }
  }

  function continueAfterResult() {
    if (selectedMethod === 'Pixel') {
      setPhase('compare')
      return
    }
    setPrediction(''); setCurrentAttempt(null)
    setPhase(methodReady(selectedMethod) ? 'compare' : 'manipulate')
  }

  function continueAfterComparison() {
    if (selectedMethod === 'Pixel' && !methodReady('Pixel')) {
      setPrediction(''); setCurrentAttempt(null); setPreviewUrl(null); setPixelStrengthSelected(false); setPixelSelectionError(null); setPhase('manipulate')
      return
    }
    setPrediction(''); setCurrentAttempt(null); setMethodChosen(false)
    setPhase(allReady ? 'reflection' : 'observe')
  }

  async function finishStage() {
    if (!reflectionChoice || isSubmitting) return
    setIsSubmitting(true); setError(null)
    try {
      await saveStageResponse(cases[0].stageRun.id, { question_key: 'stage2_parameter_conditions', question_version: 1, answer_type: 'choice', answer_value: reflectionChoice })
      const completedCases: ActiveStage[] = []
      for (const item of cases) completedCases.push({ ...item, stageRun: await completeStageRun(item.stageRun.id) })
      setCompletedCases(completedCases)
      setPhase('summary')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Stage 2 could not be completed.')
    } finally { setIsSubmitting(false) }
  }

  function renderPixelManipulate() {
    const selectedStrength = currentParameters.epsilon_pixels ?? pixelStartingStrength
    return <PixelManipulateLayout>
      <PixelConceptNote />

      <section className="stage-two-pixel-module" aria-labelledby="stage-two-pixel-whole-images-title">
        <div className="stage-two-pixel-module__heading"><span>1</span><div><h3 id="stage-two-pixel-whole-images-title">Before · Observe Image | Preview · Selected Strength</h3><p>Choose a new Strength to generate a modified preview. The Observe image remains fixed.</p></div></div>
        <div className="stage-two-pixel-whole-images">
          <FixedPixelRegionImage title="Before · Observe image" imageUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} alt="Fixed Pixel Observe image with selected 32 by 32 region" details={`Current / starting Strength: ${pixelStartingStrength}/255`} />
          {pixelPreviewReady ? <FixedPixelRegionImage title="Preview · Selected Strength" imageUrl={previewUrl!} alt="Current Pixel Strength preview with selected 32 by 32 region" details={`Selected Strength: ${selectedStrength}/255 · preview only`} /> : <figure className="image-preview-card stage-two-pixel-preview-placeholder"><div className="card-heading"><strong>Preview · Selected Strength</strong></div><div role="status"><strong>{isPreviewing ? 'Generating the modified preview…' : 'Choose a Pixel Strength to preview the modified image.'}</strong></div></figure>}
        </div>
      </section>

      <section className="stage-two-pixel-module" aria-labelledby="stage-two-pixel-strength-title">
        <div className="stage-two-pixel-module__heading"><span>2</span><div><h3 id="stage-two-pixel-strength-title">Select a Pixel Strength</h3><p>Current / starting Strength: <strong>{pixelStartingStrength}/255</strong>. Select a new value for this attempt.</p></div></div>
        <div className="pixel-strength-control stage-two-pixel-strength-selector">
          <input aria-label="Pixel strength" id="pixel-strength" type="range" min="0" max={Math.max(0, pixelStrengthValues.length - 1)} step="1" value={Math.max(0, pixelStrengthValues.indexOf(selectedStrength))} onChange={(event) => selectPixelStrength(pixelStrengthValues[Number(event.target.value)])} />
          <div className="pixel-strength-ticks" aria-label="Available Pixel strengths" style={{ gridTemplateColumns: `repeat(${pixelStrengthValues.length}, minmax(48px, 1fr))` }}>{pixelStrengthValues.map((value) => { const starting = value === pixelStartingStrength; const tested = attemptedPixelStrengths.has(value); return <span key={value} className={pixelStrengthSelected && selectedStrength === value ? 'is-selected' : ''}><strong>{value}/255</strong>{starting ? <small>Initial value</small> : tested ? <small>Previously selected</small> : null}</span> })}</div>
          {pixelStrengthSelected ? <p className="selected-strength-status" role="status">Selected for preview: <strong>{selectedStrength}/255</strong></p> : <p className="selected-strength-status" role="status">No new Strength selected yet.</p>}
        </div>
      </section>

      <section className="stage-two-pixel-module" aria-labelledby="stage-two-pixel-strength-help-title">
        <div className="stage-two-pixel-module__heading"><span>3</span><div><h3 id="stage-two-pixel-strength-help-title">Understand the setting</h3></div></div>
        <PixelStrengthHelp />
        <p className="stage-two-tutorial-goal"><strong>Tutorial goal</strong><span>Try different settings until you observe one correct and one incorrect classification.</span></p>
      </section>

      <section className="stage-two-pixel-module" aria-labelledby="stage-two-pixel-region-title">
        <div className="stage-two-pixel-module__heading"><span>4</span><div><h3 id="stage-two-pixel-region-title">32×32 Selected Region</h3></div></div>
        <PixelInspector mode="preview" originalUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} modifiedUrl={previewUrl ?? resolveApiUrl(selectedCase.playerCase.initial_image_url)} subject={selectedCase.playerCase.subject} observedStrength={pixelStartingStrength} strength={selectedStrength} previewReady={pixelPreviewReady} beforeLabelOverride="Observe" afterLabelOverride="Preview" />
      </section>

      {pixelPreviewReady ? <section className="stage-two-pixel-action-prompt" aria-label="Next Pixel investigation action"><strong>The changes may still be difficult to see.</strong><p>You have chosen a Pixel Strength and previewed the modified image. <strong>Next, predict whether the change will affect the AI’s prediction, then reclassify the image to test your prediction.</strong></p></section> : null}
      {pixelSelectionError ? <p className="parameter-warning" role="alert">{pixelSelectionError}</p> : null}
    </PixelManipulateLayout>
  }

  function renderPixelComparison(activeCase: ActiveStage) {
    if (!currentAttempt || currentAttempt.method !== 'Pixel') return null
    const attempt = currentAttempt
    const matched = predictionResult(attempt)
    const firstPixelComparison = caseAttempts('Pixel').length === 1
    return <section className="method-comparison stage-two-pixel-lesson">
      <h3>Pixel evidence</h3>
      {firstPixelComparison ? <section className="pixel-teaching-sequence" aria-label="Pixel inspection sequence">
        <strong>Follow the evidence from the whole image to its RGB values</strong>
        <p>Start with the whole images. If the change is difficult to notice, inspect the same 32×32 region, then the same 8×8 pixels and their real RGB values. Enhanced Difference magnifies the small RGB differences at the end.</p>
        <p><strong>Whole image → 32×32 region → 8×8 region → RGB values / chart → Enhanced Difference</strong></p>
      </section> : <p className="pixel-repeat-comparison-note">Use the same Pixel Inspector to examine this new Strength result. The fixed Observe image remains the Before state.</p>}
      <article className="stage-two-pixel-attempt">
          <h4>Attempt {attempt.action.attempt_number} · Strength {attempt.parameters.epsilon_pixels}/255</h4>
          <div className="comparison-evidence">
            <div><ImagePreviewCard title="Before · fixed Observe image" imageUrl={resolveApiUrl(activeCase.playerCase.initial_image_url)} alt="Fixed Pixel Observe image" /><ClassificationResultCard title="Before classification" prediction={activeCase.playerCase.initial_top1} correctLabel={activeCase.playerCase.correct_label} /></div>
            <div><ImagePreviewCard title="After · tested Strength" imageUrl={resolveApiUrl(attempt.action.image_url)} alt={`Pixel attempt ${attempt.action.attempt_number} result`} /><ClassificationResultCard title="After classification" prediction={attempt.action.top1} correctLabel={activeCase.playerCase.correct_label} /></div>
          </div>
          <PixelCompareLayout mode="two-state" teaching beforeImageUrl={resolveApiUrl(activeCase.playerCase.initial_image_url)} afterImageUrl={resolveApiUrl(attempt.action.image_url)} subject={activeCase.playerCase.subject} beforeStrength={pixelStartingStrength} afterStrength={attempt.parameters.epsilon_pixels ?? 0} beforeLabel="Observe" afterLabel="Tested Strength" allowRegionSelection={false} showEnhancedDifference />
          <PixelReclassifyConnection context="after" />
          <p className="attempt-prediction">Prediction: {attempt.prediction.replaceAll('_', ' ')}</p>
          <div className="attempt-result-badges"><StatusBadge tone={matched === 'Matched' ? 'success' : matched === 'Not scored' ? 'neutral' : 'warning'}>Prediction · {matched}</StatusBadge></div>
      </article>
    </section>
  }

  return <div className="stage-two-flow">
    <StepProgress steps={STEPS} currentIndex={PHASE_INDEX[phase]} />
    <SimulationNotice>Stage 2 lets you select parameters and reclassify the modified image.</SimulationNotice>
    {phase === 'observe' ? <>
      <PanelTitle label="Observe" title="Choose one variable to investigate" description="Patch and Pixel both begin with an attacked image that is still classified correctly. Complete one, then choose the other." />
      <div className="variable-tabs" role="tablist" aria-label="Stage 2 variables">{cases.map((activeCase) => { const method = methodFor(activeCase); return <button type="button" role="tab" aria-selected={selectedMethod === method} className={selectedMethod === method ? 'is-selected' : ''} key={activeCase.playerCase.case_id} onClick={() => chooseMethod(method)}><strong>{method}</strong><small>{method === 'Patch' ? 'Size and position' : 'Attack strength'}</small>{methodReady(method) ? <StatusBadge tone="success">Complete</StatusBadge> : null}</button> })}</div>
      <div className="evidence-grid"><ImagePreviewCard title={`${selectedMethod} starting image`} imageUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} alt={`${selectedMethod}-attacked ${selectedCase.playerCase.subject}`} details={<><span>True class: <strong>{selectedCase.playerCase.correct_label}</strong></span><StatusBadge tone="success">Attacked · still correct</StatusBadge></>} /><div className="starting-evidence-column"><ClassificationResultCard title="Starting classification" prediction={selectedCase.playerCase.initial_top1} correctLabel={selectedCase.playerCase.correct_label} /><section className="starting-parameters"><strong>Current attack parameters</strong><span>{parameterSummary(initialParameters(selectedCase.playerCase.parameter_rules))}</span></section></div></div>
      <div className="stage-navigation stage-navigation--end">{methodReady(selectedMethod) ? <p className="completed-variable-notice"><strong>{selectedMethod} investigation complete.</strong> You have observed one correct and one incorrect classification. Choose the other attack above.</p> : <button className="primary-button" type="button" onClick={beginMethodInvestigation}>{`Continue with ${selectedMethod}`}</button>}</div>
    </> : null}

    {phase === 'manipulate' ? <>
      <PanelTitle label="Manipulate" title={`Adjust the ${selectedMethod} variable`} description={selectedMethod === 'Pixel' ? 'Understand the Pixel modification, actively select a new Strength, inspect its preview, then predict before testing it.' : 'Choose a setting, then predict before asking the classifier for the result.'} />
      {methodChosen ? selectedMethod === 'Pixel' ? renderPixelManipulate() : <section className="single-parameter-experiment"><div className={`experiment-preview ${isPreviewing ? 'is-loading' : ''}`}><ImagePreviewCard title={isPreviewing ? 'Updating Patch preview…' : 'Live Patch preview'} imageUrl={previewUrl ?? resolveApiUrl(selectedCase.playerCase.initial_image_url)} alt={`Patch-attacked ${selectedCase.playerCase.subject} preview`} /></div><div className="experiment-controls"><div className="card-heading"><strong>{selectedMethod} settings</strong><StatusBadge tone={methodReady(selectedMethod) ? 'success' : 'neutral'}>{methodReady(selectedMethod) ? 'Contrast complete' : `${caseAttempts(selectedMethod).length} tested`}</StatusBadge></div>
        {selectedMethod === 'Patch' ? <div className="patch-choice-controls"><fieldset><legend>Patch position</legend><p className="control-description">Choose any position and combine it with any available size.</p><div className="patch-position-grid">{PATCH_POSITIONS.map((position) => { const selected = currentParameters.position_x === position.x && currentParameters.position_y === position.y; const starting = position.x === startingParameters.position_x && position.y === startingParameters.position_y; return <button key={position.label} type="button" aria-label={`${position.label} position: position_x=${position.x.toFixed(1)}, position_y=${position.y.toFixed(1)}${starting ? ', starting position' : ''}`} aria-pressed={selected} className={selected ? 'is-selected' : ''} onClick={() => updatePatchPosition(position.x, position.y)}><span className="patch-position-icon" style={{ '--patch-left': position.left, '--patch-top': position.top } as CSSProperties}><i /></span><span className="patch-position-label"><strong>{position.label}</strong><small>position_x={position.x.toFixed(1)}</small><small>position_y={position.y.toFixed(1)}</small>{starting ? <em>Starting position</em> : null}</span></button> })}</div></fieldset><fieldset><legend>Patch size</legend><p className="control-description">The starting size remains visible so you can combine it with another position.</p><div className="patch-option-row">{nonZeroValues(selectedCase.playerCase.parameter_rules.find((rule) => rule.parameter === 'size_fraction')?.allowed_values).map((value) => { const starting = value === startingParameters.size_fraction; return <button key={value} type="button" aria-label={`${parameterLabel('size_fraction', value)}${starting ? ', starting size' : ''}`} aria-pressed={currentParameters.size_fraction === value} className={currentParameters.size_fraction === value ? 'is-selected' : ''} onClick={() => updateParameter('Patch', 'size_fraction', value)}><span className="patch-option-icon" style={{ '--patch-size': `${9 + value * 55}px` } as CSSProperties}><i /></span><small>{parameterLabel('size_fraction', value)}</small>{starting ? <em>Starting size</em> : null}</button> })}</div></fieldset></div> : <div className="pixel-strength-control"><PixelConceptNote /><PixelStrengthHelp /><input aria-label="Pixel strength" id="pixel-strength" type="range" min="0" max={Math.max(0, pixelStrengthValues.length - 1)} step="1" value={Math.max(0, pixelStrengthValues.indexOf(currentParameters.epsilon_pixels))} onChange={(event) => { const requested = pixelStrengthValues[Number(event.target.value)]; if (requested !== pixelStartingStrength && !attemptedPixelStrengths.has(requested)) updateParameter('Pixel', 'epsilon_pixels', requested) }} /><div className="pixel-strength-ticks" aria-label="Available Pixel strengths" style={{ gridTemplateColumns: `repeat(${pixelStrengthValues.length}, minmax(48px, 1fr))` }}>{pixelStrengthValues.map((value) => { const locked = value === pixelStartingStrength || attemptedPixelStrengths.has(value); return <span key={value} className={`${currentParameters.epsilon_pixels === value ? 'is-selected' : ''} ${locked ? 'is-locked' : ''}`.trim()}><strong>{value}/255</strong>{locked ? <small>{value === pixelStartingStrength ? 'Starting value' : 'Tested · locked'}</small> : null}</span> })}</div><p className="control-description">Choose an untested Strength. Pixel-level changes may be difficult to notice at normal image size, so compare the selected 32×32 regions on the left. The preview does not reveal the classifier result.</p></div>}
        <p className="tool-hint"><Move size={15} /> Try different settings until you observe one correct and one incorrect classification.</p>{startingParametersSelected ? <p className="parameter-warning">This is the starting image parameter combination. Change the position, size, or strength before testing.</p> : null}{selectedMethod === 'Patch' ? <button className="primary-button tool-action" type="button" disabled={cannotPredict} onClick={() => beginPrediction(selectedMethod)}>{duplicateParameters ? 'Already tested' : startingParametersSelected ? 'Choose a different setting' : `Predict ${selectedMethod} result`}</button> : null}</div></section> : null}
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => { setMethodChosen(false); setPhase('observe') }}>Back to variable choice</button>{selectedMethod === 'Pixel' ? <button className="primary-button" type="button" disabled={!pixelStrengthSelected || (pixelStrengthSelected && !cannotPredict && !pixelPreviewReady)} onClick={beginPixelPrediction}>{!pixelStrengthSelected ? 'Select a Strength first' : isPreviewing ? 'Generating Preview…' : 'Continue to Predict'}</button> : null}</div>
    </> : null}

    {phase === 'predict' ? <>
      <PanelTitle label="Predict" title={`Predict the ${selectedMethod} result`} description={`Selected parameters: ${parameterSummary(currentParameters)}`} />
      <fieldset className="choice-group"><legend>What will happen to the AI's current main classification judgement?</legend>{[['classification_changes', "The AI's main judgement will change"], ['classification_stays_same', "The AI's main judgement will not change"], ['uncertain', 'Not sure']].map(([value, label]) => <label key={value}><input type="radio" name="stage2-prediction" checked={prediction === value} onChange={() => setPrediction(value as PredictionChoice)} />{label}</label>)}</fieldset>
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('manipulate')}>Back to Manipulate</button><button className="primary-button" type="button" disabled={!prediction} onClick={() => setPhase('reclassify')}>Lock prediction and continue</button></div>
    </> : null}

    {phase === 'reclassify' ? <>
      <PanelTitle label="Reclassify" title={currentAttempt ? 'New classification result' : 'Run the selected parameter experiment'} description={currentAttempt ? 'Review this result before returning to the tools or continuing to Compare.' : 'Reclassify the selected parameter state to reveal the result.'} />
      {selectedMethod === 'Pixel' ? <PixelReclassifyConnection /> : null}
      <div className="reclassify-action-layout"><div><ImagePreviewCard title="Before reclassification" imageUrl={resolveApiUrl(currentAttempt?.action.image_url ?? previewUrl ?? selectedCase.playerCase.initial_image_url)} alt={`${selectedMethod} modified ${selectedCase.playerCase.subject} ready for reclassification`} details={<span>{parameterSummary(currentParameters)}</span>} /></div><div className="reclassify-center-action"><span>Send modified image to classifier</span><button className="primary-button" type="button" disabled={isSubmitting || currentAttempt !== null} onClick={() => void reclassify()}>{isSubmitting ? 'Reclassifying…' : currentAttempt ? 'Reclassified' : 'Reclassify image'}</button></div><ClassificationResultCard title="After reclassification" prediction={currentAttempt?.action.top1} correctLabel={selectedCase.playerCase.correct_label} reveal={currentAttempt !== null} /></div>
      {currentAttempt && !methodReady(selectedMethod) ? <p className="exploration-hint">{currentAttempt.action.correct_label_is_top1 ? 'This setting still produced the correct classification. Try another parameter combination—another result may be possible.' : 'This setting produced an incorrect classification. Try another parameter combination to see whether the correct result can be preserved.'}</p> : null}
      {reclassifyPrompt ? <p className="reclassify-required-notice" role="status">{reclassifyPrompt}</p> : null}
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => currentAttempt ? setReclassifyPrompt('This result has already been recorded. Continue with the result before changing your prediction.') : setPhase('predict')}>Back to Predict</button><button className="primary-button" type="button" onClick={() => currentAttempt ? continueAfterResult() : setReclassifyPrompt('Reclassify the image first before continuing to another parameter or Compare.')}>{currentAttempt && selectedMethod === 'Pixel' ? 'Continue to Compare' : currentAttempt && methodReady(selectedMethod) ? `Compare ${selectedMethod} results` : 'Continue exploring parameters'}</button></div>
    </> : null}

    {phase === 'compare' ? <>
      <PanelTitle label="Compare" title={`Compare the ${selectedMethod} parameter results`} description={selectedMethod === 'Pixel' ? 'Compare the fixed Observe image with this attempt’s image, RGB evidence and classification result.' : 'Compare the starting attacked image with the correct and incorrect results you produced.'} />
      {selectedMethod === 'Pixel' ? renderPixelComparison(selectedCase) : <section className="method-comparison"><h3>Patch evidence</h3><div className="comparison-card-grid"><div><ImagePreviewCard title="Starting attacked image" imageUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} alt="Patch starting condition" details={<span>{parameterSummary(initialParameters(selectedCase.playerCase.parameter_rules))}</span>} /><ClassificationResultCard title="Starting result" prediction={selectedCase.playerCase.initial_top1} correctLabel={selectedCase.playerCase.correct_label} /></div>{caseAttempts('Patch').map((attempt) => { const matched = predictionResult(attempt); return <div key={`Patch-${attempt.action.attempt_number}`}><ImagePreviewCard title={`Attempt ${attempt.action.attempt_number} modified image`} imageUrl={resolveApiUrl(attempt.action.image_url)} alt={`Patch modified attempt ${attempt.action.attempt_number}`} details={<span>Attempt {attempt.action.attempt_number} · {parameterSummary(attempt.parameters)}</span>} /><ClassificationResultCard title={`Attempt ${attempt.action.attempt_number} result`} prediction={attempt.action.top1} correctLabel={selectedCase.playerCase.correct_label} /><p className="attempt-prediction">Prediction: {attempt.prediction.replaceAll('_', ' ')}</p><div className="attempt-result-badges"><StatusBadge tone={matched === 'Matched' ? 'success' : matched === 'Not scored' ? 'neutral' : 'warning'}>Prediction · {matched}</StatusBadge></div></div> })}</div></section>}
      <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={continueAfterComparison}>{selectedMethod === 'Pixel' && !methodReady('Pixel') ? 'Test another Pixel Strength' : allReady ? 'Continue to Reflection' : 'Choose another attack'}</button></div>
    </> : null}

    {phase === 'reflection' ? <>
      <PanelTitle label="Reflection" title="What explains the different results?" description="Use evidence from both Patch and Pixel parameter experiments." />
      <div className="stage-summary"><h3>Stage 2 evidence table</h3><div className="stage-two-summary" role="table" aria-label="Stage 2 comparison results"><div className="stage-two-summary-row stage-two-summary-head" role="row"><span>Method</span><span>Parameters</span><span>Your prediction</span><span>AI's main judgement</span><span>Changed from start?</span></div>{attempts.map((attempt) => <div className="stage-two-summary-row" role="row" key={`reflection-${attempt.method}-${attempt.action.attempt_number}`}><span>{attempt.method}</span><span>{parameterSummary(attempt.parameters)}</span><span>{attempt.prediction.replaceAll('_', ' ')}</span><span>{attempt.action.top1.label}</span><span>{changedFromStartingResult(attempt) ? 'Changed' : 'Unchanged'}</span></div>)}</div></div>
      <fieldset className="choice-group"><legend>Which statement best matches the evidence?</legend>{[['method_only', 'The attack method alone determines the result.'], ['parameters_matter', 'Parameter conditions can affect whether the classification changes.'], ['always_larger', 'A larger parameter always produces the same result.'], ['random', 'The classifier result is random.']].map(([value, label]) => <label key={value}><input type="radio" name="stage2-reflection" checked={reflectionChoice === value} onChange={() => setReflectionChoice(value)} />{label}</label>)}</fieldset>
      {reflectionChoice ? <p className={`prediction-feedback ${reflectionChoice === 'parameters_matter' ? 'prediction-feedback--match' : ''}`}>{reflectionChoice === 'parameters_matter' ? 'Correct. The comparison shows that parameter conditions matter.' : 'Review the comparison: different settings within each method produced different outcomes.'}</p> : null}
      <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" disabled={!reflectionChoice || isSubmitting} onClick={() => void finishStage()}>{isSubmitting ? 'Saving…' : 'Complete the Condition Training Stage'}</button></div>
    </> : null}

    {phase === 'summary' ? <div className="standalone-summary"><Sparkles size={30} /><p className="step-label">Condition Training summary</p><h2>Evidence from your tested variables</h2><p>Across your attempts, different settings for Patch size and Pixel intensity were associated with different classification outcomes. This suggests that a modification does not have one fixed effect: whether it changes the classification may depend on the specific parameters used. You can apply this way of thinking to other images, but the exact outcome should still be checked in each case.</p><button className="primary-button" type="button" disabled={!completedCases} onClick={() => { if (completedCases) { onStageComplete(completedCases); setPhase('complete') } }}>Continue</button></div> : null}

    {phase === 'complete' ? <div className="stage-complete stage-ready" role="status"><Sparkles size={32} /><p className="step-label">Condition Training complete</p><h2>You are ready for Repair Investigation</h2><p>Next, form repair hypotheses and test them against classifier evidence.</p><div className="ready-actions"><button className="primary-button" type="button" disabled={isMovingNext} onClick={onContinue}>{isMovingNext ? 'Loading Repair Investigation…' : 'Continue to Repair Investigation'}</button></div></div> : null}
    {error || nextError ? <div className="error-message" role="alert"><p>{error ?? nextError}</p><button className="secondary-button inline-button" type="button" onClick={() => setError(null)}>Retry</button></div> : null}
  </div>
}
