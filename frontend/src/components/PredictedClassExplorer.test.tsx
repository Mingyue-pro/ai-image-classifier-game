import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { PredictedClassExplorer } from './PredictedClassExplorer'


describe('PredictedClassExplorer', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('loads configured examples only after the participant expands it', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const expected = input.toString().includes('traffic%20light')
      return Promise.resolve(new Response(JSON.stringify(expected ? {
        label: 'traffic light',
        examples: [{
          image_url: '/game/predicted-classes/traffic%20light/examples/0/image',
          source: 'Test ImageNet source',
          alt: 'A traffic light at a road junction',
        }],
      } : {
        label: 'mailbox',
        examples: [{
          image_url: '/game/predicted-classes/mailbox/examples/0/image',
          source: 'Test ImageNet source',
          alt: 'A roadside mailbox',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<PredictedClassExplorer expectedLabel="traffic light" predictedLabel="mailbox" />)

    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(screen.getByText(/Explore the classification evidence/))

    expect(await screen.findByAltText('A traffic light at a road junction')).toBeInTheDocument()
    expect(await screen.findByAltText('A roadside mailbox')).toHaveAttribute(
      'src',
      'http://127.0.0.1:8000/game/predicted-classes/mailbox/examples/0/image',
    )
    expect(screen.getByLabelText('Expected class: traffic light')).toBeInTheDocument()
    expect(screen.getByLabelText('Model predicted: mailbox')).toBeInTheDocument()
    expect(screen.getAllByText('Source: Test ImageNet source')).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
