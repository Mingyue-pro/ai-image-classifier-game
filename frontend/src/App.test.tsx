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
    {
      state_id: 'patch-option-small',
      role: 'offline_option',
      image_url: '/game/cases/stage1-banana-patch/states/patch-option-small/image',
      parameters: { size_fraction: 0.1 },
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

const pixelCase = {
  ...playerCase,
  case_id: 'stage1-banana-pixel',
  attack_type: 'fgsm',
  initial_state_id: 'pixel-baseline',
  initial_image_url: '/game/cases/stage1-banana-pixel/states/pixel-baseline/image',
  available_states: [
    {
      state_id: 'pixel-option',
      role: 'offline_option',
      image_url: '/game/cases/stage1-banana-pixel/states/pixel-option/image',
      parameters: { epsilon_pixels: 1 },
    },
    {
      state_id: 'pixel-option-weak',
      role: 'offline_option',
      image_url: '/game/cases/stage1-banana-pixel/states/pixel-option-weak/image',
      parameters: { epsilon_pixels: 0.5 },
    },
  ],
}

const fixedChoiceResult = {
  attempt_number: 1,
  image_url: '/game/cases/stage1-banana-patch/states/patch-option/image',
  top1: { label: 'toaster', probability: 0.8, class_index: 859 },
  top5: [{ label: 'toaster', probability: 0.8, class_index: 859 }],
  parameters: { size_fraction: 0.3 },
  classification_changed: true,
  correct_label_is_top1: false,
  classification_restored: false,
  attempts_remaining: null,
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
    window.history.replaceState({}, '', '/')
  })

  test('requires consent before the activity can start', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' })),
    )
    render(<App />)

    expect(window.location.pathname).toBe('/agreement')
    expect(screen.getByRole('heading', { name: /Enter the garden/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Follow the learning journey' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Participation agreement' })).toBeInTheDocument()
    expect(screen.getByText('No name or email is requested.')).toBeInTheDocument()
    expect(screen.getByText('Your choices, parameters, predictions, and answers are recorded.')).toBeInTheDocument()
    expect(screen.getByText('You can stop the activity at any time.')).toBeInTheDocument()

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
      await screen.findByRole('heading', { name: 'You are ready for Tutorial' }),
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe('/guided-discovery')

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
      await screen.findByRole('heading', { name: 'You are ready for Tutorial' }),
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
    const fetchMock = vi.fn().mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url.endsWith('/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }))
      }
      if (url.endsWith(`/game/cases/${playerCase.case_id}`)) {
        return Promise.resolve(jsonResponse(playerCase))
      }
      if (url.endsWith(`/game/cases/${pixelCase.case_id}`)) {
        return Promise.resolve(jsonResponse(pixelCase))
      }
      if (url.endsWith(`/research/sessions/${researchSession.id}/stage-runs`)) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { case_id?: string }
        return Promise.resolve(jsonResponse(body.case_id === pixelCase.case_id ? { ...stageRun, id: 'stage-run-2', case_id: pixelCase.case_id, attack_type: 'fgsm' } : stageRun, 201))
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'You are ready for Tutorial' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue to Tutorial' }))

    expect(
      await screen.findByRole('heading', { name: 'Investigate the banana image' }),
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe('/guided-discovery')
    expect(screen.getByText(/Complete four fixed investigations/)).toBeInTheDocument()
    expect(screen.getByText('Baseline classification')).toBeInTheDocument()
    expect(screen.getByText('Confidence 90.0%')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next: select a change' }))
    const patchButtons = screen.getAllByRole('button', { name: /Patch scenario/i })
    const pixelButtons = screen.getAllByRole('button', { name: /Pixel scenario/i })
    expect(patchButtons).toHaveLength(2)
    expect(pixelButtons).toHaveLength(2)
    expect([...patchButtons, ...pixelButtons].every((button) => button.hasAttribute('disabled') === false)).toBe(true)
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

  test('previews a fixed Patch before trusted reclassification', async () => {
    sessionStorage.setItem(
      GAME_PROGRESS_STORAGE_KEY,
      JSON.stringify({
        participant,
        researchSession,
        activeStage: { caseIndex: 0, playerCase, stageRun },
      }),
    )
    const completedPatchRun = {
      ...stageRun,
      completion_status: 'completed',
      attempt_count: 1,
      final_top1_label: 'toaster',
    }
    const pixelStageRun = {
      ...stageRun,
      id: 'stage-run-2',
      case_id: pixelCase.case_id,
      attack_type: 'fgsm',
    }
    const pixelChoiceResult = {
      ...fixedChoiceResult,
      image_url: pixelCase.available_states[0].image_url,
      top1: { label: 'sweatshirt', probability: 0.7, class_index: 841 },
      top5: [{ label: 'sweatshirt', probability: 0.7, class_index: 841 }],
      parameters: { epsilon_pixels: 1 },
    }
    const completedPixelRun = {
      ...pixelStageRun,
      completion_status: 'completed',
      attempt_count: 1,
      final_top1_label: 'sweatshirt',
    }
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = input.toString()
      if (url.endsWith('/health')) return Promise.resolve(jsonResponse({ status: 'ok' }))
      if (url.endsWith(`/game/stage-runs/${stageRun.id}/apply-choice`)) {
        return Promise.resolve(jsonResponse(fixedChoiceResult, 201))
      }
      if (url.endsWith(`/research/stage-runs/${stageRun.id}/responses`)) {
        return Promise.resolve(jsonResponse({ id: 'response-1' }, 201))
      }
      if (url.endsWith(`/research/stage-runs/${stageRun.id}`)) {
        return Promise.resolve(jsonResponse(completedPatchRun))
      }
      if (url.endsWith(`/game/cases/${pixelCase.case_id}`)) {
        return Promise.resolve(jsonResponse(pixelCase))
      }
      if (url.endsWith(`/game/stage-runs/${pixelStageRun.id}/apply-choice`)) {
        return Promise.resolve(jsonResponse(pixelChoiceResult, 201))
      }
      if (url.endsWith(`/research/stage-runs/${pixelStageRun.id}/responses`)) {
        return Promise.resolve(jsonResponse({ id: 'response-2' }, 201))
      }
      if (url.endsWith(`/research/stage-runs/${pixelStageRun.id}`)) {
        return Promise.resolve(jsonResponse(completedPixelRun))
      }
      if (url.endsWith(`/research/sessions/${researchSession.id}/stage-runs`)) {
        return Promise.resolve(jsonResponse(pixelStageRun, 201))
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Next: select a change' }))
    await user.click(
      screen.getByRole('button', {
        name: /Patch scenario.*Size 30%/i,
      }),
    )
    await user.click(
      screen.getByRole('radio', {
        name: 'Top-1 will change',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Lock prediction and continue' }))

    expect(fetchMock.mock.calls.some(([url]) =>
      url.toString().endsWith(`/game/stage-runs/${stageRun.id}/apply-choice`),
    )).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Apply change' }))
    expect(screen.getByAltText('Modified banana preview')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) =>
      url.toString().endsWith(`/game/stage-runs/${stageRun.id}/apply-choice`),
    )).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Continue to Reclassify' }))
    await user.click(screen.getByRole('button', { name: 'Continue to Compare' }))
    expect(screen.getByText(/Reclassify the image first/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reclassify image' }))

    expect(await screen.findByRole('heading', { name: 'New classification result' })).toBeInTheDocument()
    expect(await screen.findByText('toaster')).toBeInTheDocument()
    expect(screen.queryByText(/Prediction correct/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue to Compare' }))
    expect(screen.getByText(/Prediction correct/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Return to Select Change' }))
    await user.click(screen.getByRole('button', { name: /Pixel scenario.*Strength 1\/255/i }))
    await user.click(screen.getByRole('radio', { name: 'Top-1 will change' }))
    await user.click(screen.getByRole('button', { name: 'Lock prediction and continue' }))
    await user.click(screen.getByRole('button', { name: 'Apply change' }))

    expect(screen.getByRole('region', { name: 'Pixel Inspector for banana' })).toBeInTheDocument()
    expect(screen.getByLabelText('Original 32 by 32 Pixel crop')).toBeInTheDocument()
    expect(screen.getByLabelText('Modified 32 by 32 Pixel crop')).toBeInTheDocument()
    expect(screen.getByLabelText('Enhanced difference 32 by 32 Pixel crop')).toBeInTheDocument()
    expect(screen.getByText(/for visual inspection only/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue to Reclassify' }))
    expect(screen.getByRole('button', { name: 'Reclassify image' })).toBeEnabled()
  })
})
