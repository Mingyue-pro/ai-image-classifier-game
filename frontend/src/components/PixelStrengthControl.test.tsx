import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { PixelStrengthControl } from './PixelStrengthControl'

describe('PixelStrengthControl', () => {
  test('explains Pixel modification without repeating a Current to New comparison above the tool', () => {
    render(<PixelStrengthControl values={[0, 1, 4]} value={1} currentValue={4} baselineUnlocked onChange={vi.fn()} />)

    expect(screen.getByLabelText('About Pixel modification')).toHaveTextContent('Many pixel values across the image are changed slightly—not just one pixel')
    expect(screen.getByLabelText('What is Pixel Strength?')).toHaveTextContent('size of the changes made to the RGB values')
    expect(screen.getByLabelText('What is Pixel Strength?')).toHaveTextContent('does not simply adjust one visual property such as brightness or saturation')
    expect(screen.queryByLabelText('Current strength 4/255, new strength 1/255')).not.toBeInTheDocument()
  })

  test('keeps the explanation visible and labels previously selected strengths without lock wording', () => {
    render(<PixelStrengthControl values={[0, 1, 4]} value={1} currentValue={4} initialValue={4} showExplanation={false} baselineUnlocked onChange={vi.fn()} />)

    expect(screen.getByLabelText('About Pixel modification')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Pixel strength' })).toBeInTheDocument()
    expect(screen.getByText('Initial value')).toBeInTheDocument()
    expect(screen.queryByText('Locked')).not.toBeInTheDocument()
  })

  test('keeps the unlocked 0/255 baseline selectable even if it was classified before', () => {
    const onChange = vi.fn()
    render(<PixelStrengthControl values={[0, 1, 4]} value={1} currentValue={0} baselineUnlocked onChange={onChange} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Pixel strength' }), { target: { value: '0' } })
    expect(onChange).toHaveBeenCalledWith(0)
    expect(screen.getByText('Remove')).toBeInTheDocument()
  })

  test('allows 0.5 as the first option when the list does not contain a zero baseline', () => {
    const onChange = vi.fn()
    render(<PixelStrengthControl values={[0.5, 1, 2, 4]} value={4} currentValue={4} initialValue={4} baselineUnlocked={false} onChange={onChange} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Pixel strength' }), { target: { value: '0' } })
    expect(onChange).toHaveBeenCalledWith(0.5)
    expect(screen.queryByText(/full range/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/unlock/i)).not.toBeInTheDocument()
  })

  test('uses collapsed Strength help without repeating the Pixel introduction in Stage 3 mode', () => {
    render(<PixelStrengthControl values={[0, 1, 4]} value={4} currentValue={4} learningMode="compact" baselineUnlocked={false} onChange={vi.fn()} />)

    expect(screen.queryByLabelText('About Pixel modification')).not.toBeInTheDocument()
    const help = screen.getByText('What is Pixel Strength?').closest('details')
    expect(help).not.toHaveAttribute('open')
  })
})
