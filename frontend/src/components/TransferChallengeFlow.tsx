import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Wrench } from 'lucide-react'

import { applyVerifiedFallback, completeResearchSession, completeStageRun, previewRuntimeImage, reclassifyRuntimeImage, resolveApiUrl, saveStageResponse } from '../api'
import type { ActiveStage, RepairAttempt } from '../types'
import { AttemptHistory } from './AttemptHistory'
import { ClassificationResultCard, ImagePreviewCard, PanelTitle, StatusBadge } from './GameUi'
import { PixelCompareEvidence } from './PixelCompareEvidence'
import { PixelInspector } from './PixelInspector'
import { PixelStrengthControl } from './PixelStrengthControl'
import { SynchronizedImageZoom } from './SynchronizedImageZoom'
import { parametersMatch } from './parameterComparison'

type Method = 'Patch' | 'Pixel'
type PatchDirection = 'move_patch' | 'reduce_patch' | 'move_and_resize_patch'
type Phase = 'observe' | 'strategy-feedback' | 'predict' | 'manipulate' | 'reclassify' | 'review' | 'compare' | 'fallback' | 'method-summary' | 'reflect' | 'reflect-feedback' | 'complete'
type Props = { cases: ActiveStage[]; nextError: string | null; onStageComplete: (cases: ActiveStage[]) => void; onViewReport: () => void }

const STRATEGIES = [
  ['controlled_investigation', 'Choose a repair direction, change one variable, reclassify the image, and compare the result.'],
  ['change_several', 'Change several settings at the same time and see whether anything improves.'],
  ['remove_everything', 'Remove every modification immediately so that the image becomes correct.'],
  ['assume_cause', 'Assume that the image modification caused the error without testing it.'],
  ['not_sure', 'I am not sure.'],
] as const
const REPAIR_OPTIONS = [
  ['move_patch', 'Move the Patch'],
  ['reduce_patch', 'Adjust the Patch size'],
  ['move_and_resize_patch', 'Change both Patch position and size'],
  ['adjust_pixel_strength', 'Adjust the Pixel strength'],
] as const
const CONCLUSIONS = [
  ['always_errors', 'Image modifications always cause classification errors.'],
  ['reducing_always_restores', 'Reducing a modification always restores the correct classification.'],
  ['conditional_evidence', 'The effect depends on the image, the modification and its parameters; one result may not establish the complete cause.'],
  ['one_failure_rules_out', 'If one adjustment fails, the modification cannot be related to the error.'],
] as const
const SOLE_CAUSE_OPTIONS = [
  ['yes', 'Yes.'],
  ['no', 'No.'],
  ['not_sure', 'I am not sure.'],
] as const

function methodFor(item: ActiveStage): Method { return item.playerCase.attack_type === 'fgsm' ? 'Pixel' : 'Patch' }
function initialParameters(item: ActiveStage): Record<string, number> { return Object.fromEntries(item.playerCase.parameter_rules.flatMap((rule) => typeof rule.initial_value === 'number' ? [[rule.parameter, rule.initial_value]] : [])) }
function parameterSummary(values: Record<string, number>): string { return Object.entries(values).map(([name, value]) => name === 'epsilon_pixels' ? `Strength ${value}/255` : name === 'size_fraction' ? `Size ${Math.round(value * 100)}%` : `${name === 'position_x' ? 'X' : 'Y'} ${value.toFixed(2)}`).join(' · ') }

export function TransferChallengeFlow({ cases, nextError, onStageComplete, onViewReport }: Props) {
  const [phase, setPhase] = useState<Phase>('observe')
  const [strategy, setStrategy] = useState('')
  const [strategyReason, setStrategyReason] = useState('')
  const [currentMethod, setCurrentMethod] = useState<Method>('Patch')
  const [completedMethods, setCompletedMethods] = useState<Method[]>([])
  const [repairIdea, setRepairIdea] = useState('')
  const [patchDirection, setPatchDirection] = useState<PatchDirection>('move_patch')
  const [parameters, setParameters] = useState<Record<Method, Record<string, number>>>(() => ({ Patch: initialParameters(cases.find((item) => methodFor(item) === 'Patch') ?? cases[0]), Pixel: initialParameters(cases.find((item) => methodFor(item) === 'Pixel') ?? cases[0]) }))
  const [attempts, setAttempts] = useState<RepairAttempt[]>([])
  const [currentAttempt, setCurrentAttempt] = useState<RepairAttempt | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [conclusion, setConclusion] = useState('')
  const [evidenceExplanation, setEvidenceExplanation] = useState('')
  const [soleCause, setSoleCause] = useState('')
  const [otherFactors, setOtherFactors] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const reclassificationLock = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const selectedMethod = currentMethod
  const selectedCaseSource = cases.find((item) => methodFor(item) === selectedMethod) ?? cases[0]
  const selectedCase = useMemo(() => ({
    ...selectedCaseSource,
    playerCase: {
      ...selectedCaseSource.playerCase,
      parameter_rules: selectedCaseSource.playerCase.parameter_rules.map((rule) => ({
        ...rule,
        allowed_values: rule.allowed_values,
      })),
    },
  }), [selectedCaseSource])
  const currentParameters = parameters[selectedMethod]
  const methodAttempts = useMemo(() => attempts.filter((attempt) => attempt.method === selectedMethod && !attempt.fallback), [attempts, selectedMethod])
  const parametersBeforeCurrentRepair = methodAttempts.at(-1)?.parameters ?? initialParameters(selectedCase)
  const parametersUnchanged = parametersMatch(currentParameters, parametersBeforeCurrentRepair)
  const attemptsRemaining = currentAttempt?.action.attempts_remaining ?? Math.max(0, (selectedCase.playerCase.max_attempts ?? 3) - methodAttempts.length)

  useEffect(() => {
    if (phase !== 'manipulate') return
    if (selectedMethod === 'Pixel' && parametersUnchanged) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const result = await previewRuntimeImage(selectedCase.stageRun.id, { tool_type: selectedMethod === 'Patch' ? 'adjust_patch' : 'change_epsilon', parameters: currentParameters })
        if (!cancelled) setPreviewUrl(`${resolveApiUrl(result.image_url)}?v=${Date.now()}`)
      } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : 'The preview could not be generated.') }
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [currentParameters, parametersUnchanged, phase, selectedCase.stageRun.id, selectedMethod])

  function updateParameter(name: string, value: number) { setParameters((current) => ({ ...current, [selectedMethod]: { ...current[selectedMethod], [name]: value } })) }
  function choosePatchDirection(direction: PatchDirection) {
    setPatchDirection(direction)
    const initial = initialParameters(cases.find((item) => methodFor(item) === 'Patch') ?? cases[0])
    setParameters((current) => ({ ...current, Patch: { ...current.Patch, position_x: initial.position_x, position_y: initial.position_y, size_fraction: direction === 'move_patch' ? 0.35 : initial.size_fraction } }))
  }

  async function submitStrategy() {
    if (!strategy || !strategyReason.trim() || isSubmitting) return
    setIsSubmitting(true); setError(null)
    try {
      await saveStageResponse(cases[0].stageRun.id, { question_key: 'transfer_next_step_strategy', question_version: 2, answer_type: 'choice', answer_value: strategy })
      await saveStageResponse(cases[0].stageRun.id, { question_key: 'transfer_next_step_reason', question_version: 2, answer_type: 'text', answer_text: strategyReason.trim() })
      setPhase('strategy-feedback')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Your investigation strategy could not be saved.') }
    finally { setIsSubmitting(false) }
  }

  async function submitRepairPrediction() {
    if (!repairIdea || isSubmitting) return
    setIsSubmitting(true); setError(null)
    try {
      const responsePrefix = selectedMethod === 'Patch' ? 'transfer_patch_repair' : 'transfer_pixel_repair'
      await saveStageResponse(selectedCase.stageRun.id, { question_key: `${responsePrefix}_direction`, question_version: 2, answer_type: 'choice', answer_value: repairIdea })
      if (repairIdea !== 'adjust_pixel_strength') choosePatchDirection(repairIdea as PatchDirection)
      setPhase('manipulate')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Your repair direction could not be saved.') }
    finally { setIsSubmitting(false) }
  }

  async function runReclassification() {
    if (currentAttempt || reclassificationLock.current || isSubmitting || parametersUnchanged) return
    reclassificationLock.current = true
    setIsSubmitting(true); setError(null)
    try {
      const direction = selectedMethod === 'Patch' ? patchDirection : 'adjust_pixel_strength'
      const action = await reclassifyRuntimeImage(selectedCase.stageRun.id, { tool_type: selectedMethod === 'Patch' ? 'adjust_patch' : 'change_epsilon', parameters: currentParameters })
      const attempt: RepairAttempt = { method: selectedMethod, direction, prediction: '', reason: '', parameters: { ...currentParameters }, action, fallback: false }
      setAttempts((current) => [...current, attempt]); setCurrentAttempt(attempt)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The image could not be reclassified.') }
    finally { reclassificationLock.current = false; setIsSubmitting(false) }
  }

  async function continueAfterComparison() {
    if (!currentAttempt || isSubmitting) return
    if (currentAttempt.action.classification_restored || currentAttempt.fallback) {
      finishMethod()
      return
    }
    if (currentAttempt.action.attempts_remaining !== 0) {
      setCurrentAttempt(null); setPreviewUrl(null); setPhase('manipulate')
      return
    }
    setIsSubmitting(true); setError(null)
    try {
      const action = await applyVerifiedFallback(selectedCase.stageRun.id)
      const attempt: RepairAttempt = { method: selectedMethod, direction: 'verified_fallback', prediction: '', reason: '', parameters: action.parameters as Record<string, number>, action, fallback: true }
      setAttempts((current) => [...current, attempt]); setCurrentAttempt(attempt); setPhase('fallback')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The verified fallback could not be applied.') }
    finally { setIsSubmitting(false) }
  }

  function finishMethod() {
    const completed = completedMethods.includes(selectedMethod) ? completedMethods : [...completedMethods, selectedMethod]
    setCompletedMethods(completed)
    setCurrentAttempt(null); setPreviewUrl(null); setRepairIdea('')
    if (completed.length === 2) setPhase('reflect')
    else setPhase('method-summary')
  }

  async function finishTransfer() {
    if (!soleCause || !otherFactors.trim() || !conclusion || evidenceExplanation.trim().length < 20 || isSubmitting) return
    setIsSubmitting(true); setError(null)
    try {
      await saveStageResponse(cases[0].stageRun.id, { question_key: 'transfer_only_possible_cause', question_version: 1, answer_type: 'choice', answer_value: soleCause })
      await saveStageResponse(cases[0].stageRun.id, { question_key: 'transfer_other_contributing_factors', question_version: 1, answer_type: 'text', answer_text: otherFactors.trim() })
      await saveStageResponse(cases[0].stageRun.id, { question_key: 'transfer_evidence_conclusion', question_version: 2, answer_type: 'choice', answer_value: conclusion })
      await saveStageResponse(cases[0].stageRun.id, { question_key: 'transfer_evidence_explanation', question_version: 2, answer_type: 'text', answer_text: evidenceExplanation.trim() })
      const completed: ActiveStage[] = []
      for (const item of cases) completed.push({ ...item, stageRun: await completeStageRun(item.stageRun.id) })
      await completeResearchSession(cases[0].stageRun.session_id)
      onStageComplete(completed); setPhase('reflect-feedback')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Transfer could not be completed.') }
    finally { setIsSubmitting(false) }
  }

  const initialImage = resolveApiUrl(selectedCase.playerCase.initial_image_url)
  const availableRepairOptions = REPAIR_OPTIONS.filter(([value]) => selectedMethod === 'Patch' ? value !== 'adjust_pixel_strength' : value === 'adjust_pixel_strength')
  const completedMethodAttempt = [...attempts].reverse().find((attempt) => attempt.method === selectedMethod)
  return <div className="transfer-flow">
    {phase === 'observe' ? <><PanelTitle label="Transfer challenge" title="Preview the two new misclassified cases" description="You will apply the same evidence-based investigation process first to a Patch case and then to a Pixel case." /><div className="comparison-evidence transfer-case-overview">{cases.map((item, index) => { const method = methodFor(item); return <div key={item.playerCase.case_id}><ImagePreviewCard title={`${index + 1}. ${method} case`} imageUrl={resolveApiUrl(item.playerCase.initial_image_url)} alt={`Previously unseen ice cream ${method} case`} details={<StatusBadge tone="warning">Incorrectly classified</StatusBadge>} /><ClassificationResultCard title={`${method} classification`} prediction={item.playerCase.initial_top1} correctLabel={item.playerCase.correct_label} /></div> })}</div><fieldset className="choice-group"><legend>You will investigate these two incorrectly classified images. Which next step would provide the most useful evidence?</legend>{STRATEGIES.map(([value, label]) => <label key={value} className={strategy === value ? 'is-selected' : ''}><input type="radio" name="transfer-strategy" checked={strategy === value} onChange={() => setStrategy(value)} />{label}</label>)}</fieldset><label className="open-response"><strong>Why did you choose this next step?</strong><textarea value={strategyReason} onChange={(event) => setStrategyReason(event.target.value)} /></label><div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" disabled={!strategy || !strategyReason.trim() || isSubmitting} onClick={() => void submitStrategy()}>{isSubmitting ? 'Saving…' : 'Submit answer'}</button></div></> : null}
    {phase === 'strategy-feedback' ? <><PanelTitle label="Immediate feedback" title={strategy === 'controlled_investigation' ? 'This step creates useful comparison evidence' : 'A controlled investigation would provide stronger evidence'} description={strategy === 'controlled_investigation' ? 'This approach creates useful comparison evidence because it selects a repair direction, changes one variable, and checks the actual result.' : 'Changing one variable and checking the result makes it easier to compare evidence and understand what may have influenced the classifier.'} /><div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={() => setPhase('predict')}>Begin the Patch case</button></div></> : null}
    {phase === 'predict' ? <><PanelTitle label={`${selectedMethod} case · ${completedMethods.length + 1} of 2`} title={`Which ${selectedMethod} repair direction will you test?`} description={`The ${selectedMethod} image remains fixed throughout this sub-case. Choose one controlled repair direction, then adjust its parameters.`} /><div className="evidence-grid"><ImagePreviewCard title={`${selectedMethod} starting image`} imageUrl={initialImage} alt={`Ice cream ${selectedMethod} case`} details={<span>{parameterSummary(initialParameters(selectedCase))}</span>} /><ClassificationResultCard title="Starting classification" prediction={selectedCase.playerCase.initial_top1} correctLabel={selectedCase.playerCase.correct_label} /></div><fieldset className="choice-group choice-card-grid"><legend>Select one repair direction</legend>{availableRepairOptions.map(([value, label]) => <label key={value} className={repairIdea === value ? 'is-selected' : ''}><input type="radio" name="transfer-repair" checked={repairIdea === value} onChange={() => setRepairIdea(value)} />{label}</label>)}</fieldset><div className={`stage-navigation ${completedMethods.length ? 'stage-navigation--end' : ''}`}>{completedMethods.length ? null : <button className="secondary-button" type="button" onClick={() => setPhase('strategy-feedback')}>Back to strategy feedback</button>}<button className="primary-button" type="button" disabled={!repairIdea || isSubmitting} onClick={() => void submitRepairPrediction()}>{isSubmitting ? 'Saving…' : 'Continue to Manipulate'}</button></div></> : null}
    {phase === 'manipulate' ? <><PanelTitle label="Manipulate" title={REPAIR_OPTIONS.find(([value]) => value === repairIdea)?.[1] ?? `Adjust the ${selectedMethod}`} description="Change only the parameter or parameters for the repair direction you selected." /><section className="single-parameter-experiment"><div>{selectedMethod === 'Pixel' ? <PixelInspector originalUrl={initialImage} modifiedUrl={previewUrl ?? initialImage} subject="ice cream" strength={currentParameters.epsilon_pixels ?? 0} /> : <ImagePreviewCard title="Current repair preview" imageUrl={previewUrl ?? initialImage} alt="Ice cream Patch preview" details={<span>{parameterSummary(currentParameters)}</span>} />}</div><div className="experiment-controls"><StatusBadge tone="neutral">{attemptsRemaining} attempts left</StatusBadge><h3>{REPAIR_OPTIONS.find(([value]) => value === repairIdea)?.[1] ?? `Adjust the ${selectedMethod}`}</h3>{selectedMethod === 'Patch' ? <>{patchDirection !== 'reduce_patch' ? ['position_x', 'position_y'].map((name) => { const values = selectedCase.playerCase.parameter_rules.find((rule) => rule.parameter === name)?.allowed_values ?? []; return <label className="repair-slider" key={name}><span>{name === 'position_x' ? 'Horizontal position' : 'Vertical position'} <strong>{currentParameters[name].toFixed(2)}</strong></span><input type="range" min="0" max={values.length - 1} value={values.indexOf(currentParameters[name])} onChange={(event) => updateParameter(name, values[Number(event.target.value)])} /></label> }) : <p className="fixed-parameter-note">Current Patch position: X {currentParameters.position_x.toFixed(2)}, Y {currentParameters.position_y.toFixed(2)}. Position stays fixed for this repair direction.</p>}{patchDirection === 'move_patch' ? <p className="fixed-parameter-note">Current Patch size: {Math.round(currentParameters.size_fraction * 100)}%. Size stays fixed for this repair direction.</p> : <div className="patch-option-row">{selectedCase.playerCase.parameter_rules.find((rule) => rule.parameter === 'size_fraction')?.allowed_values?.filter((value) => value > 0 && value < 0.35).map((value) => <button key={value} type="button" className={currentParameters.size_fraction === value ? 'is-selected' : ''} onClick={() => updateParameter('size_fraction', value)}>{Math.round(value * 100)}%</button>)}</div>}</> : <PixelStrengthControl values={selectedCase.playerCase.parameter_rules[0].allowed_values ?? []} value={currentParameters.epsilon_pixels} currentValue={parametersBeforeCurrentRepair.epsilon_pixels ?? 0} showExplanation={methodAttempts.length === 0} baselineUnlocked onChange={(value) => updateParameter('epsilon_pixels', value)} />}</div></section>{parametersUnchanged ? <p className="reclassify-required-notice" role="status">Change at least one repair parameter before reclassifying.</p> : null}<div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('predict')}>Back to repair direction</button><button className="primary-button" type="button" disabled={parametersUnchanged} onClick={() => { setCurrentAttempt(null); setPhase('reclassify') }}>Continue to Reclassify</button></div></> : null}
    {phase === 'reclassify' ? <>
      <PanelTitle label="Reclassify" title={currentAttempt ? 'Repair result revealed' : 'Test this repair with the classifier'} description="Send the repaired image to ResNet-34, then reveal and compare its classification result." />
      <div className="reclassify-action-layout">
        <ImagePreviewCard title="Before reclassification" imageUrl={resolveApiUrl(currentAttempt?.action.image_url ?? previewUrl ?? selectedCase.playerCase.initial_image_url)} alt={`Ice cream ${selectedMethod} repair before classification`} details={<span>{parameterSummary(currentParameters)}</span>} />
        <div className="reclassify-center-action"><span>Send repaired image to classifier</span><button className="primary-button" type="button" disabled={isSubmitting || currentAttempt !== null} onClick={() => void runReclassification()}>{isSubmitting ? 'Reclassifying…' : currentAttempt ? 'Reclassified' : 'Reclassify image'}</button></div>
        <ClassificationResultCard title="After reclassification" prediction={currentAttempt?.action.top1} correctLabel={selectedCase.playerCase.correct_label} reveal={currentAttempt !== null} />
      </div>
      <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase(currentAttempt ? 'review' : 'manipulate')}>{currentAttempt ? 'Review repair settings' : 'Back to Manipulate'}</button><button className="primary-button" type="button" disabled={!currentAttempt} onClick={() => setPhase('compare')}>Continue to Compare</button></div>
    </> : null}
    {phase === 'review' && currentAttempt ? <><PanelTitle label="Review" title="Recorded repair settings" description="This attempt has already been classified and saved, so its parameters are shown read-only." /><div className="evidence-grid"><ImagePreviewCard title="Recorded repaired image" imageUrl={resolveApiUrl(currentAttempt.action.image_url)} alt="Recorded repaired ice cream image" details={<span>{parameterSummary(currentAttempt.parameters)}</span>} /><ClassificationResultCard title="Recorded classification" prediction={currentAttempt.action.top1} correctLabel={selectedCase.playerCase.correct_label} /></div><div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={() => setPhase('reclassify')}>Return to result</button></div></> : null}
    {phase === 'compare' && currentAttempt ? <><PanelTitle label={`${selectedMethod} case · Compare`} title={currentAttempt.action.classification_restored ? 'The correct label was restored' : 'The image is still classified incorrectly'} description={`Compare the ${selectedMethod} starting image, parameters and real classifier result.`} />{selectedMethod === 'Pixel' ? <><PixelCompareEvidence beforeImageUrl={initialImage} beforeStrength={Number(initialParameters(selectedCase).epsilon_pixels ?? 0)} beforePrediction={selectedCase.playerCase.initial_top1} afterImageUrl={resolveApiUrl(currentAttempt.action.image_url)} afterStrength={Number(currentAttempt.parameters.epsilon_pixels ?? 0)} afterPrediction={currentAttempt.action.top1} correctLabel={selectedCase.playerCase.correct_label} subject="ice cream" classificationRestored={currentAttempt.action.classification_restored} /><PixelInspector originalUrl={initialImage} modifiedUrl={resolveApiUrl(currentAttempt.action.image_url)} subject="ice cream" strength={Number(currentAttempt.parameters.epsilon_pixels ?? 0)} /></> : <><div className="comparison-evidence"><div><ImagePreviewCard title="Before" imageUrl={initialImage} alt="Initial ice cream Patch image" details={<span>{parameterSummary(initialParameters(selectedCase))}</span>} /><ClassificationResultCard title="Before classification" prediction={selectedCase.playerCase.initial_top1} correctLabel={selectedCase.playerCase.correct_label} /></div><div><ImagePreviewCard title="After" imageUrl={resolveApiUrl(currentAttempt.action.image_url)} alt="Modified ice cream Patch image" details={<span>{parameterSummary(currentAttempt.parameters)}</span>} /><ClassificationResultCard title="After classification" prediction={currentAttempt.action.top1} correctLabel={selectedCase.playerCase.correct_label} /></div></div><SynchronizedImageZoom beforeUrl={initialImage} afterUrl={resolveApiUrl(currentAttempt.action.image_url)} subject="ice cream" /></>}{currentAttempt.fallback ? <section className="verified-fallback"><p className="step-label">System verified repair</p><h3>Correct repair parameters</h3><strong>{parameterSummary(currentAttempt.parameters)}</strong><p>These parameters were verified in advance and applied only after all three autonomous attempts.</p></section> : null}<dl className="comparison-facts"><div><dt>Repair direction</dt><dd>{REPAIR_OPTIONS.find(([value]) => value === currentAttempt.direction)?.[1] ?? 'Verified fallback'}</dd></div><div><dt>Parameters tested</dt><dd>{parameterSummary(currentAttempt.parameters)}</dd></div><div><dt>Classification changed?</dt><dd>{currentAttempt.action.classification_changed ? 'Yes' : 'No'}</dd></div><div><dt>Correct class restored?</dt><dd>{currentAttempt.action.classification_restored ? 'Yes' : 'No'}</dd></div><div><dt>Attempts remaining</dt><dd>{currentAttempt.action.attempts_remaining}</dd></div></dl><div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" disabled={isSubmitting} onClick={() => void continueAfterComparison()}>{isSubmitting ? 'Applying verified repair…' : currentAttempt.action.classification_restored || currentAttempt.fallback ? completedMethods.length ? 'Continue to Reflection' : 'Review Patch result' : currentAttempt.action.attempts_remaining === 0 ? 'Show and apply verified repair' : 'Try another repair'}</button></div></> : null}
    {phase === 'fallback' && currentAttempt?.fallback ? <><PanelTitle label="Verified fallback result" title="The correct classification was restored" description="After three unsuccessful repairs, the system applied a repair that was verified in advance for this case." /><div className="fallback-result-layout">{selectedMethod === 'Pixel' ? <PixelInspector originalUrl={initialImage} modifiedUrl={resolveApiUrl(currentAttempt.action.image_url)} subject="ice cream" strength={Number(currentAttempt.parameters.epsilon_pixels ?? 0)} /> : <ImagePreviewCard title="Correct repaired image" imageUrl={resolveApiUrl(currentAttempt.action.image_url)} alt="Ice cream after the verified repair" details={<StatusBadge tone="success">Correct result</StatusBadge>} />}<ClassificationResultCard title="Correct classification" prediction={currentAttempt.action.top1} correctLabel={selectedCase.playerCase.correct_label} /></div><section className="verified-fallback"><p className="step-label">System verified repair</p><h3>Correct repair parameters</h3><strong>{parameterSummary(currentAttempt.parameters)}</strong><p>These parameters were verified in advance and applied only after all three user attempts.</p></section><div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={finishMethod}>{completedMethods.length ? 'Continue to Reflection' : 'Review Patch result'}</button></div></> : null}
    {phase === 'method-summary' && completedMethodAttempt ? <><PanelTitle label="Patch repair complete" title="The Patch image is repaired" description="The repaired image now receives the correct classification. Continue to investigate and repair the Pixel image." /><div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={() => { setCurrentMethod('Pixel'); setPhase('predict') }}>Begin Pixel repair</button></div></> : null}
    {phase === 'reflect' ? <><PanelTitle label="Reflect" title="Draw a conclusion from the evidence" description="Review every Patch and Pixel result, then keep your conclusion tied to the evidence from these cases." /><AttemptHistory attempts={attempts} initialLabels={{ Patch: cases.find((item) => methodFor(item) === 'Patch')?.playerCase.initial_top1.label ?? '', Pixel: cases.find((item) => methodFor(item) === 'Pixel')?.playerCase.initial_top1.label ?? '' }} title="All Transfer repair results" /><fieldset className="choice-group"><legend>Do you think the image modification was the only possible cause of the incorrect classification?</legend>{SOLE_CAUSE_OPTIONS.map(([value, label]) => <label key={value} className={soleCause === value ? 'is-selected' : ''}><input type="radio" name="transfer-sole-cause" checked={soleCause === value} onChange={() => setSoleCause(value)} />{label}</label>)}</fieldset><label className="open-response"><strong>What other factors might also have contributed to the incorrect classification?</strong><textarea value={otherFactors} onChange={(event) => setOtherFactors(event.target.value)} /></label><fieldset className="choice-group"><legend>Which conclusion is best supported by the evidence from this case?</legend>{CONCLUSIONS.map(([value, label]) => <label key={value}><input type="radio" name="transfer-conclusion" checked={conclusion === value} onChange={() => setConclusion(value)} />{label}</label>)}</fieldset><label className="open-response"><strong>Use at least one before-and-after result to explain your choice.</strong><textarea value={evidenceExplanation} onChange={(event) => setEvidenceExplanation(event.target.value)} /><small>{evidenceExplanation.trim().length} characters · write at least 20</small></label><div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" disabled={!soleCause || !otherFactors.trim() || !conclusion || evidenceExplanation.trim().length < 20 || isSubmitting} onClick={() => void finishTransfer()}>{isSubmitting ? 'Completing…' : 'Submit reflection'}</button></div></> : null}
    {phase === 'reflect-feedback' ? <><PanelTitle label="Transfer complete" title={conclusion === 'conditional_evidence' ? 'Your conclusion is supported by this evidence' : 'The evidence supports a more conditional conclusion'} description="Your choices, repair directions, comparisons and reflection have been saved." /><section className="answer-feedback"><p>{conclusion === 'conditional_evidence' ? 'The effect can depend on the image, modification and parameters.' : 'One result cannot establish a universal cause or repair rule.'}</p></section><div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={() => setPhase('complete')}>Finish Transfer</button></div></> : null}
    {phase === 'complete' ? <div className="stage-complete stage-ready"><Sparkles size={32} /><p className="step-label">Learning journey complete</p><h2>Transfer is complete</h2><p>Your full learning record is ready.</p><button className="primary-button" type="button" onClick={onViewReport}>View Investigator Report</button></div> : null}
    {error || nextError ? <div className="error-message" role="alert"><Wrench size={18} /><p>{error ?? nextError}</p></div> : null}
  </div>
}
