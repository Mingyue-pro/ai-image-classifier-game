import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { InvestigationOrderTask } from './InvestigationOrderTask'

describe('InvestigationOrderTask', () => {
  test('records the first submitted order and completes after the six-step evidence cycle is arranged', async () => {
    const onComplete = vi.fn()
    const user = userEvent.setup()
    render(<InvestigationOrderTask onComplete={onComplete} />)

    await user.click(screen.getByRole('button', { name: 'Check order' }))
    expect(screen.getByText(/Some steps are out of order/)).toBeInTheDocument()

    const moves = [
      ['Move Observe the image and current classification up', 1],
      ['Move Predict a repair direction up', 3],
      ['Move Change one repair setting up', 3],
      ['Move Reclassify the modified image up', 2],
    ] as const
    for (const [name, times] of moves) for (let count = 0; count < times; count += 1) await user.click(screen.getByRole('button', { name }))
    await user.click(screen.getByRole('button', { name: 'Check order' }))

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      final_order: ['observe', 'predict', 'manipulate', 'reclassify', 'compare', 'decide'],
      order_attempts: 2,
      correct_on_first_try: false,
    }))
  })
})
