import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Compass, FlaskConical, Leaf, Search, ShieldCheck } from 'lucide-react'

import {
  createParticipant,
  createSession,
  completeResearchSession,
  getPlayerCase,
  getComplexTransferReflection,
  initializeComplexTransfer,
  previewComplexTransfer,
  reclassifyComplexTransfer,
  saveComplexTransferReflection,
  resolveApiUrl,
  startStageRun,
} from './api'
import { StageShell } from './components/StageShell'
import { StageOneFlow } from './components/StageOneFlow'
import { StageTwoFlow } from './components/StageTwoFlow'
import { RepairInvestigationFlow } from './components/RepairInvestigationFlow'
import { ComplexTransferFlow } from './components/ComplexTransferFlow'
import type { ComplexTransferManipulation, ComplexTransferParameters, ComplexTransferPlan } from './components/ComplexTransferFlow'
import { InvestigatorReport } from './components/InvestigatorReport'
import { AppHeader } from './components/GameUi'
import { GAME_CASES } from './gameConfig'
import { loadGameProgress, saveGameProgress } from './sessionStorage'
import { APP_PATHS, pathForStage, pathForStageNumber, stageNumberForPath } from './routes'
import type { ActiveStage, ComplexTransferApiParameters, ComplexTransferReflection, ComplexTransferRun, Participant, ResearchSession, StageOneSummary } from './types'
import './App.css'


const GAME_VERSION = 'mvp-formative-1'
const STUDY_PHASE = 'formative_1'
const CONSENT_VERSION = 'v1'

function newParticipantCode(): string {
  return `P-${crypto.randomUUID()}`
}

function GameApplication() {
  const location = useLocation()
  const navigate = useNavigate()
  const [restoredProgress] = useState(loadGameProgress)
  const [consentConfirmed, setConsentConfirmed] = useState(false)
  const [participant, setParticipant] = useState<Participant | null>(
    restoredProgress.participant,
  )
  const [researchSession, setResearchSession] =
    useState<ResearchSession | null>(restoredProgress.researchSession)
  const [activeStage, setActiveStage] = useState<ActiveStage | null>(
    restoredProgress.activeStage,
  )
  const [showReport, setShowReport] = useState(location.pathname === APP_PATHS.complete)
  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [isLoadingStage, setIsLoadingStage] = useState(false)
  const [stageError, setStageError] = useState<string | null>(null)
  const [stageOneSummaries, setStageOneSummaries] = useState<StageOneSummary[]>([])
  const [requestedStage, setRequestedStage] = useState<1 | 2 | 3 | 4>(() => stageNumberForPath(location.pathname))
  const [stageOneCases, setStageOneCases] = useState<ActiveStage[]>(
    restoredProgress.activeStage?.playerCase.stage === 'stage1' ? [restoredProgress.activeStage] : [],
  )
  const [stageTwoCases, setStageTwoCases] = useState<ActiveStage[]>(
    restoredProgress.activeStage?.playerCase.stage === 'stage2' ? [restoredProgress.activeStage] : [],
  )
  const [stageThreeCases, setStageThreeCases] = useState<ActiveStage[]>(
    restoredProgress.activeStage?.playerCase.stage === 'stage3' ? [restoredProgress.activeStage] : [],
  )
  const [transferCases, setTransferCases] = useState<ActiveStage[]>(
    restoredProgress.activeStage?.playerCase.stage === 'transfer' ? [restoredProgress.activeStage] : [],
  )
  const [complexTransferRun, setComplexTransferRun] = useState<ComplexTransferRun | null>(null)
  const [complexTransferReflection, setComplexTransferReflection] = useState<ComplexTransferReflection | null>(null)
  const loadingMissingStageOne = useRef(false)
  const loadingMissingStageTwo = useRef(false)
  const loadingMissingStageThree = useRef(false)
  const loadingMissingTransfer = useRef(false)

  useEffect(() => {
    saveGameProgress({ participant, researchSession, activeStage })
  }, [participant, researchSession, activeStage])

  useEffect(() => {
    if (location.pathname === APP_PATHS.agreement) return
    const expectedPath = showReport ? APP_PATHS.complete : activeStage !== null
      ? pathForStage(activeStage.playerCase.stage)
      : researchSession !== null
        ? pathForStageNumber(requestedStage)
        : APP_PATHS.agreement
    if (location.pathname !== expectedPath) navigate(expectedPath, { replace: true })
  }, [activeStage, location.pathname, navigate, requestedStage, researchSession, showReport])

  function returnHome() {
    setShowReport(false)
    setActiveStage(null)
    navigate(APP_PATHS.agreement, { replace: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function chooseHomeStage(stage: 1 | 2 | 3 | 4) {
    setRequestedStage(stage)
    if (researchSession === null) {
      window.setTimeout(() => document.getElementById('participation-agreement')?.scrollIntoView({ behavior: 'smooth' }), 0)
      return
    }
    setActiveStage(null)
    navigate(APP_PATHS.guidedDiscovery)
  }

  useEffect(() => {
    if (researchSession === null || activeStage === null || activeStage.playerCase.stage !== 'stage1' || stageOneCases.length >= 2 || loadingMissingStageOne.current) return
    loadingMissingStageOne.current = true
    const currentSession = researchSession
    const missingIndex = activeStage.caseIndex === 0 ? 1 : 0
    const missingCase = GAME_CASES[missingIndex]
    async function loadMissingStageOneCase() {
      try {
        const playerCase = await getPlayerCase(missingCase.caseId)
        const stageRun = await startStageRun(currentSession.id, missingCase.caseId)
        setStageOneCases((current) => current.some((item) => item.playerCase.case_id === playerCase.case_id) ? current : [...current, { caseIndex: missingIndex, playerCase, stageRun }].sort((a, b) => a.caseIndex - b.caseIndex))
      } catch (error) {
        setStageError(error instanceof Error ? error.message : 'The Stage 1 scenarios could not be loaded.')
      } finally { loadingMissingStageOne.current = false }
    }
    void loadMissingStageOneCase()
  }, [activeStage, researchSession, stageOneCases.length])

  useEffect(() => {
    if (researchSession === null || activeStage === null || activeStage.playerCase.stage !== 'stage2' || stageTwoCases.length >= 2 || loadingMissingStageTwo.current) return
    loadingMissingStageTwo.current = true
    const currentSession = researchSession
    const missingIndex = activeStage.caseIndex === 2 ? 3 : 2
    const missingCase = GAME_CASES[missingIndex]
    async function loadMissingStageTwoCase() {
      try {
        const playerCase = await getPlayerCase(missingCase.caseId)
        const stageRun = await startStageRun(currentSession.id, missingCase.caseId)
        setStageTwoCases((current) => current.some((item) => item.playerCase.case_id === playerCase.case_id) ? current : [...current, { caseIndex: missingIndex, playerCase, stageRun }].sort((a, b) => a.caseIndex - b.caseIndex))
      } catch (error) {
        setStageError(error instanceof Error ? error.message : 'The Stage 2 experiments could not be restored.')
      } finally { loadingMissingStageTwo.current = false }
    }
    void loadMissingStageTwoCase()
  }, [activeStage, researchSession, stageTwoCases.length])

  useEffect(() => {
    if (researchSession === null || activeStage === null || activeStage.playerCase.stage !== 'stage3' || stageThreeCases.length >= 2 || loadingMissingStageThree.current) return
    loadingMissingStageThree.current = true
    const currentSession = researchSession
    const missingIndex = activeStage.caseIndex === 4 ? 5 : 4
    const missingCase = GAME_CASES[missingIndex]
    async function loadMissingStageThreeCase() {
      try {
        const playerCase = await getPlayerCase(missingCase.caseId)
        const stageRun = await startStageRun(currentSession.id, missingCase.caseId)
        setStageThreeCases((current) => current.some((item) => item.playerCase.case_id === playerCase.case_id) ? current : [...current, { caseIndex: missingIndex, playerCase, stageRun }].sort((a, b) => a.caseIndex - b.caseIndex))
      } catch (error) {
        setStageError(error instanceof Error ? error.message : 'The Repair Investigation cases could not be restored.')
      } finally { loadingMissingStageThree.current = false }
    }
    void loadMissingStageThreeCase()
  }, [activeStage, researchSession, stageThreeCases.length])

  useEffect(() => {
    if (researchSession === null || activeStage === null || activeStage.playerCase.stage !== 'transfer' || activeStage.playerCase.case_id === 'complex-transfer-icecream' || transferCases.length >= 2 || loadingMissingTransfer.current) return
    loadingMissingTransfer.current = true
    const currentSession = researchSession
    const missingIndex = activeStage.caseIndex === 6 ? 7 : 6
    const missingCase = GAME_CASES[missingIndex]
    async function loadMissingTransferCase() {
      try {
        const playerCase = await getPlayerCase(missingCase.caseId)
        const stageRun = await startStageRun(currentSession.id, missingCase.caseId)
        setTransferCases((current) => current.some((item) => item.playerCase.case_id === playerCase.case_id) ? current : [...current, { caseIndex: missingIndex, playerCase, stageRun }].sort((a, b) => a.caseIndex - b.caseIndex))
      } catch (error) { setStageError(error instanceof Error ? error.message : 'The Transfer cases could not be restored.') }
      finally { loadingMissingTransfer.current = false }
    }
    void loadMissingTransferCase()
  }, [activeStage, researchSession, transferCases.length])

  useEffect(() => {
    if (researchSession === null || activeStage?.playerCase.case_id !== 'complex-transfer-icecream' || complexTransferRun !== null || loadingMissingTransfer.current) return
    loadingMissingTransfer.current = true
    initializeComplexTransfer(researchSession.id)
      .then(async (run) => {
        setComplexTransferRun(run)
        setComplexTransferReflection(run.finished ? await getComplexTransferReflection(run.stage_run_id) : null)
      })
      .catch((error: unknown) => setStageError(error instanceof Error ? error.message : 'Complex Transfer could not be restored.'))
      .finally(() => { loadingMissingTransfer.current = false })
  }, [activeStage, complexTransferRun, researchSession])

  async function startAnonymousSession() {
    if (!consentConfirmed || isStarting) {
      return
    }
    setIsStarting(true)
    setStartError(null)

    try {
      let activeParticipant = participant
      if (activeParticipant === null) {
        activeParticipant = await createParticipant({
          participant_code: newParticipantCode(),
        })
        setParticipant(activeParticipant)
      }
      const session = await createSession({
        participant_id: activeParticipant.id,
        game_version: GAME_VERSION,
        study_phase: STUDY_PHASE,
        consent_version: CONSENT_VERSION,
        consent_confirmed: true,
      })
      setResearchSession(session)
      navigate(APP_PATHS.guidedDiscovery)
    } catch (error) {
      setStartError(
        error instanceof Error
          ? error.message
          : 'The game session could not be started.',
      )
    } finally {
      setIsStarting(false)
    }
  }

  async function beginFirstStage() {
    if (researchSession === null || isLoadingStage) {
      return
    }
    setIsLoadingStage(true)
    setStageError(null)
    try {
      const definitions = GAME_CASES.slice(0, 2)
      const cases: ActiveStage[] = []
      for (const [caseIndex, definition] of definitions.entries()) {
        const playerCase = await getPlayerCase(definition.caseId)
        const stageRun = await startStageRun(researchSession.id, definition.caseId)
        cases.push({ caseIndex, playerCase, stageRun })
      }
      setStageOneCases(cases)
      setActiveStage(cases[0])
    } catch (error) {
      setStageError(
        error instanceof Error ? error.message : 'Stage 1 could not be started.',
      )
    } finally {
      setIsLoadingStage(false)
    }
  }

  function finishStageOne(completedCases: ActiveStage[], summaries: StageOneSummary[]) {
    setStageOneCases(completedCases)
    setStageOneSummaries(summaries)
    setActiveStage(completedCases[1])
  }

  async function beginStageTwo() {
    if (researchSession === null || isLoadingStage) return
    setIsLoadingStage(true)
    setStageError(null)
    try {
      const definitions = GAME_CASES.slice(2, 4)
      const cases: ActiveStage[] = []
      for (const [index, definition] of definitions.entries()) {
        const playerCase = await getPlayerCase(definition.caseId)
        const stageRun = await startStageRun(researchSession.id, definition.caseId)
        cases.push({ caseIndex: index + 2, playerCase, stageRun })
      }
      setStageTwoCases(cases)
      setActiveStage(cases[0])
    } catch (error) {
      setStageError(error instanceof Error ? error.message : 'Stage 2 could not be started.')
    } finally {
      setIsLoadingStage(false)
    }
  }

  function finishStageTwo(completedCases: ActiveStage[]) {
    setStageTwoCases(completedCases)
    setActiveStage(completedCases[1])
  }

  async function beginStageThree() {
    if (researchSession === null || isLoadingStage) return
    setIsLoadingStage(true); setStageError(null)
    try {
      const cases: ActiveStage[] = []
      for (const [index, definition] of GAME_CASES.slice(4, 6).entries()) {
        const playerCase = await getPlayerCase(definition.caseId)
        const stageRun = await startStageRun(researchSession.id, definition.caseId)
        cases.push({ caseIndex: index + 4, playerCase, stageRun })
      }
      setStageThreeCases(cases); setActiveStage(cases[0])
    } catch (error) {
      setStageError(error instanceof Error ? error.message : 'Repair Investigation could not be started.')
    } finally { setIsLoadingStage(false) }
  }

  function finishStageThree(completedCases: ActiveStage[]) {
    setStageThreeCases(completedCases)
    setActiveStage(completedCases[1])
  }

  async function beginTransfer() {
    if (researchSession === null || isLoadingStage) return
    setIsLoadingStage(true); setStageError(null)
    try {
      const run = await initializeComplexTransfer(researchSession.id)
      const reflection = run.finished ? await getComplexTransferReflection(run.stage_run_id) : null
      const active: ActiveStage = {
        caseIndex: 6,
        playerCase: {
          case_id: 'complex-transfer-icecream', stage: 'transfer', subject: 'ice cream', attack_type: 'complex', interaction_mode: 'runtime_complex_transfer', correct_label: run.expected_class,
          initial_state_id: 'T0', initial_image_url: run.image_url, original_image_url: run.original_image_url, initial_top1: run.current_top1,
          parameter_rules: [], max_attempts: run.max_attempts, available_states: [],
        },
        stageRun: {
          id: run.stage_run_id, session_id: researchSession.id, case_id: 'complex-transfer-icecream', stage: 'transfer', attack_type: 'complex', completion_status: 'in_progress',
          success: run.success, attempt_count: run.attempt_index, used_hint: false, fallback_shown: false, initial_top1_label: run.current_top1.label,
          final_top1_label: null, classification_restored: run.success, started_at: new Date().toISOString(), completed_at: null,
        },
      }
      setComplexTransferRun(run); setComplexTransferReflection(reflection); setTransferCases([]); setActiveStage(active)
    } catch (error) { setStageError(error instanceof Error ? error.message : 'Transfer could not be started.') }
    finally { setIsLoadingStage(false) }
  }

  function complexParameters(value: ComplexTransferApiParameters): ComplexTransferParameters {
    return { patch: { size: value.patch.size_fraction, positionX: value.patch.position_x, positionY: value.patch.position_y }, pixelStrength: value.pixel_strength, blurLevel: value.blur_level }
  }

  function apiComplexParameters(value: ComplexTransferParameters): ComplexTransferApiParameters {
    return { patch: { size_fraction: value.patch.size, position_x: value.patch.positionX, position_y: value.patch.positionY }, pixel_strength: value.pixelStrength, blur_level: value.blurLevel }
  }

  async function previewComplexManipulation(manipulation: ComplexTransferManipulation): Promise<string> {
    if (!complexTransferRun) throw new Error('Complex Transfer is not initialized.')
    const preview = await previewComplexTransfer(complexTransferRun.stage_run_id, manipulation.selectedFactor, apiComplexParameters(manipulation.afterParameters))
    return `${resolveApiUrl(preview.image_url)}?v=${Date.now()}`
  }

  async function runComplexReclassification(manipulation: ComplexTransferManipulation, plan: ComplexTransferPlan) {
    if (!complexTransferRun || !researchSession) throw new Error('Complex Transfer is not initialized.')
    const action = await reclassifyComplexTransfer(complexTransferRun.stage_run_id, {
      selected_factor: manipulation.selectedFactor,
      parameters: apiComplexParameters(manipulation.afterParameters),
      prediction: plan.prediction,
      ...(plan.reason ? { prediction_reason: plan.reason } : {}),
    })
    let authoritativeRun: ComplexTransferRun = {
      ...complexTransferRun,
      image_url: action.image_url,
      current_top1: action.after_top1,
      current_parameters: action.after_parameters,
      attempt_index: action.attempt_index,
      remaining_attempts: action.remaining_attempts,
      success: action.classification_restored,
    }
    const finished = action.classification_restored || action.remaining_attempts === 0
    if (finished) {
      const refreshed = await initializeComplexTransfer(researchSession.id)
      if (refreshed.stage_run_id !== complexTransferRun.stage_run_id) {
        throw new Error('The completed Complex Transfer StageRun could not be restored.')
      }
      authoritativeRun = refreshed
      setComplexTransferReflection(await getComplexTransferReflection(refreshed.stage_run_id))
    }
    setComplexTransferRun(authoritativeRun)
    setActiveStage((current) => current?.playerCase.case_id === 'complex-transfer-icecream' ? {
      ...current,
      stageRun: {
        ...current.stageRun,
        attempt_count: action.attempt_index,
        final_top1_label: action.after_top1.label,
        completion_status: finished ? 'completed' : current.stageRun.completion_status,
        success: action.classification_restored,
        classification_restored: action.classification_restored,
      },
    } : current)
    return {
      imageUrl: resolveApiUrl(action.image_url),
      beforePrediction: action.before_top1,
      prediction: action.after_top1,
      classificationRestored: action.classification_restored,
      attemptIndex: action.attempt_index,
      remainingAttempts: action.remaining_attempts,
      finished,
      attemptHistory: authoritativeRun.attempts,
      initialClassification: authoritativeRun.initial_top1_label,
      maxAttempts: authoritativeRun.max_attempts,
    }
  }

  async function refreshComplexTransferForNextAttempt() {
    if (!researchSession || !complexTransferRun) throw new Error('Complex Transfer is not initialized.')
    const refreshed = await initializeComplexTransfer(researchSession.id)
    if (refreshed.stage_run_id !== complexTransferRun.stage_run_id) {
      throw new Error('The current Complex Transfer StageRun could not be restored.')
    }
    setComplexTransferRun(refreshed)
  }

  async function submitComplexTransferReflection(answers: { learningReflection: string; newErrorStrategy: string }) {
    if (!complexTransferRun) throw new Error('Complex Transfer is not initialized.')
    const saved = await saveComplexTransferReflection(complexTransferRun.stage_run_id, {
      learning_reflection: answers.learningReflection,
      new_error_strategy: answers.newErrorStrategy,
    })
    setComplexTransferReflection(saved)
  }

  async function viewInvestigatorReport() {
    if (!researchSession) return
    const completed = researchSession.completion_status === 'completed'
      ? researchSession
      : await completeResearchSession(researchSession.id)
    setResearchSession(completed)
    setShowReport(true)
  }

  function beginRequestedStage() {
    if (requestedStage === 1) void beginFirstStage()
    else if (requestedStage === 2) void beginStageTwo()
    else if (requestedStage === 3) void beginStageThree()
    else void beginTransfer()
  }

  const requestedStageCopy = requestedStage === 1 ? {
    title: 'You are ready for Tutorial',
    note: 'Begin with four fixed investigations and observe the different classification results.',
    button: 'Continue to Tutorial',
  } : requestedStage === 2 ? {
    title: 'You are ready for Condition Training',
    note: 'Compare controlled Patch and Pixel parameter settings and observe different classification outcomes.',
    button: 'Continue to Condition Training',
  } : requestedStage === 3 ? {
    title: 'You are ready for Repair Investigation',
    note: 'Form repair hypotheses and test them against real classifier evidence.',
    button: 'Continue to Repair Investigation',
  } : {
    title: 'Transfer works best after the earlier stages',
    note: 'We recommend completing Tutorial, Condition Training, and Repair Investigation first. You can still open Transfer now if you want to test the investigation process directly.',
    button: 'Continue to Transfer',
  }

  return (
    <main className="app-shell">
      <AppHeader onHome={returnHome} />

      {location.pathname === APP_PATHS.agreement ? (
        <section className="home-page" aria-labelledby="welcome-title">
          <div className="home-hero">
            <div className="welcome-copy">
              <p className="eyebrow"><Search size={16} /> Interactive learning investigation</p>
              <h1 id="welcome-title">Enter the garden.<br /><span>Investigate the evidence.</span></h1>
              <p className="welcome-introduction">Plan image modifications, predict before every result, compare classifier evidence, and revise your hypotheses without turning one case into a universal rule.</p>
              <div className="learning-progression"><Compass size={24} /><span><strong>Three-stage learning progression</strong><small>Tutorial → controlled condition comparison → independent repair investigation → transfer and boundary reasoning.</small></span></div>
              <a className="primary-button home-start-link" href="#participation-agreement">Begin investigation <ArrowRight size={18} /></a>
            </div>
            <div className="garden-map" aria-label="Learning journey map"><div className="garden-sky">☀️</div><div className="garden-path" /><div className="garden-stop garden-stop--one"><span>01</span><b>🌿</b><strong>Tutorial Hedge</strong></div><div className="garden-stop garden-stop--two"><span>02</span><b>⛲</b><strong>Condition Fountain</strong></div><div className="garden-stop garden-stop--three"><span>03</span><b>🏛️</b><strong>Repair Glasshouse</strong></div></div>
          </div>
          <section className="stage-overview" aria-labelledby="stage-overview-title"><p className="eyebrow">Choose a stage</p><h2 id="stage-overview-title">Follow the learning journey</h2><div className="home-stage-grid">
            <button type="button" onClick={() => chooseHomeStage(1)}><span>01</span><Leaf /><h3>Tutorial</h3><p>Learn that a modification may change the AI's main classification judgement — or may not.</p><strong>Open stage <ArrowRight size={16} /></strong></button>
            <button type="button" onClick={() => chooseHomeStage(2)}><span>02</span><FlaskConical /><h3>Condition Training</h3><p>Explore how parameters of the same modification can produce different outcomes.</p><strong>Open stage <ArrowRight size={16} /></strong></button>
            <button type="button" onClick={() => chooseHomeStage(3)}><span>03</span><Search /><h3>Repair Investigation</h3><p>Form a repair hypothesis, make one controlled adjustment, and compare evidence.</p><strong>Open stage <ArrowRight size={16} /></strong></button>
            <button type="button" onClick={() => chooseHomeStage(4)}><span>04</span><Compass /><h3>Transfer</h3><p>Apply the investigation process to a new image. Earlier stages are recommended first.</p><strong>Open stage <ArrowRight size={16} /></strong></button>
          </div></section>
          {researchSession === null ? <div className="consent-card" id="participation-agreement"><p className="step-label">Before you begin</p><h2>Participation agreement</h2><p>Please confirm that you have read the participant information and agree to take part in this formative evaluation.</p><ul className="study-summary" aria-label="Participation information"><li><ShieldCheck size={17} /> No name or email is requested.</li><li><ShieldCheck size={17} /> Your choices, parameters, predictions, and answers are recorded.</li><li><ShieldCheck size={17} /> You can stop the activity at any time.</li></ul><label className="consent-control"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} /><span>I have read the information and agree to participate.</span></label>{startError ? <p className="error-message" role="alert">{startError}</p> : null}<button className="primary-button" type="button" disabled={!consentConfirmed || isStarting} onClick={() => void startAnonymousSession()}>{isStarting ? 'Preparing your session…' : 'Start the activity'}</button></div> : <div className="home-session-notice"><ShieldCheck size={22} /><div><strong>Anonymous session active</strong><p>Choose Tutorial, Condition Training, or Repair Investigation above.</p></div></div>}
        </section>
      ) : showReport && researchSession !== null ? (
        <InvestigatorReport sessionId={researchSession.id} onHome={() => { setShowReport(false); returnHome() }} />
      ) : activeStage !== null ? (
        <StageShell activeStage={activeStage}>
          {activeStage.playerCase.stage === 'stage1' ? stageOneCases.length < 2 ? <p className="loading-message">Loading all four Stage 1 scenarios…</p> : <StageOneFlow
            cases={stageOneCases}
            isMovingNext={isLoadingStage}
            nextError={stageError}
            priorSummaries={stageOneSummaries}
            onStageComplete={finishStageOne}
            onContinue={() => void beginStageTwo()}
          /> : activeStage.playerCase.stage === 'stage2' ? stageTwoCases.length < 2 ? <p className="loading-message">Loading both Condition Investigation experiments…</p> : <StageTwoFlow cases={stageTwoCases} nextError={stageError} onStageComplete={finishStageTwo} onContinue={() => void beginStageThree()} isMovingNext={isLoadingStage} /> : activeStage.playerCase.stage === 'stage3' ? stageThreeCases.length < 2 ? <p className="loading-message">Loading both Repair Investigation cases…</p> : <RepairInvestigationFlow cases={stageThreeCases} nextError={stageError} onStageComplete={finishStageThree} onContinue={() => void beginTransfer()} isMovingNext={isLoadingStage} /> : complexTransferRun && (!complexTransferRun.finished || complexTransferReflection !== null) ? <ComplexTransferFlow imageUrl={resolveApiUrl(complexTransferRun.image_url)} originalImageUrl={resolveApiUrl(complexTransferRun.original_image_url ?? complexTransferRun.image_url)} subject="ice cream" currentPrediction={complexTransferRun.current_top1} attemptIndex={complexTransferRun.attempt_index} maxAttempts={complexTransferRun.max_attempts} initialClassification={complexTransferRun.initial_top1_label} attemptHistory={complexTransferRun.attempts} runFinished={complexTransferRun.finished} runSuccess={complexTransferRun.success} referenceParameters={complexParameters(complexTransferRun.reference_recoverable_parameters)} referenceTop1Label={complexTransferRun.reference_top1_label} currentParameters={complexParameters(complexTransferRun.current_parameters)} onPlanConfirmed={() => undefined} onPreview={previewComplexManipulation} onReclassify={runComplexReclassification} onDecideNext={refreshComplexTransferForNextAttempt} reflectionCompleted={complexTransferReflection?.completed ?? false} onSubmitReflection={submitComplexTransferReflection} onViewReport={viewInvestigatorReport} /> : <p className="loading-message">Loading Complex Transfer…</p>}
        </StageShell>
      ) : (
        <section className="session-ready" aria-labelledby="session-ready-title">
          <h1 id="session-ready-title">{requestedStageCopy.title}</h1>
          <div className="ready-check" aria-hidden="true">✓</div>
          <p className="next-step-note">
            {requestedStageCopy.note}
          </p>
          {stageError ? (
            <p className="error-message session-error" role="alert">
              {stageError}
            </p>
          ) : null}
          <button
            className="primary-button session-start-button"
            type="button"
            disabled={isLoadingStage}
            onClick={beginRequestedStage}
          >
            {isLoadingStage ? 'Loading stage…' : requestedStageCopy.button}
          </button>
        </section>
      )}
    </main>
  )
}

function App() {
  return <BrowserRouter><GameApplication /></BrowserRouter>
}

export default App
