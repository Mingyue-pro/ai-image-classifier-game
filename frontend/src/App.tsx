import { useEffect, useState } from 'react'

import {
  createParticipant,
  createSession,
  getHealth,
  getPlayerCase,
  startStageRun,
} from './api'
import { StageShell } from './components/StageShell'
import { GAME_CASES } from './gameConfig'
import { loadGameProgress, saveGameProgress } from './sessionStorage'
import type { ActiveStage, Participant, ResearchSession } from './types'
import './App.css'


const GAME_VERSION = 'mvp-formative-1'
const STUDY_PHASE = 'formative_1'
const CONSENT_VERSION = 'v1'

function newParticipantCode(): string {
  return `P-${crypto.randomUUID()}`
}

function App() {
  const [restoredProgress] = useState(loadGameProgress)
  const [backendStatus, setBackendStatus] = useState('Checking...')
  const [consentConfirmed, setConsentConfirmed] = useState(false)
  const [participant, setParticipant] = useState<Participant | null>(
    restoredProgress.participant,
  )
  const [researchSession, setResearchSession] =
    useState<ResearchSession | null>(restoredProgress.researchSession)
  const [activeStage, setActiveStage] = useState<ActiveStage | null>(
    restoredProgress.activeStage,
  )
  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [isLoadingStage, setIsLoadingStage] = useState(false)
  const [stageError, setStageError] = useState<string | null>(null)

  useEffect(() => {
    async function checkBackend() {
      try {
        const response = await getHealth()
        setBackendStatus(response.status)
      } catch {
        setBackendStatus('unavailable')
      }
    }

    void checkBackend()
  }, [])

  useEffect(() => {
    saveGameProgress({ participant, researchSession, activeStage })
  }, [participant, researchSession, activeStage])

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
    const firstCase = GAME_CASES[0]

    try {
      const playerCase = await getPlayerCase(firstCase.caseId)
      const stageRun = await startStageRun(researchSession.id, firstCase.caseId)
      setActiveStage({ caseIndex: 0, playerCase, stageRun })
    } catch (error) {
      setStageError(
        error instanceof Error ? error.message : 'Stage 1 could not be started.',
      )
    } finally {
      setIsLoadingStage(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="brand" href="#top" aria-label="AI Image Classifier Game home">
          <span className="brand-mark" aria-hidden="true">AI</span>
          <span>Image Classifier Lab</span>
        </a>
        <span className={`backend-status backend-status--${backendStatus}`}>
          Backend: {backendStatus}
        </span>
      </header>

      {activeStage !== null ? (
        <StageShell activeStage={activeStage} />
      ) : researchSession === null ? (
        <section className="welcome-panel" aria-labelledby="welcome-title">
          <div className="welcome-copy">
            <p className="eyebrow">Interactive learning study</p>
            <h1 id="welcome-title">Discover what changes an AI prediction</h1>
            <p className="welcome-introduction">
              Explore how small image changes can affect a ResNet-34 classifier.
              You will predict outcomes, adjust image conditions, compare results,
              and explain what you notice.
            </p>

            <ul className="study-summary" aria-label="Study summary">
              <li>No name or email is requested.</li>
              <li>Your choices, parameters, predictions, and answers are recorded.</li>
              <li>You can stop the activity at any time.</li>
            </ul>
          </div>

          <div className="consent-card">
            <p className="step-label">Before you begin</p>
            <h2>Participation agreement</h2>
            <p>
              Please confirm that you have read the participant information and
              agree to take part in this formative evaluation.
            </p>

            <label className="consent-control">
              <input
                type="checkbox"
                checked={consentConfirmed}
                onChange={(event) => setConsentConfirmed(event.target.checked)}
              />
              <span>I have read the information and agree to participate.</span>
            </label>

            {startError ? (
              <p className="error-message" role="alert">
                {startError}
              </p>
            ) : null}

            <button
              className="primary-button"
              type="button"
              disabled={!consentConfirmed || isStarting}
              onClick={() => void startAnonymousSession()}
            >
              {isStarting ? 'Preparing your session…' : 'Start the activity'}
            </button>
          </div>
        </section>
      ) : (
        <section className="session-ready" aria-labelledby="session-ready-title">
          <p className="eyebrow">Anonymous session created</p>
          <h1 id="session-ready-title">You are ready for Stage 1</h1>
          <p>
            Your responses can now be linked across the activity without asking
            for your name or email.
          </p>
          <div className="ready-check" aria-hidden="true">✓</div>
          <p className="next-step-note">
            Your first case introduces how a fixed image change can affect a prediction.
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
            onClick={() => void beginFirstStage()}
          >
            {isLoadingStage ? 'Loading Stage 1…' : 'Continue to Stage 1'}
          </button>
        </section>
      )}
    </main>
  )
}

export default App
