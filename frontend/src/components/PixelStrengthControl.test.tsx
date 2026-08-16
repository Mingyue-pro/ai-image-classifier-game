import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { PixelStrengthControl } from './PixelStrengthControl'

describe('PixelStrengthControl', () => {
  test('explains Pixel modification without repeating a Current to New comparison above the tool', () => {
    render(<PixelStrengthControl values={[0, 1, 4]} value={1} currentValue={4} baselineUnlocked onChange={vi.fn()} />)

    expect(screen.getByLabelText('About Pixel modification')).toHaveTextContent('small adjustments to the RGB values')
    expect(screen.getByText(/1\/255 is a very small adjustment/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Current strength 4/255, new strength 1/255')).not.toBeInTheDocument()
  })

  test('keeps the explanation visible on later attempts and locks classified strengths', () => {
    render(<PixelStrengthControl values={[0, 1, 4]} value={1} currentValue={4} showExplanation={false} baselineUnlocked onChange={vi.fn()} />)

    expect(screen.getByLabelText('About Pixel modification')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Pixel strength' })).toBeInTheDocument()
    expect(screen.getByText('Locked')).toBeInTheDocument()
  })

  test('keeps the unlocked 0/255 baseline selectable even if it was classified before', () => {
    const onChange = vi.fn()
    render(<PixelStrengthControl values={[0, 1, 4]} value={1} currentValue={0} baselineUnlocked onChange={onChange} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Pixel strength' }), { target: { value: '0' } })
    expect(onChange).toHaveBeenCalledWith(0)
    expect(screen.getByText('Baseline')).toBeInTheDocument()
  })
})
