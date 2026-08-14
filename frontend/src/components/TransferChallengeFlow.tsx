import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Wrench } from 'lucide-react'

import { applyVerifiedFallback, completeResearchSession, completeStageRun, previewRuntimeImage, reclassifyRuntimeImage, resolveApiUrl, saveStageResponse } from '../api'
import type { ActiveStage, RepairAttempt } from '../types'
import { ClassificationResultCard, ImagePreviewCard, PanelTitle, StatusBadge } from './GameUi'
import { PixelInspector } from './PixelInspector'

type Method = 'Patch' | 'Pixel'
type PatchDirection = 'move_patch' | 'reduce_patch' | 'move_and_resize_patch'
type Phase = 'observe' | 'strategy-feedback' | 'predict' | 'manipulate' | 'reclassify' | 'compare' | 'reflect' | 'reflect-feedback' | 'complete'
type Props = { cases: ActiveStage[]; nextError: string | null; onStageComplete: (cases: ActiveStage[]) => void; onViewReport: () => void }

const STRATEGIES = [
  ['controlled_investigation', 'Make a specific prediction, change one variable, reclassify the image, and compare the result.'],
  ['change_several', 'Change several settings at the same time and see whether anything improves.'],
  ['remove_everything', 'Remove every modification immediately so that the image becomes correct.'],
  ['assume_cause', 'Assume that the image modification caused the error without testing it.'],
  ['not_sure', 'I am not sure.'],
] as const
const REPAIR_OPTIONS = [
  ['move_patch', 'Move the Patch'],
  ['reduce_patch', 'Reduce the Patch size'],
  ['move_and_resize_patch', 'Change both Patch position and size'],
  ['reduce_pixel_strength', 'Reduce the Pixel attack strength'],
] as const
const CONCLUSIONS = [
  ['always_errors', 'Image modifications always cause classification errors.'],
  ['reducing_always_restores', 'Reducing a modification always restores the correct classification.'],
  ['conditional_evidence', 'The effect depends on the image, the modification and its parameters; one result may not establish the complete cause.'],
  ['one_failure_rules_out', 'If one adjustment fails, the modification cannot be related to the error.'],
] as const
const THINKING_EFFECTS = [
  ['supported', 'It supported my explanation.'],
  ['weakened', 'It weakened my explanation.'],
  ['changed', 'It changed my explanation.'],
  ['not_sure', 'I am still not sure.'],
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
  const [repairReason, setRepairReason] = useState('')
  const [patchDirection, setPatchDirection] = useState<PatchDirection>('move_patch')
  const [parameters, setParameters] = useState<Record<Method, Record<string, number>>>(() => ({ Patch: initialParameters(cases.find((item) => methodFor(item) === 'Patch') ?? cases[0]), Pixel: initialParameters(cases.find((item) => methodFor(item) === 'Pixel') ?? cases[0]) }))
  const [attempts, setAttempts] = useState<RepairAttempt[]>([])
  const [currentAttempt, setCurrentAttempt] = useState<RepairAttempt | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [conclusion, setConclusion] = useState('')
  const [evidenceExplanation, setEvidenceExplanation] = useState('')
  const [comparisonReflections, setComparisonReflections] = useState<Record<Method, { effect: string; explanation: string }>>({ Patch: { effect: '', explanation: '' }, Pixel: { effect: '', explanation: '' } })
  const [soleCause, setSoleCause] = useState('')
  const [otherFactors, setOtherFactors] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedMethod = currentMethod
  const selectedCase = cases.find((item) => methodFor(item) === selectedMethod) ?? cases[0]
  const currentParameters = parameters[selectedMethod]
  const methodAttempts = useMemo(() => attempts.filter((attempt) => attempt.method === selectedMethod && !attempt.fallback), [attempts, selectedMethod])
  const attemptsRemaining = currentAttempt?.action.attempts_remaining ?? Math.max(0, (selectedCase.playerCase.max_attempts ?? 3) - methodAttempts.length)
  const currentComparisonReflection = comparisonReflections[selectedMethod]

  useEffect(() => {
    if (phase !== 'manipulate') return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const result = await previewRuntimeImage(selectedCase.stageRun.id, { tool_type: selectedMethod === 'Patch' ? 'adjust_patch' : 'change_epsilon', parameters: currentParameters })
        if (!cancelled) setPreviewUrl(`${resolveApiUrl(result.image_url)}?v=${Date.now()}`)
      } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : 'The preview could not be generated.') }
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [currentParameters, phase, selectedCase.stageRun.id, selectedMethod])

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
    if (!repairIdea || !repairReason.trim() || isSubmitting) return
    setIsSubmitting(true); setError(null)
    try {
      const responsePrefix = selectedMethod === 'Patch' ? 'transfer_patch_repair' : 'transfer_pixel_repair'
      await saveStageResponse(selectedCase.stageRun.id, { question_key: `${responsePrefix}_direction`, question_version: 2, answer_type: 'choice', answer_value: repairIdea })
      await saveStageResponse(selectedCase.stageRun.id, { question_key: `${responsePrefix}_reason`, question_version: 2, answer_type: 'text', answer_text: repairReason.trim() })
      if (repairIdea !== 'reduce_pixel_strength') choosePatchDirection(repairIdea as PatchDirection)
      setPhase('manipulate')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Your repair prediction could not be saved.') }
    finally { setIsSubmitting(false) }
  }

  async function runReclassification() {
    if (currentAttempt || isSubmitting) return
    setIsSubmitting(true); setError(null)
    try {
      const direction = selectedMethod === 'Patch' ? patchDirection : 'reduce_pixel_strength'
      const action = await reclassifyRuntimeImage(selectedCase.stageRun.id, { tool_type: selectedMethod === 'Patch' ? 'adjust_patch' : 'change_epsilon', parameters: currentParameters, predicted_outcome: direction, prediction_reason: repairReason.trim() })
      const attempt: RepairAttempt = { method: selectedMethod, direction, prediction: direction, reason: repairReason.trim(), parameters: { ...currentParameters }, action, fallback: false }
      setAttempts((current) => [...current, attempt]); setCurrentAttempt(attempt)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The image could not be reclassified.') }
    finally { setIsSubmitting(false) }
  }

  async function submitComparisonReflection() {
    if (!currentAttempt || !currentComparisonReflection.effect || !currentComparisonReflection.explanation.trim() || isSubmitting) return
    setIsSubmitting(true); setError(null)
    try {
      const prefix = `transfer_${selectedMethod.toLowerCase()}_attempt_${currentAttempt.action.attempt_number}`
      await saveStageResponse(selectedCase.stageRun.id, { question_key: `${prefix}_thinking_effect`, question_version: 1, answer_type: 'choice', answer_value: currentComparisonReflection.effect })
      await saveStageResponse(selectedCase.stageRun.id, { question_key: `${prefix}_thinking_explanation`, question_version: 1, answer_type: 'text', answer_text: currentComparisonReflection.explanation.trim() })
      setComparisonReflections((current) => ({ ...current, [selectedMethod]: { effect: '', explanation: '' } }))
      if (currentAttempt.action.classification_restored || currentAttempt.fallback) {
        finishMethod()
      } else if (currentAttempt.action.attempts_remaining === 0) {
        const action = await applyVerifiedFallback(selectedCase.stageRun.id)
        const attempt: RepairAttempt = { method: selectedMethod, direction: 'verified_fallback', prediction: 'verified_fallback', reason: 'System-provided verified fallback.', parameters: action.parameters as Record<string, number>, action, fallback: true }
        setAttempts((current) => [...current, attempt]); setCurrentAttempt(attempt)
      } else {
        setCurrentAttempt(null); setPhase('manipulate')
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Your comparison reflection could not be saved.') }
    finally { setIsSubmitting(false) }
  }

  function finishMethod() {
    const completed = completedMethods.includes(selectedMethod) ? completedMethods : [...completedMethods, selectedMethod]
    setCompletedMethods(completed)
    setCurrentAttempt(null); setPreviewUrl(null); setRepairIdea(''); setRepairReason('')
    if (completed.length === 2) setPhase('reflect')
    else { setCurrentMethod(selectedMethod === 'Patch' ? 'Pixel' : 'Patch'); setPhase('predict') }
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
  const availableRepairOptions = REPAIR_OPTIONS.filter(([value]) => selectedMethod === 'Patch' ? value !== 'reduce_pixel_strength' : value === 'reduce_pixel_strength')
  return <div className="transfer-flow">
    {phase === 'observe' ? <><PanelTitle label="Transfer challenge" title="Preview the two new misclassified cases" description="You will apply the same evidence-based investigation process first to a Patch case and then to a Pixel case." /><div className="comparison-evidence transfer-case-overview">{cases.map((item, index) => { const method = methodFor(item); return <div key={item.playerCase.case_id}><ImagePreviewCard title={`${index + 1}. ${method} case`} imageUrl={resolveApiUrl(item.playerCase.initial_image_url)} alt={`Previously unseen ice cream ${method} case`} details={<StatusBadge tone="warning">Incorrectly classified</StatusBadge>} /><ClassificationResultCard title={`${method} classification`} prediction={item.playerCase.initial_top1} correctLabel={item.playerCase.correct_label} /></div> })}</div><fieldset className="choice-group"><legend>You will investigate these two incorrectly classified images. Which next step would provide the most useful evidence?</legend>{STRATEGIES.map(([value, label]) => <label key={value} className={strategy === value ? 'is-selected' : ''}><input type="radio" name="transfer-strategy" checked={strategy === value} onChange={() => setStrategy(value)} />{label}</label>)}</fieldset><label className="open-response"><strong>Why did you choose this next step?</strong><textarea value={strategyReason} onChange={(event) => setStrategyReason(event.target.value)} /></label><div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" disabled={!strategy || !strategyReason.trim() || isSubmitting} onClick={() => void submitStrategy()}>{isSubmitting ? 'Saving…' : 'Submit answer'}</button></div></> : null}
    {phase === 'strategy-feedback' ? <><PanelTitle label="Immediate feedback" title={strategy === 'controlled_investigation' ? 'This step creates useful comparison evidence' : 'A controlled investigation would provide stronger evidence'} description={strategy === 'controlled_investigation' ? 'This approach creates useful comparison evidence because it records an expectation, changes one variable, and checks the actual result.' : 'Changing one variable and recording an expected result makes it easier to compare evidence and understand what may have influenced the classifier.'} /><div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={() => setPhase('predict')}>Begin the Patch case</button></div></> : null}
    {phase === 'predict' ? <><PanelTitle label={`${selectedMethod} case · ${completedMethods.length + 1} of 2`} title={`Which ${selectedMethod} repair direction will you test?`} description={`The ${selectedMethod} image remains fixed throughout this sub-case. Choose one controlled repair direction, then explain why it may help.`} /><div className="evidence-grid"><ImagePreviewCard title={`${selectedMethod} starting image`} imageUrl={initialImage} alt={`Ice cream ${selectedMethod} case`} details={<span>{parameterSummary(initialParameters(selectedCase))}</span>} /><ClassificationResultCard title="Starting classification" prediction={selectedCase.playerCase.initial_top1} correctLabel={selectedCase.playerCase.correct_label} /></div><fieldset className="choice-group choice-card-grid"><legend>Select one repair direction</legend>{availableRepairOptions.map(([value, label]) => <label key={value} className={repairIdea === value ? 'is-selected' : ''}><input type="radio" name="transfer-repair" checked={repairIdea === value} onChange={() => setRepairIdea(value)} />{label}</label>)}</fieldset><label className="open-response"><strong>Why did you choose this repair direction?</strong><textarea value={repairReason} onChange={(event) => setRepairReason(event.target.value)} /></label><div className={`stage-navigation ${completedMethods.length ? 'stage-navigation--end' : ''}`}>{completedMethods.length ? null : <button className="secondary-button" type="button" onClick={() => setPhase('strategy-feedback')}>Back to strategy feedback</button>}<button className="primary-button" type="button" disabled={!repairIdea || !repairReason.trim() || isSubmitting} onClick={() => void submitRepairPrediction()}>{isSubmitting ? 'Saving…' : 'Continue to Manipulate'}</button></div></> : null}
    {phase === 'manipulate' ? <><PanelTitle label="Manipulate" title="Test your predicted repair direction" description="Adjust only the controlled parameter or parameters for the repair direction you selected." /><section className="single-parameter-experiment"><div>{selectedMethod === 'Pixel' ? <PixelInspector originalUrl={initialImage} modifiedUrl={previewUrl ?? initialImage} subject="ice cream" strength={currentParameters.epsilon_pixels ?? 0} /> : <ImagePreviewCard title="Current repair preview" imageUrl={previewUrl ?? initialImage} alt="Ice cream Patch preview" details={<span>{parameterSummary(currentParameters)}</span>} />}</div><div className="experiment-controls"><StatusBadge tone="neutral">{attemptsRemaining} attempts left</StatusBadge><h3>{REPAIR_OPTIONS.find(([value]) => value === repairIdea)?.[1]}</h3>{selectedMethod === 'Patch' ? <>{patchDirection !== 'reduce_patch' ? ['position_x', 'position_y'].map((name) => { const values = selectedCase.playerCase.parameter_rules.find((rule) => rule.parameter === name)?.allowed_values ?? []; return <label className="repair-slider" key={name}><span>{name === 'position_x' ? 'Horizontal position' : 'Vertical position'} <strong>{currentParameters[name].toFixed(2)}</strong></span><input type="range" min="0" max={values.length - 1} value={values.indexOf(currentParameters[name])} onChange={(event) => updateParameter(name, values[Number(event.target.value)])} /></label> }) : null}{patchDirection === 'move_patch' ? <p className="fixed-parameter-note">Patch size is fixed at 35% for this repair.</p> : <div className="patch-option-row">{selectedCase.playerCase.parameter_rules.find((rule) => rule.parameter === 'size_fraction')?.allowed_values?.filter((value) => value > 0 && value < 0.35).map((value) => <button key={value} type="button" className={currentParameters.size_fraction === value ? 'is-selected' : ''} onClick={() => updateParameter('size_fraction', value)}>{Math.round(value * 100)}%</button>)}</div>}</> : <><label htmlFor="transfer-strength">Pixel strength <strong>{currentParameters.epsilon_pixels}/255</strong></label><input id="transfer-strength" type="range" min="0" max={(selectedCase.playerCase.parameter_rules[0].allowed_values?.length ?? 1) - 1} value={selectedCase.playerCase.parameter_rules[0].allowed_values?.indexOf(currentParameters.epsilon_pixels) ?? 0} onChange={(event) => { const values = selectedCase.playerCase.parameter_rules[0].allowed_values ?? []; updateParameter('epsilon_pixels', values[Number(event.target.value)]) }} /><p className="control-description">Click the full image in Pixel Inspector to compare the same 32×32 region.</p></>}</div></section><div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('predict')}>Back to repair prediction</button><button className="primary-button" type="button" onClick={() => { setCurrentAttempt(null); setPhase('reclassify') }}>Continue to Reclassify</button></div></> : null}
    {phase === 'reclassify' ? <><PanelTitle label="Reclassify" title="Check the current repaired image" description="Reclassify the image produced by your selected repair settings." /><div className="reclassify-action-layout">{selectedMethod === 'Pixel' ? <PixelInspector originalUrl={initialImage} modifiedUrl={resolveApiUrl(currentAttempt?.action.image_url ?? previewUrl ?? selectedCase.playerCase.initial_image_url)} subject="ice cream" strength={currentParameters.epsilon_pixels ?? 0} /> : <ImagePreviewCard title="Current repaired image" imageUrl={previewUrl ?? initialImage} alt="Current repaired ice cream image" details={<span>{parameterSummary(currentParameters)}</span>} />}<div className="reclassify-center-action"><button className="primary-button" type="button" disabled={isSubmitting || currentAttempt !== null} onClick={() => void runReclassification()}>{isSubmitting ? 'Reclassifying…' : currentAttempt ? 'Reclassified' : 'Reclassify image'}</button></div><ClassificationResultCard title="New classification" prediction={currentAttempt?.action.top1} correctLabel={selectedCase.playerCase.correct_label} reveal={currentAttempt !== null} /></div><div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => currentAttempt ? null : setPhase('manipulate')}>Back to Manipulate</button><button className="primary-button" type="button" disabled={!currentAttempt} onClick={() => setPhase('compare')}>Continue to Compare</button></div></> : null}
    {phase === 'compare' && currentAttempt ? <><PanelTitle label={`${selectedMethod} case · Compare`} title={currentAttempt.action.classification_restored ? 'The correct label was restored' : 'The image is still classified incorrectly'} description={`Compare the ${selectedMethod} starting image with the result of this repair.`} />{selectedMethod === 'Pixel' ? <><PixelInspector originalUrl={initialImage} modifiedUrl={resolveApiUrl(currentAttempt.action.image_url)} subject="ice cream" strength={Number(currentAttempt.parameters.epsilon_pixels ?? 0)} /><div className="comparison-evidence comparison-evidence--classification-only"><ClassificationResultCard title="Classification before" prediction={selectedCase.playerCase.initial_top1} correctLabel={selectedCase.playerCase.correct_label} /><ClassificationResultCard title="Classification after" prediction={currentAttempt.action.top1} correctLabel={selectedCase.playerCase.correct_label} /></div></> : <div className="comparison-evidence"><div><ImagePreviewCard title="Before repair" imageUrl={initialImage} alt="Ice cream before repair" details={<span>{parameterSummary(initialParameters(selectedCase))}</span>} /><ClassificationResultCard title="Classification before" prediction={selectedCase.playerCase.initial_top1} correctLabel={selectedCase.playerCase.correct_label} /></div><div><ImagePreviewCard title="After repair" imageUrl={resolveApiUrl(currentAttempt.action.image_url)} alt="Ice cream after repair" details={<span>{parameterSummary(currentAttempt.parameters)}</span>} /><ClassificationResultCard title="Classification after" prediction={currentAttempt.action.top1} correctLabel={selectedCase.playerCase.correct_label} /></div></div>}<dl className="comparison-facts"><div><dt>Repair direction</dt><dd>{REPAIR_OPTIONS.find(([value]) => value === currentAttempt.direction)?.[1] ?? 'Verified fallback'}</dd></div><div><dt>Classification changed?</dt><dd>{currentAttempt.action.classification_changed ? 'Yes' : 'No'}</dd></div><div><dt>Correct class restored?</dt><dd>{currentAttempt.action.classification_restored ? 'Yes' : 'No'}</dd></div><div><dt>Attempts remaining</dt><dd>{currentAttempt.action.attempts_remaining}</dd></div></dl><fieldset className="choice-group"><legend>Did the result support, weaken, or change your original thinking?</legend>{THINKING_EFFECTS.map(([value, label]) => <label key={value} className={currentComparisonReflection.effect === value ? 'is-selected' : ''}><input type="radio" name={`transfer-${selectedMethod.toLowerCase()}-thinking-effect`} checked={currentComparisonReflection.effect === value} onChange={() => setComparisonReflections((current) => ({ ...current, [selectedMethod]: { ...current[selectedMethod], effect: value } }))} />{label}</label>)}</fieldset><label className="open-response"><strong>Please explain how the result affected your thinking.</strong><textarea value={currentComparisonReflection.explanation} onChange={(event) => setComparisonReflections((current) => ({ ...current, [selectedMethod]: { ...current[selectedMethod], explanation: event.target.value } }))} /></label><div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" disabled={!currentComparisonReflection.effect || !currentComparisonReflection.explanation.trim() || isSubmitting} onClick={() => void submitComparisonReflection()}>{isSubmitting ? 'Saving…' : currentAttempt.action.classification_restored || currentAttempt.fallback ? completedMethods.length ? 'Continue to Reflection' : 'Continue to the Pixel case' : currentAttempt.action.attempts_remaining === 0 ? 'Save reflection and apply verified fallback' : 'Save reflection and try another repair'}</button></div></> : null}
    {phase === 'reflect' ? <><PanelTitle label="Reflect" title="Draw a conclusion from the evidence" description="Use the before-and-after evidence without turning one result into a universal rule." /><fieldset className="choice-group"><legend>Do you think the image modification was the only possible cause of the incorrect classification?</legend>{SOLE_CAUSE_OPTIONS.map(([value, label]) => <label key={value} className={soleCause === value ? 'is-selected' : ''}><input type="radio" name="transfer-sole-cause" checked={soleCause === value} onChange={() => setSoleCause(value)} />{label}</label>)}</fieldset><label className="open-response"><strong>What other factors might also have contributed to the incorrect classification?</strong><textarea value={otherFactors} onChange={(event) => setOtherFactors(event.target.value)} /></label><fieldset className="choice-group"><legend>Which conclusion is best supported by the evidence from this case?</legend>{CONCLUSIONS.map(([value, label]) => <label key={value}><input type="radio" name="transfer-conclusion" checked={conclusion === value} onChange={() => setConclusion(value)} />{label}</label>)}</fieldset><label className="open-response"><strong>Use at least one before-and-after result to explain your choice.</strong><textarea value={evidenceExplanation} onChange={(event) => setEvidenceExplanation(event.target.value)} /><small>{evidenceExplanation.trim().length} characters · write at least 20</small></label><div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" disabled={!soleCause || !otherFactors.trim() || !conclusion || evidenceExplanation.trim().length < 20 || isSubmitting} onClick={() => void finishTransfer()}>{isSubmitting ? 'Completing…' : 'Submit reflection'}</button></div></> : null}
    {phase === 'reflect-feedback' ? <><PanelTitle label="Transfer complete" title={conclusion === 'conditional_evidence' ? 'Your conclusion is supported by this evidence' : 'The evidence supports a more conditional conclusion'} description="Your choices, repair directions, comparisons and reflection have been saved." /><section className="answer-feedback"><p>{conclusion === 'conditional_evidence' ? 'The effect can depend on the image, modification and parameters.' : 'One result cannot establish a universal cause or repair rule.'}</p></section><div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={() => setPhase('complete')}>Finish Transfer</button></div></> : null}
    {phase === 'complete' ? <div className="stage-complete stage-ready"><Sparkles size={32} /><p className="step-label">Learning journey complete</p><h2>Transfer is complete</h2><p>Your full learning record is ready.</p><button className="primary-button" type="button" onClick={onViewReport}>View Investigator Report</button></div> : null}
    {error || nextError ? <div className="error-message" role="alert"><Wrench size={18} /><p>{error ?? nextError}</p></div> : null}
  </div>
}
