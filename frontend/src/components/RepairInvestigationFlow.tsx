import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Wrench } from 'lucide-react'

import { applyVerifiedFallback, completeStageRun, previewRuntimeImage, reclassifyRuntimeImage, resolveApiUrl, saveStageResponse } from '../api'
import type { ActiveStage, RepairAttempt } from '../types'
import { ClassificationResultCard, ImagePreviewCard, PanelTitle, SimulationNotice, StatusBadge, StepProgress } from './GameUi'
import { PixelInspector } from './PixelInspector'
import { PredictedClassExplorer } from './PredictedClassExplorer'

type Method = 'Patch' | 'Pixel'
type Phase = 'observe' | 'plan' | 'manipulate' | 'reclassify' | 'compare' | 'reflect1' | 'reflect2' | 'summary' | 'complete'

type RepairInvestigationFlowProps = {
  cases: ActiveStage[]
  nextError: string | null
  onStageComplete: (cases: ActiveStage[]) => void
  onContinue: () => void
  isMovingNext: boolean
}

const STEPS = ['Observe', 'Plan & Predict', 'Manipulate', 'Reclassify', 'Compare', 'Reflect'] as const
const PHASE_INDEX: Record<Phase, number> = { observe: 0, plan: 1, manipulate: 2, reclassify: 3, compare: 4, reflect1: 5, reflect2: 5, summary: 5, complete: 5 }

function methodFor(activeCase: ActiveStage): Method {
  return activeCase.playerCase.attack_type === 'fgsm' ? 'Pixel' : 'Patch'
}

function initialParameters(activeCase: ActiveStage): Record<string, number> {
  return Object.fromEntries(activeCase.playerCase.parameter_rules.flatMap((rule) => typeof rule.initial_value === 'number' ? [[rule.parameter, rule.initial_value]] : []))
}

function parameterSummary(parameters: Record<string, number>): string {
  if (parameters.size_fraction === 0) return 'Patch removed'
  return Object.entries(parameters).map(([name, value]) => {
    if (name === 'epsilon_pixels') return `Strength ${value}/255`
    if (name === 'size_fraction') return `Size ${Math.round(value * 100)}%`
    if (name === 'position_x') return `X ${value.toFixed(2)}`
    if (name === 'position_y') return `Y ${value.toFixed(2)}`
    return `${name} ${value}`
  }).join(' · ')
}

function directionOptions(method: Method): Array<[string, string]> {
  return method === 'Patch' ? [
    ['move_patch', 'Move the Patch'],
    ['reduce_patch', 'Reduce the Patch size'],
    ['remove_patch', 'Remove the Patch'],
    ['move_and_reduce', 'Change both position and size'],
  ] : [
    ['reduce_strength', 'Reduce the attack strength'],
    ['remove_perturbation', 'Remove the perturbation'],
    ['keep_strength', 'Keep the current strength'],
  ]
}

export function RepairInvestigationFlow({ cases, nextError, onStageComplete, onContinue, isMovingNext }: RepairInvestigationFlowProps) {
  const [phase, setPhase] = useState<Phase>('observe')
  const [selectedMethod, setSelectedMethod] = useState<Method>('Patch')
  const [completedMethods, setCompletedMethods] = useState<Method[]>([])
  const [parametersByMethod, setParametersByMethod] = useState<Record<Method, Record<string, number>>>(() => ({
    Patch: initialParameters(cases.find((item) => methodFor(item) === 'Patch') ?? cases[0]),
    Pixel: initialParameters(cases.find((item) => methodFor(item) === 'Pixel') ?? cases[0]),
  }))
  const [direction, setDirection] = useState('')
  const [prediction, setPrediction] = useState('')
  const [reason, setReason] = useState('')
  const [attempts, setAttempts] = useState<RepairAttempt[]>([])
  const [currentAttempt, setCurrentAttempt] = useState<RepairAttempt | null>(null)
  const [initialIdeas, setInitialIdeas] = useState<Partial<Record<Method, { direction: string; reason: string }>>>({})
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [navigationPrompt, setNavigationPrompt] = useState<string | null>(null)
  const [ideaEvaluation, setIdeaEvaluation] = useState<Partial<Record<Method, string>>>({})
  const [reconsideration, setReconsideration] = useState('')
  const [uncertainties, setUncertainties] = useState<string[]>([])
  const [takeaway, setTakeaway] = useState('')

  const selectedCase = cases.find((item) => methodFor(item) === selectedMethod) ?? cases[0]
  const currentParameters = parametersByMethod[selectedMethod]
  const methodAttempts = useMemo(() => attempts.filter((attempt) => attempt.method === selectedMethod), [attempts, selectedMethod])
  const attemptsRemaining = currentAttempt?.action.attempts_remaining ?? Math.max(0, (selectedCase.playerCase.max_attempts ?? 3) - methodAttempts.filter((attempt) => !attempt.fallback).length)

  useEffect(() => {
    if (phase !== 'manipulate') return
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
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'The repair preview could not be generated.')
      } finally { if (!cancelled) setIsPreviewing(false) }
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [currentParameters, phase, selectedCase.stageRun.id, selectedMethod])

  function chooseMethod(method: Method) {
    setSelectedMethod(method); setDirection(''); setPrediction(''); setReason(''); setCurrentAttempt(null); setPreviewUrl(null); setPhase('plan')
  }

  function updateParameter(name: string, value: number) {
    setParametersByMethod((current) => ({ ...current, [selectedMethod]: { ...current[selectedMethod], [name]: value } }))
  }

  async function runReclassification() {
    if (isSubmitting || currentAttempt) return
    setIsSubmitting(true); setError(null); setNavigationPrompt(null)
    try {
      const action = await reclassifyRuntimeImage(selectedCase.stageRun.id, {
        tool_type: selectedMethod === 'Patch' ? 'adjust_patch' : 'change_epsilon',
        parameters: currentParameters,
        predicted_outcome: prediction,
        prediction_reason: reason,
      })
      const attempt: RepairAttempt = { method: selectedMethod, direction, prediction, reason, parameters: { ...currentParameters }, action, fallback: false }
      setAttempts((current) => [...current, attempt]); setCurrentAttempt(attempt)
      setInitialIdeas((current) => current[selectedMethod] ? current : { ...current, [selectedMethod]: { direction, reason } })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The repaired image could not be classified.') }
    finally { setIsSubmitting(false) }
  }

  async function runFallback() {
    if (isSubmitting) return
    setIsSubmitting(true); setError(null)
    try {
      const action = await applyVerifiedFallback(selectedCase.stageRun.id)
      const attempt: RepairAttempt = { method: selectedMethod, direction: 'verified_fallback', prediction: 'verified_fallback_will_restore', reason: 'System-provided verified repair.', parameters: action.parameters as Record<string, number>, action, fallback: true }
      setAttempts((current) => [...current, attempt]); setCurrentAttempt(attempt)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The verified fallback could not be applied.') }
    finally { setIsSubmitting(false) }
  }

  function finishMethod() {
    const nextCompleted = completedMethods.includes(selectedMethod) ? completedMethods : [...completedMethods, selectedMethod]
    setCompletedMethods(nextCompleted); setCurrentAttempt(null); setDirection(''); setPrediction(''); setReason('')
    if (nextCompleted.length === 2) setPhase('reflect1')
    else setPhase('observe')
  }

  async function finishReflection() {
    if (isSubmitting || takeaway.trim().length < 20 || reconsideration.trim().length === 0 || uncertainties.length === 0 || !ideaEvaluation.Patch || !ideaEvaluation.Pixel) return
    setIsSubmitting(true); setError(null)
    try {
      const primaryRun = cases[0].stageRun.id
      await saveStageResponse(primaryRun, { question_key: 'stage3_initial_repair_evaluation', question_version: 1, answer_type: 'multiple_choice', answer_json: ideaEvaluation })
      await saveStageResponse(primaryRun, { question_key: 'stage3_reconsideration', question_version: 1, answer_type: 'text', answer_text: reconsideration.trim() })
      await saveStageResponse(primaryRun, { question_key: 'stage3_remaining_uncertainty', question_version: 1, answer_type: 'multiple_choice', answer_json: uncertainties })
      await saveStageResponse(primaryRun, { question_key: 'stage3_case_takeaway', question_version: 1, answer_type: 'text', answer_text: takeaway.trim() })
      const completedCases: ActiveStage[] = []
      for (const item of cases) completedCases.push({ ...item, stageRun: await completeStageRun(item.stageRun.id) })
      onStageComplete(completedCases); setPhase('summary')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Repair Investigation could not be completed.') }
    finally { setIsSubmitting(false) }
  }

  return <div className="repair-flow">
    <StepProgress steps={STEPS} currentIndex={PHASE_INDEX[phase]} />
    <SimulationNotice>Repair Investigation generates each selected repair and checks it with ResNet-34. You have up to three autonomous attempts per attack.</SimulationNotice>

    {phase === 'observe' ? <>
      <PanelTitle label="Observe" title="Choose a misclassified image to repair" description="Patch and Pixel both begin with a traffic light image that the classifier currently gets wrong." />
      <div className="variable-tabs" role="tablist" aria-label="Repair methods">{cases.map((activeCase) => { const method = methodFor(activeCase); const complete = completedMethods.includes(method); return <button key={method} type="button" role="tab" aria-selected={selectedMethod === method} className={selectedMethod === method ? 'is-selected' : ''} onClick={() => setSelectedMethod(method)}><strong>{method}</strong><small>{method === 'Patch' ? 'Repair position and size' : 'Repair attack strength'}</small>{complete ? <StatusBadge tone="success">Complete</StatusBadge> : null}</button> })}</div>
      <div className="evidence-grid"><ImagePreviewCard title={`${selectedMethod} starting image`} imageUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} alt={`Misclassified traffic light with ${selectedMethod}`} details={<><span>Correct class: <strong>{selectedCase.playerCase.correct_label}</strong></span><StatusBadge tone="warning">Repair needed</StatusBadge></>} /><div className="starting-evidence-column"><ClassificationResultCard title="Current incorrect classification" prediction={selectedCase.playerCase.initial_top1} correctLabel={selectedCase.playerCase.correct_label} /><section className="starting-parameters"><strong>Current attack parameters</strong><span>{parameterSummary(initialParameters(selectedCase))}</span><span>Autonomous attempts available: {selectedCase.playerCase.max_attempts ?? 3}</span></section></div></div>
      <div className="stage-navigation stage-navigation--end">{completedMethods.includes(selectedMethod) ? <p className="completed-variable-notice">This repair method is complete. Choose the other attack.</p> : <button className="primary-button" type="button" onClick={() => chooseMethod(selectedMethod)}>Plan this repair</button>}</div>
    </> : null}

    {phase === 'plan' ? <>
      <PanelTitle label="Plan & Predict" title={`Plan your ${selectedMethod} repair`} description="Choose a repair direction, predict the result, and explain why the method may help before changing the image." />
      <fieldset className="choice-group choice-card-grid"><legend>Which repair direction will you try?</legend>{directionOptions(selectedMethod).map(([value, label]) => <label key={value} className={direction === value ? 'is-selected' : ''}><input type="radio" name="repair-direction" checked={direction === value} onChange={() => { setDirection(value); if (value === 'remove_patch') setParametersByMethod((current) => ({ ...current, Patch: { ...current.Patch, size_fraction: 0 } })) }} />{label}</label>)}</fieldset>
      <fieldset className="choice-group"><legend>What do you predict will happen?</legend>{[['restored', 'The correct classification will be restored'], ['still_incorrect', 'The image will still be misclassified'], ['uncertain', 'Not sure']].map(([value, label]) => <label key={value}><input type="radio" name="repair-prediction" checked={prediction === value} onChange={() => setPrediction(value)} />{label}</label>)}</fieldset>
      <label className="open-response"><strong>Why do you think this repair method may help?</strong><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain your repair idea before seeing the result…" /><small>{reason.trim().length} characters</small></label>
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('observe')}>Back to Observe</button><button className="primary-button" type="button" disabled={!direction || !prediction || reason.trim().length === 0} onClick={() => setPhase('manipulate')}>Continue to Manipulate</button></div>
    </> : null}

    {phase === 'manipulate' ? <>
      <PanelTitle label="Manipulate" title={`Apply your ${selectedMethod} repair idea`} description={`Attempts remaining before this repair: ${attemptsRemaining}. Adjust the parameters, then continue without seeing the result.`} />
      <section className="single-parameter-experiment"><div className={`experiment-preview ${isPreviewing ? 'is-loading' : ''}`}>{selectedMethod === 'Pixel' ? <PixelInspector originalUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} modifiedUrl={previewUrl ?? resolveApiUrl(selectedCase.playerCase.initial_image_url)} subject="traffic light" strength={currentParameters.epsilon_pixels ?? 0} /> : <ImagePreviewCard title={isPreviewing ? 'Updating repair preview…' : 'Repair preview'} imageUrl={previewUrl ?? resolveApiUrl(selectedCase.playerCase.initial_image_url)} alt="Traffic light Patch repair preview" details={<span>{parameterSummary(currentParameters)}</span>} />}</div><div className="experiment-controls"><div className="card-heading"><strong>{selectedMethod} repair settings</strong><StatusBadge tone="neutral">{attemptsRemaining} attempts left</StatusBadge></div>{selectedMethod === 'Patch' ? <>{['position_x', 'position_y'].map((name) => { const rule = selectedCase.playerCase.parameter_rules.find((item) => item.parameter === name); const values = rule?.allowed_values ?? []; const index = values.indexOf(currentParameters[name]); return <label className="repair-slider" key={name}><span>{name === 'position_x' ? 'Horizontal position' : 'Vertical position'} <strong>{currentParameters[name]?.toFixed(2)}</strong></span><input type="range" min="0" max={Math.max(0, values.length - 1)} value={Math.max(0, index)} onChange={(event) => updateParameter(name, values[Number(event.target.value)])} /></label> })}<fieldset className="repair-size-options"><legend>Patch size</legend><div className="patch-option-row">{selectedCase.playerCase.parameter_rules.find((item) => item.parameter === 'size_fraction')?.allowed_values?.map((value) => <button key={value} type="button" className={currentParameters.size_fraction === value ? 'is-selected' : ''} aria-pressed={currentParameters.size_fraction === value} onClick={() => updateParameter('size_fraction', value)}>{Math.round(value * 100)}%</button>)}</div></fieldset></> : <div className="pixel-strength-control"><label htmlFor="repair-pixel-strength">Pixel strength <strong>{currentParameters.epsilon_pixels}/255</strong></label><input id="repair-pixel-strength" type="range" min="0" max={(selectedCase.playerCase.parameter_rules[0].allowed_values?.length ?? 1) - 1} value={selectedCase.playerCase.parameter_rules[0].allowed_values?.indexOf(currentParameters.epsilon_pixels) ?? 0} onChange={(event) => { const values = selectedCase.playerCase.parameter_rules[0].allowed_values ?? []; updateParameter('epsilon_pixels', values[Number(event.target.value)]) }} /><p className="control-description">Click the full image in Pixel Inspector to compare the same 32×32 region.</p></div>}<div className="repair-plan-reminder"><strong>Your repair idea</strong><span>{directionOptions(selectedMethod).find(([value]) => value === direction)?.[1]}</span><small>{reason}</small></div></div></section>
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('plan')}>Back to Plan</button><button className="primary-button" type="button" onClick={() => { setCurrentAttempt(null); setPhase('reclassify') }}>Continue to Reclassify</button></div>
    </> : null}

    {phase === 'reclassify' ? <>
      <PanelTitle label="Reclassify" title={currentAttempt ? 'Repair result revealed' : 'Test this repair with the classifier'} description="Only the Modified image is sent to ResNet-34. Original and Enhanced difference remain observation tools." />
      <div className="reclassify-action-layout"><div>{selectedMethod === 'Pixel' ? <PixelInspector originalUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} modifiedUrl={resolveApiUrl(currentAttempt?.action.image_url ?? previewUrl ?? selectedCase.playerCase.initial_image_url)} subject="traffic light" strength={currentParameters.epsilon_pixels ?? 0} /> : <ImagePreviewCard title="Before reclassification" imageUrl={resolveApiUrl(currentAttempt?.action.image_url ?? previewUrl ?? selectedCase.playerCase.initial_image_url)} alt="Traffic light repair before classification" details={<span>{parameterSummary(currentParameters)}</span>} />}</div><div className="reclassify-center-action"><span>Send repaired image to classifier</span><button className="primary-button" type="button" disabled={isSubmitting || currentAttempt !== null} onClick={() => void runReclassification()}>{isSubmitting ? 'Reclassifying…' : currentAttempt ? 'Reclassified' : 'Reclassify image'}</button></div><ClassificationResultCard title="After reclassification" prediction={currentAttempt?.action.top1} correctLabel={selectedCase.playerCase.correct_label} reveal={currentAttempt !== null} /></div>
      {navigationPrompt ? <p className="reclassify-required-notice" role="status">{navigationPrompt}</p> : null}
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => currentAttempt ? setNavigationPrompt('This result has been recorded. Continue to Compare before changing the repair.') : setPhase('manipulate')}>Back to Manipulate</button><button className="primary-button" type="button" onClick={() => currentAttempt ? setPhase('compare') : setNavigationPrompt('Reclassify the repaired image before continuing to Compare.')}>Continue to Compare</button></div>
    </> : null}

    {phase === 'compare' && currentAttempt ? <>
      <PanelTitle label="Compare" title={currentAttempt.action.classification_restored ? 'The correct classification was restored' : currentAttempt.fallback ? 'Verified repair result' : 'This repair did not restore the correct classification'} description="Compare your prediction and repair reason with the actual evidence before deciding what to do next." />
      {selectedMethod === 'Pixel' ? <><PixelInspector originalUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} modifiedUrl={resolveApiUrl(currentAttempt.action.image_url)} subject="traffic light" strength={Number(currentAttempt.parameters.epsilon_pixels ?? 0)} /><div className="comparison-evidence comparison-evidence--classification-only"><ClassificationResultCard title="Before" prediction={selectedCase.playerCase.initial_top1} correctLabel={selectedCase.playerCase.correct_label} /><ClassificationResultCard title="After" prediction={currentAttempt.action.top1} correctLabel={selectedCase.playerCase.correct_label} /></div></> : <div className="comparison-evidence"><div><ImagePreviewCard title="Starting attacked image" imageUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} alt="Traffic light before repair" /><ClassificationResultCard title="Before" prediction={selectedCase.playerCase.initial_top1} correctLabel={selectedCase.playerCase.correct_label} /></div><div><ImagePreviewCard title="Modified repair image" imageUrl={resolveApiUrl(currentAttempt.action.image_url)} alt="Traffic light after repair" details={<span>{parameterSummary(currentAttempt.parameters)}</span>} /><ClassificationResultCard title="After" prediction={currentAttempt.action.top1} correctLabel={selectedCase.playerCase.correct_label} /></div></div>}
      <dl className="comparison-facts"><div><dt>Repair direction</dt><dd>{directionOptions(selectedMethod).find(([value]) => value === currentAttempt.direction)?.[1] ?? 'Verified fallback'}</dd></div><div><dt>Your prediction</dt><dd>{currentAttempt.prediction.replaceAll('_', ' ')}</dd></div><div><dt>Actual evidence</dt><dd>{currentAttempt.action.classification_restored ? 'Correct classification restored' : 'Still misclassified'}</dd></div></dl>
      <PredictedClassExplorer expectedLabel={selectedCase.playerCase.correct_label} predictedLabel={currentAttempt.action.correct_label_is_top1 ? selectedCase.playerCase.initial_top1.label : currentAttempt.action.top1.label} />
      <section className="repair-reason-evidence"><strong>Your reason before the test</strong><p>{currentAttempt.reason}</p></section>
      <div className="stage-navigation stage-navigation--end">{currentAttempt.action.classification_restored || currentAttempt.fallback ? <button className="primary-button" type="button" onClick={finishMethod}>{completedMethods.length === 1 ? 'Continue to Reflection' : 'Choose the other repair method'}</button> : currentAttempt.action.attempts_remaining === 0 ? <button className="primary-button" type="button" disabled={isSubmitting} onClick={() => void runFallback()}>{isSubmitting ? 'Applying verified repair…' : 'Show and apply verified repair'}</button> : <button className="primary-button" type="button" onClick={() => { setDirection(''); setPrediction(''); setReason(''); setCurrentAttempt(null); setPhase('plan') }}>Plan another repair</button>}</div>
    </> : null}

    {phase === 'reflect1' ? <>
      <PanelTitle label="Reflect · 1 of 2" title="Review your first repair ideas against the evidence" description="Judge whether the later evidence supported, partly supported, or challenged each original idea." />
      {(['Patch', 'Pixel'] as Method[]).map((method) => { const idea = initialIdeas[method]; const first = attempts.find((attempt) => attempt.method === method && !attempt.fallback); return <section className="initial-idea-card" key={method}><p className="step-label">{method} initial repair idea</p><h3>{directionOptions(method).find(([value]) => value === first?.direction)?.[1] ?? 'Repair direction'}</h3><p><strong>Your original reason:</strong> {idea?.reason}</p><p><strong>What happened:</strong> {first?.action.top1.label}; {first?.action.classification_restored ? 'correct classification restored' : 'correct classification was not restored'}.</p><fieldset className="choice-group"><legend>What did this result show about your {method} repair idea?</legend>{[['worked', 'It worked as expected'], ['partly_helped', 'It helped, but did not fully restore the correct class'], ['did_not_help', 'It did not help'], ['uncertain', 'I am still uncertain']].map(([value, label]) => <label key={value}><input type="radio" name={`idea-evaluation-${method}`} checked={ideaEvaluation[method] === value} onChange={() => setIdeaEvaluation((current) => ({ ...current, [method]: value }))} />{label}</label>)}</fieldset></section> })}
      <label className="open-response"><strong>What did those results make you think differently about?</strong><textarea value={reconsideration} onChange={(event) => setReconsideration(event.target.value)} placeholder="The results made me reconsider…" /></label>
      <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" disabled={!ideaEvaluation.Patch || !ideaEvaluation.Pixel || reconsideration.trim().length === 0} onClick={() => setPhase('reflect2')}>Continue to Reflect 2 of 2</button></div>
    </> : null}

    {phase === 'reflect2' ? <>
      <PanelTitle label="Reflect · 2 of 2" title="Consider what the evidence can and cannot show" description="Keep the conclusion tied to this traffic light case and the repair settings you tested." />
      <fieldset className="choice-group"><legend>What remains uncertain after these attempts? Select every statement that still applies.</legend>{[['another_image', 'Whether the same repair would work for another image.'], ['different_parameter', 'Whether a different parameter would work better.'], ['another_direction', 'Whether another repair direction could also work.'], ['not_enough_evidence', 'I still do not have enough evidence to identify the best repair.']].map(([value, label]) => <label key={value}><input type="checkbox" checked={uncertainties.includes(value)} onChange={(event) => setUncertainties((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} />{label}</label>)}</fieldset>
      <label className="open-response"><strong>What would you take from this case?</strong><span>Summarise what the evidence suggests without turning this result into a rule for every image.</span><textarea value={takeaway} onChange={(event) => setTakeaway(event.target.value)} placeholder="From this case, the evidence suggests…" /><small>{takeaway.trim().length} characters · write at least 20</small></label>
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('reflect1')}>Back to Reflect 1</button><button className="primary-button" type="button" disabled={uncertainties.length === 0 || takeaway.trim().length < 20 || isSubmitting} onClick={() => void finishReflection()}>{isSubmitting ? 'Saving reflection…' : 'Complete Repair Investigation'}</button></div>
    </> : null}

    {phase === 'summary' ? <div className="standalone-summary"><Sparkles size={30} /><p className="step-label">Repair Investigation summary</p><h2>Needs further investigation</h2><p>When an image classifier gives an unexpected result, do not assume that one repair will always work. Observe the image and classification result, form a repair hypothesis, make one controlled adjustment, reclassify, compare the evidence, and reflect on how the result affected your judgement. A repair that works in one case may not work in another, but this evidence-driven investigation process can be applied to new image-classification problems.</p><p>{attempts.some((attempt) => !attempt.fallback && attempt.action.classification_restored) ? 'The correct class was restored in at least one formal attempt, but this does not establish that the same repair will work for another image.' : 'The correct class was not restored in your formal attempts. Keeping the outcome uncertain is appropriate when the available evidence is not enough.'}</p><button className="primary-button" type="button" onClick={() => setPhase('complete')}>Continue</button></div> : null}
    {phase === 'complete' ? <div className="stage-complete stage-ready" role="status"><Sparkles size={32} /><p className="step-label">Repair Investigation complete</p><h2>You are ready for Transfer</h2><p>Next, apply the same evidence-driven investigation process to a new image.</p><div className="ready-actions"><button className="primary-button" type="button" disabled={isMovingNext} onClick={onContinue}>{isMovingNext ? 'Loading Transfer…' : 'Continue to Transfer'}</button></div></div> : null}
    {error || nextError ? <div className="error-message" role="alert"><Wrench size={18} /><p>{error ?? nextError}</p><button className="secondary-button inline-button" type="button" onClick={() => setError(null)}>Retry</button></div> : null}
  </div>
}
