import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

import App from './App'


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

  test('shows unavailable when the health request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    render(<App />)

    expect(await screen.findByText('Backend: unavailable')).toBeInTheDocument()
  })
})
