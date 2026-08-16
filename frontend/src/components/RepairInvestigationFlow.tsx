import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Wrench } from 'lucide-react'

import { applyVerifiedFallback, completeStageRun, previewRuntimeImage, reclassifyRuntimeImage, resolveApiUrl, saveStageResponse } from '../api'
import type { ActiveStage, RepairAttempt } from '../types'
import { ClassificationResultCard, ImagePreviewCard, PanelTitle, SimulationNotice, StatusBadge, StepProgress } from './GameUi'
import { InvestigationOrderTask } from './InvestigationOrderTask'
import type { InvestigationOrderResult } from './InvestigationOrderTask'
import { PixelCompareEvidence } from './PixelCompareEvidence'
import { PixelInspector } from './PixelInspector'
import { PixelStrengthControl } from './PixelStrengthControl'
import { PredictedClassExplorer } from './PredictedClassExplorer'
import { SynchronizedImageZoom } from './SynchronizedImageZoom'
import { parametersMatch } from './parameterComparison'

type Method = 'Patch' | 'Pixel'
type Phase = 'observe' | 'plan' | 'manipulate' | 'reclassify' | 'compare' | 'fallback' | 'reflect-order' | 'reflect-concept' | 'reflect-feedback' | 'summary' | 'complete'

type RepairInvestigationFlowProps = {
  cases: ActiveStage[]
  nextError: string | null
  onStageComplete: (cases: ActiveStage[]) => void
  onContinue: () => void
  isMovingNext: boolean
}

const STEPS = ['Observe', 'Predict', 'Manipulate', 'Reclassify', 'Compare', 'Reflect'] as const
const PHASE_INDEX: Record<Phase, number> = { observe: 0, plan: 1, manipulate: 2, reclassify: 3, compare: 4, fallback: 4, 'reflect-order': 5, 'reflect-concept': 5, 'reflect-feedback': 5, summary: 5, complete: 5 }

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
    ['reduce_patch', 'Adjust the Patch size'],
    ['move_and_reduce', 'Change both Patch position and size'],
  ] : [
    ['adjust_strength', 'Adjust the Pixel strength'],
  ]
}

function nonZeroValues(values: number[] | undefined): number[] {
  return (values ?? []).filter((value) => value > 0)
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
  const [attempts, setAttempts] = useState<RepairAttempt[]>([])
  const [currentAttempt, setCurrentAttempt] = useState<RepairAttempt | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [navigationPrompt, setNavigationPrompt] = useState<string | null>(null)
  const [orderResult, setOrderResult] = useState<InvestigationOrderResult | null>(null)
  const [crossImageExpectation, setCrossImageExpectation] = useState('')

  const selectedCase = cases.find((item) => methodFor(item) === selectedMethod) ?? cases[0]
  const currentParameters = parametersByMethod[selectedMethod]
  const methodAttempts = useMemo(() => attempts.filter((attempt) => attempt.method === selectedMethod), [attempts, selectedMethod])
  const parametersBeforeCurrentRepair = methodAttempts.at(-1)?.parameters ?? initialParameters(selectedCase)
  const parametersUnchanged = parametersMatch(currentParameters, parametersBeforeCurrentRepair)
  const pixelBaselineUnlocked = attempts.some((attempt) => attempt.method === 'Pixel' && !attempt.fallback && attempt.parameters.epsilon_pixels !== 0)
  const attemptsRemaining = currentAttempt?.action.attempts_remaining ?? Math.max(0, (selectedCase.playerCase.max_attempts ?? 3) - methodAttempts.filter((attempt) => !attempt.fallback).length)

  useEffect(() => {
    if (phase !== 'manipulate') return
    if (selectedMethod === 'Pixel' && parametersUnchanged) return
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
  }, [currentParameters, parametersUnchanged, phase, selectedCase.stageRun.id, selectedMethod])

  function chooseMethod(method: Method) {
    setSelectedMethod(method); setDirection(''); setCurrentAttempt(null); setPreviewUrl(null); setPhase('plan')
  }

  function updateParameter(name: string, value: number) {
    setParametersByMethod((current) => ({ ...current, [selectedMethod]: { ...current[selectedMethod], [name]: value } }))
  }

  async function runReclassification() {
    if (isSubmitting || currentAttempt || parametersUnchanged || !direction) return
    setIsSubmitting(true); setError(null); setNavigationPrompt(null)
    try {
      const action = await reclassifyRuntimeImage(selectedCase.stageRun.id, {
        tool_type: selectedMethod === 'Patch' ? 'adjust_patch' : 'change_epsilon',
        parameters: currentParameters,
        predicted_outcome: direction,
      })
      const attempt: RepairAttempt = { method: selectedMethod, direction, prediction: direction, reason: '', parameters: { ...currentParameters }, action, fallback: false }
      setAttempts((current) => [...current, attempt]); setCurrentAttempt(attempt)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The repaired image could not be classified.') }
    finally { setIsSubmitting(false) }
  }

  async function runFallback() {
    if (isSubmitting) return
    setIsSubmitting(true); setError(null)
    try {
      const action = await applyVerifiedFallback(selectedCase.stageRun.id)
      const attempt: RepairAttempt = { method: selectedMethod, direction: 'verified_fallback', prediction: 'verified_fallback_will_restore', reason: 'System-provided verified repair.', parameters: action.parameters as Record<string, number>, action, fallback: true }
      setAttempts((current) => [...current, attempt]); setCurrentAttempt(attempt); setPhase('fallback')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The verified fallback could not be applied.') }
    finally { setIsSubmitting(false) }
  }

  function finishMethod() {
    const nextCompleted = completedMethods.includes(selectedMethod) ? completedMethods : [...completedMethods, selectedMethod]
    setCompletedMethods(nextCompleted); setCurrentAttempt(null); setDirection('')
    if (nextCompleted.length === 2) setPhase('reflect-order')
    else setPhase('observe')
  }

  async function finishReflection() {
    if (isSubmitting || !orderResult || !crossImageExpectation) return
    setIsSubmitting(true); setError(null)
    try {
      const primaryRun = cases[0].stageRun.id
      await saveStageResponse(primaryRun, { question_key: 'stage3_investigation_order', question_version: 3, answer_type: 'multiple_choice', answer_json: orderResult })
      await saveStageResponse(primaryRun, { question_key: 'stage3_cross_image_expectation', question_version: 3, answer_type: 'choice', answer_value: crossImageExpectation })
      const completedCases: ActiveStage[] = []
      for (const item of cases) completedCases.push({ ...item, stageRun: await completeStageRun(item.stageRun.id) })
      onStageComplete(completedCases); setPhase('reflect-feedback')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Repair Investigation could not be completed.') }
    finally { setIsSubmitting(false) }
  }

  return <div className="repair-flow">
    <StepProgress steps={STEPS} currentIndex={PHASE_INDEX[phase]} />
    <SimulationNotice>Repair Investigation generates each selected repair and checks it with ResNet-34. You have up to three autonomous attempts per attack.</SimulationNotice>

    {phase === 'observe' ? <>
      <PanelTitle label="Observe" title="Choose a misclassified image to repair" description="Goal: Investigate how changing repair settings affects the AI’s classification judgement. Try to restore the correct classification, but use every result as evidence for what to test next." />
      <div className="variable-tabs" role="tablist" aria-label="Repair methods">{cases.map((activeCase) => { const method = methodFor(activeCase); const complete = completedMethods.includes(method); return <button key={method} type="button" role="tab" aria-selected={selectedMethod === method} className={selectedMethod === method ? 'is-selected' : ''} onClick={() => setSelectedMethod(method)}><strong>{method}</strong><small>{method === 'Patch' ? 'Repair position and size' : 'Repair attack strength'}</small>{complete ? <StatusBadge tone="success">Complete</StatusBadge> : null}</button> })}</div>
      <div className="evidence-grid"><ImagePreviewCard title={`${selectedMethod} starting image`} imageUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} alt={`Misclassified traffic light with ${selectedMethod}`} details={<><span>Correct class: <strong>{selectedCase.playerCase.correct_label}</strong></span><StatusBadge tone="warning">Repair needed</StatusBadge></>} /><div className="starting-evidence-column"><ClassificationResultCard title="Current incorrect classification" prediction={selectedCase.playerCase.initial_top1} correctLabel={selectedCase.playerCase.correct_label} /><section className="starting-parameters"><strong>Current attack parameters</strong><span>{parameterSummary(initialParameters(selectedCase))}</span><span>Autonomous attempts available: {selectedCase.playerCase.max_attempts ?? 3}</span></section></div></div>
      <div className="stage-navigation stage-navigation--end">{completedMethods.includes(selectedMethod) ? <p className="completed-variable-notice">This repair method is complete. Choose the other attack.</p> : <button className="primary-button" type="button" onClick={() => chooseMethod(selectedMethod)}>Predict a repair direction</button>}</div>
    </> : null}

    {phase === 'plan' ? <>
      <PanelTitle label="Predict" title={`Predict a ${selectedMethod} repair direction`} description="Choose the repair direction you think could help, then test it with the real classifier." />
      <fieldset className="choice-group choice-card-grid"><legend>Which repair direction do you think could help restore the correct classification?</legend>{directionOptions(selectedMethod).map(([value, label]) => <label key={value} className={direction === value ? 'is-selected' : ''}><input type="radio" name="repair-direction" checked={direction === value} onChange={() => setDirection(value)} />{label}</label>)}</fieldset>
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('observe')}>Back to Observe</button><button className="primary-button" type="button" disabled={!direction} onClick={() => setPhase('manipulate')}>Continue to Manipulate</button></div>
    </> : null}

    {phase === 'manipulate' ? <>
      <PanelTitle label="Manipulate" title={directionOptions(selectedMethod).find(([value]) => value === direction)?.[1] ?? `Adjust the ${selectedMethod}`} description={`Attempts remaining before this repair: ${attemptsRemaining}. Adjust the parameters, then continue without seeing the result.`} />
      <section className="single-parameter-experiment"><div className={`experiment-preview ${isPreviewing ? 'is-loading' : ''}`}>{selectedMethod === 'Pixel' ? <PixelInspector originalUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} modifiedUrl={previewUrl ?? resolveApiUrl(selectedCase.playerCase.initial_image_url)} subject="traffic light" strength={currentParameters.epsilon_pixels ?? 0} /> : <ImagePreviewCard title={isPreviewing ? 'Updating repair preview…' : 'Repair preview'} imageUrl={previewUrl ?? resolveApiUrl(selectedCase.playerCase.initial_image_url)} alt="Traffic light Patch repair preview" details={<span>{parameterSummary(currentParameters)}</span>} />}</div><div className="experiment-controls"><div className="card-heading"><strong>{selectedMethod} repair settings</strong><StatusBadge tone="neutral">{attemptsRemaining} attempts left</StatusBadge></div>{selectedMethod === 'Patch' ? <>{direction !== 'reduce_patch' ? ['position_x', 'position_y'].map((name) => { const rule = selectedCase.playerCase.parameter_rules.find((item) => item.parameter === name); const values = rule?.allowed_values ?? []; const index = values.indexOf(currentParameters[name]); return <label className="repair-slider" key={name}><span>{name === 'position_x' ? 'Horizontal position' : 'Vertical position'} <strong>{currentParameters[name]?.toFixed(2)}</strong></span><input type="range" min="0" max={Math.max(0, values.length - 1)} value={Math.max(0, index)} onChange={(event) => updateParameter(name, values[Number(event.target.value)])} /></label> }) : <p className="fixed-parameter-note">Current Patch position: X {currentParameters.position_x.toFixed(2)}, Y {currentParameters.position_y.toFixed(2)}. Position stays fixed for this repair direction.</p>}{direction !== 'move_patch' ? <fieldset className="repair-size-options"><legend>Patch size</legend><div className="patch-option-row">{nonZeroValues(selectedCase.playerCase.parameter_rules.find((item) => item.parameter === 'size_fraction')?.allowed_values).map((value) => <button key={value} type="button" className={currentParameters.size_fraction === value ? 'is-selected' : ''} aria-pressed={currentParameters.size_fraction === value} onClick={() => updateParameter('size_fraction', value)}>{Math.round(value * 100)}%</button>)}</div></fieldset> : <p className="fixed-parameter-note">Current Patch size: {Math.round(currentParameters.size_fraction * 100)}%. Size stays fixed for this repair direction.</p>}</> : <PixelStrengthControl values={selectedCase.playerCase.parameter_rules[0].allowed_values ?? []} value={currentParameters.epsilon_pixels} currentValue={parametersBeforeCurrentRepair.epsilon_pixels ?? 0} showExplanation={methodAttempts.filter((attempt) => !attempt.fallback).length === 0} baselineUnlocked={pixelBaselineUnlocked} onChange={(value) => updateParameter('epsilon_pixels', value)} />}<div className="repair-plan-reminder"><strong>Your repair direction</strong><span>{directionOptions(selectedMethod).find(([value]) => value === direction)?.[1]}</span></div></div></section>
      {parametersUnchanged ? <p className="reclassify-required-notice" role="status">Change at least one repair parameter before reclassifying.</p> : null}
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => { setPreviewUrl(null); setPhase('plan') }}>Back to Predict</button><button className="primary-button" type="button" disabled={parametersUnchanged} onClick={() => { setCurrentAttempt(null); setPhase('reclassify') }}>Continue to Reclassify</button></div>
    </> : null}

    {phase === 'reclassify' ? <>
      <PanelTitle label="Reclassify" title={currentAttempt ? 'Repair result revealed' : 'Test this repair with the classifier'} description="Send the repaired image to ResNet-34, then reveal and compare its classification result." />
      <div className="reclassify-action-layout"><ImagePreviewCard title="Before reclassification" imageUrl={resolveApiUrl(currentAttempt?.action.image_url ?? previewUrl ?? selectedCase.playerCase.initial_image_url)} alt="Traffic light repair before classification" details={<span>{parameterSummary(currentParameters)}</span>} /><div className="reclassify-center-action"><span>Send repaired image to classifier</span><button className="primary-button" type="button" disabled={isSubmitting || currentAttempt !== null} onClick={() => void runReclassification()}>{isSubmitting ? 'Reclassifying…' : currentAttempt ? 'Reclassified' : 'Reclassify image'}</button></div><ClassificationResultCard title="After reclassification" prediction={currentAttempt?.action.top1} correctLabel={selectedCase.playerCase.correct_label} reveal={currentAttempt !== null} /></div>
      {navigationPrompt ? <p className="reclassify-required-notice" role="status">{navigationPrompt}</p> : null}
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => currentAttempt ? setNavigationPrompt('This result has been recorded. Continue to Compare before changing the repair.') : setPhase('manipulate')}>Back to Manipulate</button><button className="primary-button" type="button" onClick={() => currentAttempt ? setPhase('compare') : setNavigationPrompt('Reclassify the repaired image before continuing to Compare.')}>Continue to Compare</button></div>
    </> : null}

    {phase === 'compare' && currentAttempt ? <>
      <PanelTitle label="Compare" title={currentAttempt.action.classification_restored ? 'The correct classification was restored' : currentAttempt.fallback ? 'Verified repair result' : 'This repair did not restore the correct classification'} description="Compare the selected repair parameters with the actual classifier result before deciding what to do next." />
      {selectedMethod === 'Pixel' ? <>
        <PixelCompareEvidence beforeImageUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} beforeStrength={Number(initialParameters(selectedCase).epsilon_pixels ?? 0)} beforePrediction={selectedCase.playerCase.initial_top1} afterImageUrl={resolveApiUrl(currentAttempt.action.image_url)} afterStrength={Number(currentAttempt.parameters.epsilon_pixels ?? 0)} afterPrediction={currentAttempt.action.top1} correctLabel={selectedCase.playerCase.correct_label} subject="traffic light" classificationRestored={currentAttempt.action.classification_restored} revealOriginalStrength={currentAttempt.action.classification_restored || currentAttempt.fallback || currentAttempt.action.attempts_remaining === 0} />
        <PixelInspector originalUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} modifiedUrl={resolveApiUrl(currentAttempt.action.image_url)} subject="traffic light" strength={Number(currentAttempt.parameters.epsilon_pixels ?? 0)} />
      </> : <><div className="comparison-evidence"><div><ImagePreviewCard title="Before" imageUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} alt="Initial traffic light Patch image" details={<span>{parameterSummary(initialParameters(selectedCase))}</span>} /><ClassificationResultCard title="Before classification" prediction={selectedCase.playerCase.initial_top1} correctLabel={selectedCase.playerCase.correct_label} /></div><div><ImagePreviewCard title="After" imageUrl={resolveApiUrl(currentAttempt.action.image_url)} alt="Modified traffic light Patch image" details={<span>{parameterSummary(currentAttempt.parameters)}</span>} /><ClassificationResultCard title="After classification" prediction={currentAttempt.action.top1} correctLabel={selectedCase.playerCase.correct_label} /></div></div><SynchronizedImageZoom beforeUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} afterUrl={resolveApiUrl(currentAttempt.action.image_url)} subject="traffic light" /></>}
      {currentAttempt.fallback ? <section className="verified-fallback"><p className="step-label">System verified repair</p><h3>Correct repair parameters</h3><strong>{parameterSummary(currentAttempt.parameters)}</strong><p>These parameters were verified in advance and applied only after all three autonomous attempts.</p></section> : null}
      <dl className="comparison-facts"><div><dt>Predicted repair direction</dt><dd>{directionOptions(selectedMethod).find(([value]) => value === currentAttempt.direction)?.[1] ?? 'Verified fallback'}</dd></div><div><dt>Parameters tested</dt><dd>{parameterSummary(currentAttempt.parameters)}</dd></div><div><dt>Actual evidence</dt><dd>{currentAttempt.action.classification_restored ? 'Correct classification restored' : 'Still misclassified'}</dd></div></dl>
      {currentAttempt.action.classification_restored ? <p className="prediction-feedback prediction-feedback--match">This repair direction and setting restored the correct classification for this image.</p> : <p className="prediction-feedback">This repair did not restore the correct classification. Use the result to predict what repair direction to try next.</p>}
      <PredictedClassExplorer expectedLabel={selectedCase.playerCase.correct_label} predictedLabel={currentAttempt.action.correct_label_is_top1 ? selectedCase.playerCase.initial_top1.label : currentAttempt.action.top1.label} />
      <div className="stage-navigation stage-navigation--end">{currentAttempt.action.classification_restored || currentAttempt.fallback ? <button className="primary-button" type="button" onClick={finishMethod}>{completedMethods.length === 1 ? 'Continue to Reflection' : 'Choose the other repair method'}</button> : currentAttempt.action.attempts_remaining === 0 ? <button className="primary-button" type="button" disabled={isSubmitting} onClick={() => void runFallback()}>{isSubmitting ? 'Applying verified repair…' : 'Show and apply verified repair'}</button> : <button className="primary-button" type="button" onClick={() => { setDirection(''); setCurrentAttempt(null); setPreviewUrl(null); setPhase('plan') }}>Predict another repair direction</button>}</div>
    </> : null}

    {phase === 'fallback' && currentAttempt?.fallback ? <>
      <PanelTitle label="Verified fallback result" title="The correct classification was restored" description="After three unsuccessful repairs, the system applied a repair that was verified in advance for this case." />
      <div className="fallback-result-layout">
        {selectedMethod === 'Pixel' ? <PixelInspector originalUrl={resolveApiUrl(selectedCase.playerCase.initial_image_url)} modifiedUrl={resolveApiUrl(currentAttempt.action.image_url)} subject="traffic light" strength={Number(currentAttempt.parameters.epsilon_pixels ?? 0)} /> : <ImagePreviewCard title="Correct repaired image" imageUrl={resolveApiUrl(currentAttempt.action.image_url)} alt="Traffic light after the verified repair" details={<StatusBadge tone="success">Correct result</StatusBadge>} />}
        <ClassificationResultCard title="Correct classification" prediction={currentAttempt.action.top1} correctLabel={selectedCase.playerCase.correct_label} />
      </div>
      <section className="verified-fallback"><p className="step-label">System verified repair</p><h3>Correct repair parameters</h3><strong>{parameterSummary(currentAttempt.parameters)}</strong><p>These parameters were verified in advance and applied only after all three user attempts.</p></section>
      <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={finishMethod}>{completedMethods.length === 1 ? 'Continue to Reflection' : 'Choose the other repair method'}</button></div>
    </> : null}

    {phase === 'reflect-order' ? <>
      <PanelTitle label="Reflection" title="Rebuild the investigation process" description="Arrange the five steps without relying on a fixed Patch or Pixel setting." />
      <InvestigationOrderTask onComplete={(result) => setOrderResult(result)} />
      <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" disabled={!orderResult} onClick={() => setPhase('reflect-concept')}>Continue to question 2</button></div>
    </> : null}

    {phase === 'reflect-concept' ? <>
      <PanelTitle label="Reflection · 2 of 2" title="Decide what can transfer to another image" description="The same modification settings can be applied to images with different visual content." />
      <fieldset className="choice-group"><legend>If the same modification settings are applied to a different image, what should you expect?</legend>{[
        ['always_same', 'It will always produce the same classification result.'],
        ['may_differ', 'It may produce a different classification result.'],
        ['always_restores', 'It will always restore the correct classification.'],
        ['cannot_affect', 'It cannot affect the classification result.'],
      ].map(([value, label]) => <label key={value}><input type="radio" name="cross-image-expectation" checked={crossImageExpectation === value} onChange={() => setCrossImageExpectation(value)} />{label}</label>)}</fieldset>
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('reflect-order')}>Back to step order</button><button className="primary-button" type="button" disabled={!crossImageExpectation || isSubmitting} onClick={() => void finishReflection()}>{isSubmitting ? 'Saving reflection…' : 'Submit reflection'}</button></div>
    </> : null}

    {phase === 'reflect-feedback' ? <>
      <PanelTitle label="Reflection feedback" title={crossImageExpectation === 'may_differ' ? 'The result still needs to be tested' : 'The same settings do not guarantee the same result'} description="Use the evidence from each image rather than assuming that one setting is universal." />
      <p className={`prediction-feedback ${crossImageExpectation === 'may_differ' ? 'prediction-feedback--match' : ''}`}>{crossImageExpectation === 'may_differ' ? 'Correct. The effect of a modification can depend on the image, the type of modification, and its settings. A setting that works for one image still needs to be tested on another image.' : 'Not necessarily. The same settings may produce a different classification result on another image, so the result still needs to be tested.'}</p>
      <section className="generalisation-feedback"><h3>Patch and Pixel are examples, not the only possibilities</h3><p>Other image changes—such as cropping, compression, blur, noise, lighting changes, colour changes, or occlusion—may also affect an AI classifier.</p><p>The investigation process can be reused even when the type of image change is different. The specific direction and settings still need to be tested.</p></section>
      <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={() => setPhase('summary')}>Continue to Summary</button></div>
    </> : null}

    {phase === 'summary' ? <div className="standalone-summary"><Sparkles size={30} /><p className="step-label">Repair Investigation summary</p><h2>A process you can reuse</h2><p>Image changes can take many forms, and the same settings may produce different results on different images. What can be reused is the investigation process: observe the image and current classification, predict a direction to test, make a controlled change, reclassify, and compare the result.</p><p>Use the evidence from each result to decide what to test next. Do not assume that a setting that worked once will work for every image.</p><button className="primary-button" type="button" onClick={() => setPhase('complete')}>Continue</button></div> : null}
    {phase === 'complete' ? <div className="stage-complete stage-ready" role="status"><Sparkles size={32} /><p className="step-label">Repair Investigation complete</p><h2>You are ready for Transfer</h2><p>Next, apply the same evidence-driven investigation process to a new image.</p><div className="ready-actions"><button className="primary-button" type="button" disabled={isMovingNext} onClick={onContinue}>{isMovingNext ? 'Loading Transfer…' : 'Continue to Transfer'}</button></div></div> : null}
    {error || nextError ? <div className="error-message" role="alert"><Wrench size={18} /><p>{error ?? nextError}</p><button className="secondary-button inline-button" type="button" onClick={() => setError(null)}>Retry</button></div> : null}
  </div>
}
