import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import App from './App'


describe('App backend health status', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('shows the backend status returned by the health API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    expect(screen.getByText('Backend status: Checking...')).toBeInTheDocument()
    expect(await screen.findByText('Backend status: ok')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8000/health')
  })

  test('shows unavailable when the health request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    render(<App />)

    expect(
      await screen.findByText('Backend status: unavailable'),
    ).toBeInTheDocument()
  })
})
