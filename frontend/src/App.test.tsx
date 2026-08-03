import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

import App from './App'
import { GAME_PROGRESS_STORAGE_KEY } from './sessionStorage'


const participant = {
  id: 'participant-1',
  participant_code: 'P-test-uuid',
  background: null,
  created_at: '2026-08-03T12:00:00Z',
}

const researchSession = {
  id: 'session-1',
  participant_id: participant.id,
  game_version: 'mvp-formative-1',
  study_phase: 'formative_1',
  completion_status: 'in_progress',
  consent_version: 'v1',
  consent_confirmed_at: '2026-08-03T12:00:01Z',
  started_at: '2026-08-03T12:00:01Z',
  completed_at: null,
}

const playerCase = {
  case_id: 'stage1-banana-patch',
  stage: 'stage1',
  subject: 'banana',
  attack_type: 'patch',
  interaction_mode: 'offline_choices',
  correct_label: 'banana',
  initial_state_id: 'baseline',
  initial_image_url: '/game/cases/stage1-banana-patch/states/baseline/image',
  initial_top1: { label: 'banana', probability: 0.9, class_index: 954 },
  parameter_rules: [],
  max_attempts: null,
  available_states: [
    {
      state_id: 'patch-option',
      role: 'offline_option',
      image_url: '/game/cases/stage1-banana-patch/states/patch-option/image',
      parameters: { size_fraction: 0.3 },
    },
  ],
}

const stageRun = {
  id: 'stage-run-1',
  session_id: researchSession.id,
  case_id: playerCase.case_id,
  stage: 'stage1',
  attack_type: 'patch',
  completion_status: 'in_progress',
  success: null,
  attempt_count: 0,
  used_hint: false,
  fallback_shown: false,
  initial_top1_label: 'banana',
  final_top1_label: null,
  classification_restored: null,
  started_at: '2026-08-03T12:01:00Z',
  completed_at: null,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installCryptoStub() {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' })
}

describe('App anonymous session onboarding', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('requires consent before the activity can start', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' })),
    )
    render(<App />)

    const startButton = screen.getByRole('button', { name: 'Start the activity' })
    expect(startButton).toBeDisabled()

    await userEvent.click(
      screen.getByRole('checkbox', {
        name: 'I have read the information and agree to participate.',
      }),
    )

    expect(startButton).toBeEnabled()
  })

  test('creates an anonymous participant and consented research session', async () => {
    installCryptoStub()
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = input.toString()
      if (url.endsWith('/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }))
      }
      if (url.endsWith('/research/participants')) {
        return Promise.resolve(jsonResponse(participant, 201))
      }
      if (url.endsWith('/research/sessions')) {
        return Promise.resolve(jsonResponse(researchSession, 201))
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<App />)

    await user.click(
      screen.getByRole('checkbox', {
        name: 'I have read the information and agree to participate.',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Start the activity' }))

    expect(
      await screen.findByRole('heading', { name: 'You are ready for Stage 1' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Backend: ok')).toBeInTheDocument()

    const participantCall = fetchMock.mock.calls.find(([url]) =>
      url.toString().endsWith('/research/participants'),
    )
    const sessionCall = fetchMock.mock.calls.find(([url]) =>
      url.toString().endsWith('/research/sessions'),
    )
    expect(participantCall?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ participant_code: 'P-test-uuid' }),
    })
    expect(sessionCall?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        participant_id: participant.id,
        game_version: 'mvp-formative-1',
        study_phase: 'formative_1',
        consent_version: 'v1',
        consent_confirmed: true,
      }),
    })
  })

  test('shows a server error and reuses the participant when retrying', async () => {
    installCryptoStub()
    let sessionRequestCount = 0
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = input.toString()
      if (url.endsWith('/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }))
      }
      if (url.endsWith('/research/participants')) {
        return Promise.resolve(jsonResponse(participant, 201))
      }
      if (url.endsWith('/research/sessions')) {
        sessionRequestCount += 1
        return Promise.resolve(
          sessionRequestCount === 1
            ? jsonResponse({ detail: 'Session could not be created' }, 500)
            : jsonResponse(researchSession, 201),
        )
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<App />)

    await user.click(
      screen.getByRole('checkbox', {
        name: 'I have read the information and agree to participate.',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Start the activity' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Session could not be created',
    )

    await user.click(screen.getByRole('button', { name: 'Start the activity' }))
    expect(
      await screen.findByRole('heading', { name: 'You are ready for Stage 1' }),
    ).toBeInTheDocument()
    const participantRequests = fetchMock.mock.calls.filter(([url]) =>
      url.toString().endsWith('/research/participants'),
    )
    expect(participantRequests).toHaveLength(1)
    expect(sessionRequestCount).toBe(2)
  })

  test('restores the session and starts the first configured Stage case', async () => {
    sessionStorage.setItem(
      GAME_PROGRESS_STORAGE_KEY,
      JSON.stringify({
        participant,
        researchSession,
        activeStage: null,
      }),
    )
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = input.toString()
      if (url.endsWith('/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }))
      }
      if (url.endsWith(`/game/cases/${playerCase.case_id}`)) {
        return Promise.resolve(jsonResponse(playerCase))
      }
      if (url.endsWith(`/research/sessions/${researchSession.id}/stage-runs`)) {
        return Promise.resolve(jsonResponse(stageRun, 201))
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'You are ready for Stage 1' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue to Stage 1' }))

    expect(
      await screen.findByRole('heading', { name: 'Investigate the banana image' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Case 1 of 8')).toBeInTheDocument()
    expect(screen.getByText('Initial model result')).toBeInTheDocument()
    expect(screen.getByText('banana')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([url]) =>
        url.toString().endsWith('/research/participants'),
      ),
    ).toBe(false)

    const saved = JSON.parse(
      sessionStorage.getItem(GAME_PROGRESS_STORAGE_KEY) ?? '{}',
    ) as { activeStage?: { stageRun?: { id?: string } } }
    expect(saved.activeStage?.stageRun?.id).toBe(stageRun.id)
  })

  test('shows unavailable when the health request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    render(<App />)

    expect(await screen.findByText('Backend: unavailable')).toBeInTheDocument()
  })
})
