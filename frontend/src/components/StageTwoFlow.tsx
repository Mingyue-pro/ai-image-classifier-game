import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Move, Sparkles } from 'lucide-react'

import { completeStageRun, previewRuntimeImage, reclassifyRuntimeImage, resolveApiUrl, saveStageResponse } from '../api'
import type { ActiveStage, ParameterRule, StageTwoAttempt } from '../types'
import { ClassificationResultCard, ImagePreviewCard, PanelTitle, SimulationNotice, StatusBadge, StepProgress } from './GameUi'
import { PixelInspector } from './PixelInspector'

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
  { label: 'Bottom left', x: 0.4, y: 0.6, left: '18%', top: '80%' },
  { label: 'Bottom right', x: 0.6, y: 0.6, left: '82%', top: '80%' },
] as const

function methodFor(activeCase: ActiveStage): Method {
  return activeCase.playerCase.attack_type === 'fgsm' ? 'Pixel' : 'Patch'
}

function initialParameters(rules: ParameterRule[]): Record<string, number> {
  return Object.fromEntries(rules.flatMap((rule) => typeof rule.initial_value === 'number' ? [[rule.parameter, rule.initial_value]] : []))
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
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [reclassifyPrompt, setReclassifyPrompt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedCase = cases.find((item) => methodFor(item) === selectedMethod) ?? cases[0]
  const caseAttempts = (method: Method) => attempts.filter((attempt) => attempt.method === method)
  const latestAttempt = (method: Method) => caseAttempts(method).at(-1)
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
  const duplicateParameters = attemptedKeys.has(attemptKey(currentParameters))
  const startingParameters = initialParameters(selectedCase.playerCase.parameter_rules)
  const startingParametersSelected = attemptKey(currentParameters) === attemptKey(startingParameters)
  const cannotPredict = duplicateParameters || startingParametersSelected

  useEffect(() => {
    if (phase !== 'manipulate' || !methodChosen) return
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
  }, [currentParameters, methodChosen, phase, selectedCase.stageRun.id, selectedMethod])

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

  function chooseMethod(method: Method) {
    setSelectedMethod(method)
    setMethodChosen(false)
    setPreviewUrl(null)
  }

  async function reclassify() {
    if (!prediction || cannotPredict || isSubmitting) return
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
    } finally { setIsSubmitting(false) }
  }

  function continueAfterResult() {
    setPrediction(''); setCurrentAttempt(null)
    setPhase(methodReady(selectedMethod) ? 'compare' : 'manipulate')
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

  return <div className="stage-two-flow">
    <StepProgress steps={STEPS} currentIndex={PHASE_INDEX[phase]} />
    <SimulationNotice>Stage 2 generates the selected parameters and reclassifies the resulting image with ResNet-34.</SimulationNotice>
    {phase === 'observe' ? <>
      <PanelTitle label="Observe" title="Choose one variable to investigate" description="Patch and Pixel both begin with an attacked image that is still classified correctly. Complete one, then choose the other." />
      <div className="variable-tabs" role="tablist" aria-label="Stage 2 variables">{cases.map((activeCase) => { const method = methodFor(activeCase); return <button type="button" role="tab" aria-selected={selectedMethod === method} className={selectedMethod === method ? 'is-selected' : ''} key={activeCase.playerCase.case_id} onClick={() => chooseMethod(method)}><strong>{method}</strong><small>{method === 'Patch' ? 'Size and position' : 'Attack strength'}</small>{methodReady(method) ? <StatusBadge tone="success">Complete</StatusBadge> : null}</button> })}</div>
      <div className="evidence-grid"><ImagePreviewCard title={`${selectedMethod} starting image`} imageUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} alt={`${selectedMethod}-attacked ${selectedCase.playerCase.subject}`} details={<><span>True class: <strong>{selectedCase.playerCase.correct_label}</strong></span><StatusBadge tone="success">Attacked · still correct</StatusBadge></>} /><div className="starting-evidence-column"><ClassificationResultCard title="Starting classification" prediction={selectedCase.playerCase.initial_top1} correctLabel={selectedCase.playerCase.correct_label} /><section className="starting-parameters"><strong>Current attack parameters</strong><span>{parameterSummary(initialParameters(selectedCase.playerCase.parameter_rules))}</span></section></div></div>
      <div className="stage-navigation stage-navigation--end">{methodReady(selectedMethod) ? <p className="completed-variable-notice"><strong>{selectedMethod} investigation complete.</strong> You have observed one correct and one incorrect classification. Choose the other attack above.</p> : <button className="primary-button" type="button" onClick={() => { setMethodChosen(true); setPhase('manipulate') }}>{`Continue with ${selectedMethod}`}</button>}</div>
    </> : null}

    {phase === 'manipulate' ? <>
      <PanelTitle label="Manipulate" title={`Adjust the ${selectedMethod} variable`} description="Choose a setting, then predict before asking the classifier for the result." />
      {methodChosen ? <section className="single-parameter-experiment"><div className={`experiment-preview ${isPreviewing ? 'is-loading' : ''}`}>{selectedMethod === 'Pixel' ? <PixelInspector originalUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} modifiedUrl={previewUrl ?? resolveApiUrl(latestAttempt('Pixel')?.action.image_url ?? selectedCase.playerCase.initial_image_url)} subject="strawberry" strength={currentParameters.epsilon_pixels ?? 0} /> : <ImagePreviewCard title={isPreviewing ? 'Updating Patch preview…' : 'Live Patch preview'} imageUrl={previewUrl ?? resolveApiUrl(latestAttempt('Patch')?.action.image_url ?? selectedCase.playerCase.initial_image_url)} alt="Patch-attacked strawberry preview" />}</div><div className="experiment-controls"><div className="card-heading"><strong>{selectedMethod} settings</strong><StatusBadge tone={methodReady(selectedMethod) ? 'success' : 'neutral'}>{methodReady(selectedMethod) ? 'Contrast complete' : `${caseAttempts(selectedMethod).length} tested`}</StatusBadge></div>
        {selectedMethod === 'Patch' ? <div className="patch-choice-controls"><fieldset><legend>Patch position</legend><p className="control-description">Choose any position and combine it with any available size.</p><div className="patch-position-grid">{PATCH_POSITIONS.map((position) => { const selected = currentParameters.position_x === position.x && currentParameters.position_y === position.y; const starting = position.x === startingParameters.position_x && position.y === startingParameters.position_y; return <button key={position.label} type="button" aria-label={`${position.label} position: position_x=${position.x.toFixed(1)}, position_y=${position.y.toFixed(1)}${starting ? ', starting position' : ''}`} aria-pressed={selected} className={selected ? 'is-selected' : ''} onClick={() => updatePatchPosition(position.x, position.y)}><span className="patch-position-icon" style={{ '--patch-left': position.left, '--patch-top': position.top } as CSSProperties}><i /></span><span className="patch-position-label"><strong>{position.label}</strong><small>position_x={position.x.toFixed(1)}</small><small>position_y={position.y.toFixed(1)}</small>{starting ? <em>Starting position</em> : null}</span></button> })}</div></fieldset><fieldset><legend>Patch size</legend><p className="control-description">The starting size remains visible so you can combine it with another position.</p><div className="patch-option-row">{selectedCase.playerCase.parameter_rules.find((rule) => rule.parameter === 'size_fraction')?.allowed_values?.map((value) => { const starting = value === startingParameters.size_fraction; return <button key={value} type="button" aria-label={`${parameterLabel('size_fraction', value)}${starting ? ', starting size' : ''}`} aria-pressed={currentParameters.size_fraction === value} className={currentParameters.size_fraction === value ? 'is-selected' : ''} onClick={() => updateParameter('Patch', 'size_fraction', value)}><span className="patch-option-icon" style={{ '--patch-size': `${9 + value * 55}px` } as CSSProperties}><i /></span><small>{parameterLabel('size_fraction', value)}</small>{starting ? <em>Starting size</em> : null}</button> })}</div></fieldset></div> : <div className="pixel-strength-control"><label htmlFor="pixel-strength">Pixel strength <strong>{parameterLabel('epsilon_pixels', currentParameters.epsilon_pixels)}</strong></label><p className="control-description">Starting strength: {parameterLabel('epsilon_pixels', startingParameters.epsilon_pixels)}. Choose and test two other strengths. Use Pixel Inspector on the left to choose and compare a 32×32 region.</p><input id="pixel-strength" type="range" min="0" max={(selectedCase.playerCase.parameter_rules[0].allowed_values?.length ?? 1) - 1} step="1" value={selectedCase.playerCase.parameter_rules[0].allowed_values?.indexOf(currentParameters.epsilon_pixels) ?? 0} onChange={(event) => { const values = selectedCase.playerCase.parameter_rules[0].allowed_values ?? []; updateParameter('Pixel', 'epsilon_pixels', values[Number(event.target.value)]) }} /><div className="range-labels"><span>Weak</span><span>Strong</span></div></div>}
        <p className="tool-hint"><Move size={15} /> Try different settings until you observe one correct and one incorrect classification.</p>{startingParametersSelected ? <p className="parameter-warning">This is the starting image parameter combination. Change the position, size, or strength before testing.</p> : null}<button className="primary-button tool-action" type="button" disabled={cannotPredict} onClick={() => beginPrediction(selectedMethod)}>{duplicateParameters ? 'Already tested' : startingParametersSelected ? 'Choose a different setting' : `Predict ${selectedMethod} result`}</button></div></section> : null}
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => { setMethodChosen(false); setPhase('observe') }}>Back to variable choice</button></div>
    </> : null}

    {phase === 'predict' ? <>
      <PanelTitle label="Predict" title={`Predict the ${selectedMethod} result`} description={`Selected parameters: ${parameterSummary(currentParameters)}`} />
      <fieldset className="choice-group"><legend>What will happen to Top-1?</legend>{[['classification_changes', 'Top-1 will change'], ['classification_stays_same', 'Top-1 will not change'], ['uncertain', 'Not sure']].map(([value, label]) => <label key={value}><input type="radio" name="stage2-prediction" checked={prediction === value} onChange={() => setPrediction(value as PredictionChoice)} />{label}</label>)}</fieldset>
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('manipulate')}>Back to Manipulate</button><button className="primary-button" type="button" disabled={!prediction} onClick={() => setPhase('reclassify')}>Lock prediction and continue</button></div>
    </> : null}

    {phase === 'reclassify' ? <>
      <PanelTitle label="Reclassify" title={currentAttempt ? 'New classification result' : 'Run the selected parameter experiment'} description={currentAttempt ? 'Review this result before returning to the tools or continuing to Compare.' : 'The server will generate this parameter state and classify it with ResNet-34.'} />
      <div className="reclassify-action-layout"><div>{selectedMethod === 'Pixel' ? <PixelInspector originalUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} modifiedUrl={resolveApiUrl(currentAttempt?.action.image_url ?? previewUrl ?? selectedCase.playerCase.initial_image_url)} subject="strawberry" strength={currentParameters.epsilon_pixels ?? 0} /> : <ImagePreviewCard title="Before reclassification" imageUrl={resolveApiUrl(currentAttempt?.action.image_url ?? previewUrl ?? selectedCase.playerCase.initial_image_url)} alt="Strawberry with selected Patch parameters" details={<span>{parameterSummary(currentParameters)}</span>} />}</div><div className="reclassify-center-action"><span>Send modified image to classifier</span><button className="primary-button" type="button" disabled={isSubmitting || currentAttempt !== null} onClick={() => void reclassify()}>{isSubmitting ? 'Reclassifying…' : currentAttempt ? 'Reclassified' : 'Reclassify image'}</button></div><ClassificationResultCard title="After reclassification" prediction={currentAttempt?.action.top1} correctLabel={selectedCase.playerCase.correct_label} reveal={currentAttempt !== null} /></div>
      {currentAttempt && !methodReady(selectedMethod) ? <p className="exploration-hint">{currentAttempt.action.correct_label_is_top1 ? 'This setting still produced the correct classification. Try another parameter combination—another result may be possible.' : 'This setting produced an incorrect classification. Try another parameter combination to see whether the correct result can be preserved.'}</p> : null}
      {reclassifyPrompt ? <p className="reclassify-required-notice" role="status">{reclassifyPrompt}</p> : null}
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => currentAttempt ? setReclassifyPrompt('This result has already been recorded. Continue with the result before changing your prediction.') : setPhase('predict')}>Back to Predict</button><button className="primary-button" type="button" onClick={() => currentAttempt ? continueAfterResult() : setReclassifyPrompt('Reclassify the image first before continuing to another parameter or Compare.')}>{currentAttempt && methodReady(selectedMethod) ? `Compare ${selectedMethod} results` : 'Continue exploring parameters'}</button></div>
    </> : null}

    {phase === 'compare' ? <>
      <PanelTitle label="Compare" title={`Compare the ${selectedMethod} parameter results`} description="Compare the starting attacked image with the correct and incorrect results you produced." />
      {[selectedCase].map((activeCase) => { const method = methodFor(activeCase); return <section className="method-comparison" key={method}><h3>{method} evidence</h3><div className="comparison-card-grid"><div><ImagePreviewCard title="Starting attacked image" imageUrl={resolveApiUrl(activeCase.playerCase.initial_image_url)} alt={`${method} starting condition`} details={<span>{parameterSummary(initialParameters(activeCase.playerCase.parameter_rules))}</span>} /><ClassificationResultCard title="Starting result" prediction={activeCase.playerCase.initial_top1} correctLabel={activeCase.playerCase.correct_label} /></div>{caseAttempts(method).map((attempt) => { const matched = predictionResult(attempt); return <div key={`${method}-${attempt.action.attempt_number}`}>{method === 'Pixel' ? <PixelInspector originalUrl={resolveApiUrl(activeCase.playerCase.initial_image_url)} modifiedUrl={resolveApiUrl(attempt.action.image_url)} subject="strawberry" strength={attempt.parameters.epsilon_pixels ?? 0} /> : <ImagePreviewCard title="Modified image used for this classification" imageUrl={resolveApiUrl(attempt.action.image_url)} alt={`${method} modified attempt ${attempt.action.attempt_number}`} details={<span>{parameterSummary(attempt.parameters)}</span>} />}<ClassificationResultCard title={`Attempt ${attempt.action.attempt_number}`} prediction={attempt.action.top1} correctLabel={activeCase.playerCase.correct_label} /><p className="attempt-prediction">Prediction: {attempt.prediction.replaceAll('_', ' ')}</p><div className="attempt-result-badges"><StatusBadge tone={matched === 'Matched' ? 'success' : matched === 'Not scored' ? 'neutral' : 'warning'}>Prediction · {matched}</StatusBadge></div></div> })}</div></section> })}
      <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={() => { if (allReady) setPhase('reflection'); else { setMethodChosen(false); setPhase('observe') } }}>{allReady ? 'Continue to Reflection' : 'Choose another attack'}</button></div>
    </> : null}

    {phase === 'reflection' ? <>
      <PanelTitle label="Reflection" title="What explains the different results?" description="Use evidence from both Patch and Pixel parameter experiments." />
      <div className="stage-summary"><h3>Stage 2 evidence table</h3><div className="stage-two-summary" role="table" aria-label="Stage 2 comparison results"><div className="stage-two-summary-row stage-two-summary-head" role="row"><span>Method</span><span>Parameters</span><span>Your prediction</span><span>Top-1 result</span><span>Changed from start?</span></div>{attempts.map((attempt) => <div className="stage-two-summary-row" role="row" key={`reflection-${attempt.method}-${attempt.action.attempt_number}`}><span>{attempt.method}</span><span>{parameterSummary(attempt.parameters)}</span><span>{attempt.prediction.replaceAll('_', ' ')}</span><span>{attempt.action.top1.label}</span><span>{changedFromStartingResult(attempt) ? 'Changed' : 'Unchanged'}</span></div>)}</div></div>
      <fieldset className="choice-group"><legend>Which statement best matches the evidence?</legend>{[['method_only', 'The attack method alone determines the result.'], ['parameters_matter', 'Parameter conditions can affect whether the classification changes.'], ['always_larger', 'A larger parameter always produces the same result.'], ['random', 'The classifier result is random.']].map(([value, label]) => <label key={value}><input type="radio" name="stage2-reflection" checked={reflectionChoice === value} onChange={() => setReflectionChoice(value)} />{label}</label>)}</fieldset>
      {reflectionChoice ? <p className={`prediction-feedback ${reflectionChoice === 'parameters_matter' ? 'prediction-feedback--match' : ''}`}>{reflectionChoice === 'parameters_matter' ? 'Correct. The comparison shows that parameter conditions matter.' : 'Review the comparison: different settings within each method produced different outcomes.'}</p> : null}
      <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" disabled={!reflectionChoice || isSubmitting} onClick={() => void finishStage()}>{isSubmitting ? 'Saving…' : 'Complete Stage 2'}</button></div>
    </> : null}

    {phase === 'summary' ? <div className="standalone-summary"><Sparkles size={30} /><p className="step-label">Condition Training summary</p><h2>Evidence from your tested variables</h2><p>Across your attempts, different settings for Patch size and Pixel intensity were associated with different classification outcomes. This suggests that a modification does not have one fixed effect: whether it changes the classification may depend on the specific parameters used. You can apply this way of thinking to other images, but the exact outcome should still be checked in each case.</p><button className="primary-button" type="button" disabled={!completedCases} onClick={() => { if (completedCases) { onStageComplete(completedCases); setPhase('complete') } }}>Continue</button></div> : null}

    {phase === 'complete' ? <div className="stage-complete stage-ready" role="status"><Sparkles size={32} /><p className="step-label">Condition Training complete</p><h2>You are ready for Repair Investigation</h2><p>Next, form repair hypotheses and test them against classifier evidence.</p><div className="ready-actions"><button className="primary-button" type="button" disabled={isMovingNext} onClick={onContinue}>{isMovingNext ? 'Loading Repair Investigation…' : 'Continue to Repair Investigation'}</button></div></div> : null}
    {error || nextError ? <div className="error-message" role="alert"><p>{error ?? nextError}</p><button className="secondary-button inline-button" type="button" onClick={() => setError(null)}>Retry</button></div> : null}
  </div>
}
