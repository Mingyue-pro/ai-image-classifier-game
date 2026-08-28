import { useMemo, useRef, useState } from 'react'
import { Eye, ScanSearch, Sparkles } from 'lucide-react'

import { applyFixedChoice, completeStageRun, resolveApiUrl, saveStageResponse } from '../api'
import type { ActiveStage, GameAction, StageOneSummary } from '../types'
import { ClassificationResultCard, ImagePreviewCard, PanelTitle, SimulationNotice, StatusBadge, StepProgress } from './GameUi'
import { PixelInspector } from './PixelInspector'
import { PIXEL_INTRODUCTION_EXPLANATION, PixelConceptNote, PixelSubtleObservation } from './PixelLearning'

type Phase = 'observe' | 'select' | 'predict' | 'manipulate' | 'reclassify' | 'compare' | 'reflection' | 'summary' | 'complete'
type PredictionChoice = 'classification_changes' | 'classification_stays_same' | 'uncertain'
type RecordedTest = { action: GameAction; prediction: PredictionChoice; method: 'Patch' | 'Pixel'; beforeLabel: string }

type StageOneFlowProps = {
  cases: ActiveStage[]
  isMovingNext: boolean
  nextError: string | null
  priorSummaries: StageOneSummary[]
  onStageComplete: (completedCases: ActiveStage[], summaries: StageOneSummary[]) => void
  onContinue: () => void
}

const STEPS = ['Observe', 'Predict', 'Manipulate', 'Reclassify', 'Compare', 'Summary'] as const
const PHASE_INDEX: Record<Phase, number> = { observe: 0, select: 0, predict: 1, manipulate: 2, reclassify: 3, compare: 4, reflection: 5, summary: 5, complete: 5 }

export function StageOneFlow({ cases, isMovingNext, nextError, priorSummaries, onStageComplete, onContinue }: StageOneFlowProps) {
  const baselineCase = cases[0].playerCase
  const scenarios = useMemo(() => cases.flatMap((activeCase) => {
    const states = activeCase.playerCase.available_states
    const selectedStates = states.length <= 2 ? states : activeCase.playerCase.attack_type === 'fgsm' ? [states[Math.min(1, states.length - 1)], states.at(-1)!] : [states[0], states.at(-1)!]
    return selectedStates.map((state) => ({ activeCase, state }))
  }), [cases])
  const [phase, setPhase] = useState<Phase>('observe')
  const [selectedStateId, setSelectedStateId] = useState('')
  const [prediction, setPrediction] = useState<PredictionChoice | ''>('')
  const [applied, setApplied] = useState(false)
  const [result, setResult] = useState<GameAction | null>(null)
  const [results, setResults] = useState<RecordedTest[]>([])
  const [reflectionChoice, setReflectionChoice] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submissionLock = useRef(false)
  const [reclassifyPrompt, setReclassifyPrompt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [completedCases, setCompletedCases] = useState<ActiveStage[] | null>(null)
  const selectedScenario = scenarios.find(({ state }) => state.state_id === selectedStateId) ?? null
  const selectedState = selectedScenario?.state ?? null
  const selectedActiveCase = selectedScenario?.activeCase ?? cases[0]
  const playerCase = selectedActiveCase.playerCase
  const stageRun = selectedActiveCase.stageRun
  const methodName = playerCase.attack_type === 'fgsm' ? 'Pixel' : 'Patch'

  function choosePreset(stateId: string) {
    setSelectedStateId(stateId); setPrediction(''); setApplied(false); setPhase('predict')
  }

  function startNextTest() {
    setSelectedStateId(''); setPrediction(''); setApplied(false); setResult(null)
    setPhase(results.length >= 4 ? 'reflection' : 'select')
  }

  async function reclassify() {
    if (!prediction || !selectedState || submissionLock.current || isSubmitting) return
    submissionLock.current = true
    setIsSubmitting(true); setError(null); setReclassifyPrompt(null)
    try {
      const action = await applyFixedChoice(stageRun.id, { state_id: selectedState.state_id, predicted_outcome: prediction })
      setResult(action); setResults((current) => [...current, { action, prediction, method: methodName, beforeLabel: playerCase.initial_top1.label }])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The verified result could not be loaded. Please retry.')
    } finally { submissionLock.current = false; setIsSubmitting(false) }
  }

  const methodSummaries: StageOneSummary[] = results.map(({ action, prediction: recordedPrediction, method, beforeLabel }) => ({
    method,
    parameters: action.parameters,
    prediction: recordedPrediction,
    top1_before: beforeLabel,
    top1_after: action.top1.label,
    classification_changed: action.classification_changed,
    prediction_matched: recordedPrediction === 'uncertain' ? null : (recordedPrediction === 'classification_changes') === action.classification_changed,
  }))

  async function finishCase() {
    if (!reflectionChoice || isSubmitting) return
    setIsSubmitting(true); setError(null)
    try {
      const responseRun = cases.find((item) => item.playerCase.attack_type === 'fgsm')?.stageRun ?? cases[0].stageRun
      await saveStageResponse(responseRun.id, { question_key: 'stage1_observation_conclusion', question_version: 1, answer_type: 'choice', answer_value: reflectionChoice })
      const completedRuns = await Promise.all(cases.map((item) => completeStageRun(item.stageRun.id)))
      setCompletedCases(cases.map((item, index) => ({ ...item, stageRun: completedRuns[index] })))
      setPhase('summary')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The case could not be completed.')
    } finally { setIsSubmitting(false) }
  }

  if (cases.every((item) => item.stageRun.completion_status !== 'in_progress')) {
    return <div className="stage-complete stage-ready" role="status"><Sparkles size={32} /><p className="step-label">Tutorial complete</p><h2>You are ready for Condition Training</h2><p>Next, explore how different Patch and Pixel parameter settings affect classification.</p><div className="ready-actions"><button className="primary-button" type="button" disabled={isMovingNext} onClick={onContinue}>{isMovingNext ? 'Loading Condition Training…' : 'Continue to Condition Training'}</button></div></div>
  }

  const predictionMatched = result && prediction !== 'uncertain' ? (prediction === 'classification_changes') === result.classification_changed : null

  return (
    <div className="stage-one-flow">
      <StepProgress steps={STEPS} currentIndex={PHASE_INDEX[phase]} />
      <SimulationNotice />
      {phase === 'observe' ? <>
        <PanelTitle className="stage-one-wide-title" label="Observe" title="Start with the unmodified image" description="Inspect the image and its verified baseline classification. In this Tutorial, you will complete all four fixed investigations." />
        <div className="evidence-grid">
          <ImagePreviewCard title="Original image" imageUrl={resolveApiUrl(baselineCase.initial_image_url)} alt={`Original ${baselineCase.subject}`} details={<><span>True class: <strong>{baselineCase.correct_label}</strong></span><StatusBadge tone="neutral">No attack</StatusBadge></>} />
          <ClassificationResultCard title="Baseline classification" prediction={baselineCase.initial_top1} correctLabel={baselineCase.correct_label} />
        </div>
        <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={() => setPhase('select')}>Continue to Select Change</button></div>
      </> : null}

      {phase === 'select' ? <>
        <PanelTitle className="stage-one-wide-title" label="Observe · Select change" title="Choose a fixed investigation" description="All four fixed Patch and Pixel investigations are available. Complete every investigation before finishing the Tutorial." />
        <div className="preset-grid">
          {scenarios.map(({ activeCase, state }) => {
            const used = results.some((item) => item.action.parameters.state_id === state.state_id)
            const scenarioMethod = activeCase.playerCase.attack_type === 'fgsm' ? 'Pixel' : 'Patch'
            const parameterName = scenarioMethod === 'Patch' ? 'size_fraction' : 'epsilon_pixels'
            const parameterValue = Number(state.parameters[parameterName] ?? 0)
            const methodValues = scenarios.filter(({ activeCase: item }) => item.playerCase.attack_type === activeCase.playerCase.attack_type).map(({ state: item }) => Number(item.parameters[parameterName] ?? 0))
            const isLowerSetting = parameterValue === Math.min(...methodValues)
            const scenarioName = scenarioMethod === 'Patch' ? `${isLowerSetting ? 'Small' : 'Large'} Patch` : `${isLowerSetting ? 'Low' : 'High'}-strength Pixel change`
            return <button key={`${activeCase.playerCase.case_id}-${state.state_id}`} type="button" className={`preset-card ${used ? 'is-complete' : ''}`} disabled={used} onClick={() => choosePreset(state.state_id)}><span className="scenario-icon">{scenarioMethod === 'Patch' ? <ScanSearch size={18} /> : <Sparkles size={18} />}</span><strong>{scenarioName}</strong><span>Fixed {scenarioMethod} modification</span>{used ? <em>Completed</em> : <small>View plan and predict</small>}</button>
          })}
        </div>
        <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('observe')}>Back to Observe</button></div>
      </> : null}

      {phase === 'predict' && selectedState ? <>
        <PanelTitle label="Predict" title="What do you expect to happen?" description="Review the fixed plan, then make a prediction before seeing the result." />
        {methodName === 'Pixel' && !results.some((item) => item.method === 'Pixel') ? <PixelConceptNote variant="introduction" /> : null}
        <div className="modification-summary"><strong>{methodName} plan</strong><span>Fixed {methodName} modification</span></div>
        <fieldset className="choice-group"><legend>What will happen to the AI's current main classification judgement?</legend>{[
          ['classification_changes', "The AI's main judgement will change"], ['classification_stays_same', "The AI's main judgement will not change"], ['uncertain', 'Not sure'],
        ].map(([value, label]) => <label key={value}><input type="radio" name="prediction" checked={prediction === value} onChange={() => setPrediction(value as PredictionChoice)} />{label}</label>)}</fieldset>
        <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('select')}>Back to Select</button><button className="primary-button" type="button" disabled={!prediction} onClick={() => setPhase('manipulate')}>Continue to Manipulate</button></div>
      </> : null}

      {phase === 'manipulate' && selectedState ? <>
        <PanelTitle label="Manipulate" title="Apply the fixed modification" description={methodName === 'Pixel' ? `${PIXEL_INTRODUCTION_EXPLANATION} Apply it, then inspect the two selected regions before revealing the observation note.` : 'Select Apply to view the fixed Patch. The classification remains hidden.'} />
        {methodName === 'Pixel' && applied ? <>
          <ImagePreviewCard title="Modified image preview" imageUrl={resolveApiUrl(selectedState.image_url)} alt={`Modified ${playerCase.subject} preview`} details={<span>Fixed Pixel modification · classification still hidden</span>} />
          <PixelInspector mode="introduction" showStrengthDetails={false} allowRegionSelection={false} originalUrl={resolveApiUrl(playerCase.initial_image_url)} modifiedUrl={resolveApiUrl(selectedState.image_url)} subject={playerCase.subject} strength={Number(selectedState.parameters.epsilon_pixels ?? 0)} />
          <section className="stage-two-pixel-action-prompt" aria-label="Next: reclassify the Pixel modification"><strong>The changes may still be difficult to see.</strong><p>You have chosen a Pixel modification and previewed the modified image. <strong>Next, reclassify the image to test your prediction.</strong></p></section>
        </> : <div className="manipulation-preview"><img src={resolveApiUrl(applied ? selectedState.image_url : playerCase.initial_image_url)} alt={applied ? `Modified ${playerCase.subject} preview` : `Original ${playerCase.subject}`} /></div>}
        <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => setPhase('predict')}>Back to Predict</button>{applied ? <button className="primary-button" type="button" onClick={() => setPhase('reclassify')}>Continue to Reclassify</button> : <button className="primary-button" type="button" onClick={() => setApplied(true)}>Apply change</button>}</div>
      </> : null}

      {phase === 'reclassify' && selectedState ? <>
        <PanelTitle label="Reclassify" title={result ? 'New classification result' : 'Request the classification result'} description={result ? 'Review the newly revealed result, then continue to the full comparison.' : 'Your prediction is now locked. Reclassify the modified image to test it.'} />
        <div className="reclassify-action-layout"><div><ImagePreviewCard title="Before reclassification" imageUrl={resolveApiUrl(selectedState.image_url)} alt="Modified image ready for reclassification" details={<span>Fixed {methodName} modification</span>} /></div><div className="reclassify-center-action"><span>Send modified image to classifier</span><button className="primary-button" type="button" disabled={isSubmitting || result !== null} onClick={() => void reclassify()}>{isSubmitting ? 'Reclassifying…' : result ? 'Reclassified' : 'Reclassify image'}</button></div><ClassificationResultCard title="After reclassification" prediction={result?.top1} correctLabel={playerCase.correct_label} reveal={result !== null} /></div>
        {reclassifyPrompt ? <p className="reclassify-required-notice" role="status">{reclassifyPrompt}</p> : null}
        <div className="stage-navigation"><button className="secondary-button" type="button" onClick={() => result ? setReclassifyPrompt('The result has already been recorded. Continue to Compare before changing the image.') : setPhase('manipulate')}>Back to Manipulate</button><button className="primary-button" type="button" onClick={() => result ? setPhase('compare') : setReclassifyPrompt('Reclassify the image first to reveal the result before continuing.')}>Continue to Compare</button></div>
      </> : null}

      {phase === 'compare' && result ? <>
        <PanelTitle label="Compare" title="Compare your prediction with the evidence" description="A changed or unchanged classification is a valid observation." />
        <section className="comparison-evidence" aria-label="Before and after image classification evidence"><div><ImagePreviewCard title="Before modification" imageUrl={resolveApiUrl(playerCase.initial_image_url)} alt={`Original ${playerCase.subject} before modification`} /><ClassificationResultCard title="Before classification" prediction={playerCase.initial_top1} correctLabel={playerCase.correct_label} /></div><div><ImagePreviewCard title="After modification" imageUrl={resolveApiUrl(result.image_url)} alt={`Modified ${playerCase.subject} after modification`} /><ClassificationResultCard title="After classification" prediction={result.top1} correctLabel={playerCase.correct_label} /></div></section>
        {methodName === 'Pixel' ? <><PixelInspector mode="introduction" showStrengthDetails={false} allowRegionSelection={false} originalUrl={resolveApiUrl(playerCase.initial_image_url)} modifiedUrl={resolveApiUrl(result.image_url)} subject={playerCase.subject} strength={Number(selectedState?.parameters.epsilon_pixels ?? 0)} /><div className="pixel-stage-one-conclusion"><PixelSubtleObservation /></div></> : null}
        <dl className="comparison-facts"><div><dt>Modification</dt><dd>Fixed {methodName} modification</dd></div><div><dt>Your prediction</dt><dd>{prediction.replaceAll('_', ' ')}</dd></div><div><dt>Actual result</dt><dd>{result.classification_changed ? "The AI's main judgement changed" : "The AI's main judgement did not change"}</dd></div></dl>
        <p className={`prediction-feedback ${predictionMatched ? 'prediction-feedback--match' : ''}`}>{prediction === 'uncertain' ? 'You selected “Not sure”; this result gives you new evidence.' : predictionMatched ? 'Prediction correct — it matched this result.' : 'Prediction incorrect — use this result as evidence for the next case.'}</p>
        <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" onClick={startNextTest}>{results.length >= 4 ? 'Continue to Summary' : 'Return to Select Change'}</button></div>
      </> : null}

      {phase === 'reflection' ? <>
        <PanelTitle label="Reflect" title="What did the four investigations show?" description="Use the evidence table to choose the statement that best matches your observations." />
        <fieldset className="choice-group"><legend>Which statement best matches the results?</legend>{[
          ['always_changes', 'Any image modification always changes the classification.'], ['never_changes', 'Image modifications never change the classification.'], ['depends_on_conditions', 'A modification may change the result or leave it unchanged, depending on the conditions.'], ['patch_only', 'Patch always changes the result, while Pixel never does.'],
        ].map(([value, label]) => <label key={value}><input type="radio" name="reflection" checked={reflectionChoice === value} onChange={() => setReflectionChoice(value)} />{label}</label>)}</fieldset>
        <div className="stage-summary"><h3>Stage 1 evidence summary</h3><div className="summary-table" role="table" aria-label="Stage 1 results"><div className="summary-row summary-head" role="row"><span>Method</span><span>Modification</span><span>Before → After</span><span>Prediction</span><span>Changed?</span><span>Matched?</span></div>{[...priorSummaries, ...methodSummaries].map((item, index) => <div className="summary-row" role="row" key={`${item.method}-${index}`}><span>{item.method}</span><span>Fixed {item.method} modification</span><span>{item.top1_before} → {item.top1_after}</span><span>{item.prediction.replaceAll('_', ' ')}</span><span>{item.classification_changed ? 'Yes' : 'No'}</span><span>{item.prediction_matched === null ? 'Not sure' : item.prediction_matched ? 'Yes' : 'No'}</span></div>)}</div>{reflectionChoice ? <p className={`prediction-feedback ${reflectionChoice === 'depends_on_conditions' ? 'prediction-feedback--match' : ''}`}>{reflectionChoice === 'depends_on_conditions' ? 'Correct. Modification alone does not guarantee a changed classification.' : 'Review the evidence: some results changed and others did not.'}</p> : null}</div>
        <div className="stage-navigation stage-navigation--end"><button className="primary-button" type="button" disabled={!reflectionChoice || isSubmitting || isMovingNext} onClick={() => void finishCase()}>{isSubmitting || isMovingNext ? 'Saving…' : 'Complete the Tutorial Stage'}</button></div>
      </> : null}
      {phase === 'summary' ? <div className="standalone-summary"><Eye size={30} /><p className="step-label">Tutorial summary</p><h2>What these cases show</h2><p>In these cases, some image modifications changed the classification result, while others did not. Therefore, knowing only that an image was modified is not enough to predict that the classification result will definitely change.</p><button className="primary-button" type="button" disabled={!completedCases} onClick={() => { if (completedCases) { onStageComplete(completedCases, methodSummaries); setPhase('complete') } }}>Continue</button></div> : null}
      {phase === 'complete' ? <div className="stage-complete stage-ready" role="status"><Sparkles size={32} /><p className="step-label">Tutorial complete</p><h2>You are ready for Condition Training</h2><p>Next, investigate how different parameter settings can produce different classification outcomes.</p><div className="ready-actions"><button className="primary-button" type="button" disabled={isMovingNext} onClick={onContinue}>{isMovingNext ? 'Loading Condition Training…' : 'Continue to Condition Training'}</button></div></div> : null}
      {error || nextError ? <div className="error-message" role="alert"><p>{error ?? nextError}</p><button type="button" className="secondary-button inline-button" onClick={() => setError(null)}>Retry</button></div> : null}
    </div>
  )
}
