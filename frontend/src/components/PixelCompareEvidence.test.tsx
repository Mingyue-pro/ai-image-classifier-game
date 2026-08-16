import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { PixelCompareEvidence } from './PixelCompareEvidence'


describe('PixelCompareEvidence', () => {
  test('shows the classified before and after strengths with a conditional restoration explanation', () => {
    render(<PixelCompareEvidence beforeImageUrl="before.png" beforeStrength={4} beforePrediction={{ label: 'flagpole', probability: 0.25, class_index: 1 }} afterImageUrl="after.png" afterStrength={1} afterPrediction={{ label: 'traffic light', probability: 0.58, class_index: 2 }} correctLabel="traffic light" subject="traffic light" classificationRestored revealOriginalStrength />)

    const comparison = screen.getByRole('region', { name: 'Pixel strength and classification comparison' })
    expect(screen.getByRole('img', { name: 'Original unmodified traffic light image' })).toHaveAttribute('src', 'before.png')
    expect(screen.getByRole('img', { name: 'Initial attacked traffic light image' })).toHaveAttribute('src', 'before.png')
    expect(screen.getByRole('img', { name: 'Repaired modified traffic light image' })).toHaveAttribute('src', 'after.png')
    expect(comparison).toHaveTextContent('Original · Correct referenceStrength: 0/255')
    expect(comparison).toHaveTextContent('Initial (attacked)Strength: 4/255')
    expect(comparison).toHaveTextContent('Repaired / ModifiedStrength: 1/255')
    expect(comparison).toHaveTextContent('flagpole')
    expect(comparison).toHaveTextContent('traffic light')
    expect(comparison).toHaveTextContent("In this case, the model's original classification returned.")
  })

  test('does not claim that reducing strength guarantees restoration', () => {
    render(<PixelCompareEvidence beforeImageUrl="before.png" beforeStrength={4} beforePrediction={{ label: 'flagpole', probability: 0.25, class_index: 1 }} afterImageUrl="after.png" afterStrength={2} afterPrediction={{ label: 'mailbox', probability: 0.4, class_index: 2 }} correctLabel="traffic light" subject="traffic light" classificationRestored={false} />)

    expect(screen.getByText(/lower strength is not a guaranteed fix/)).toBeInTheDocument()
    expect(screen.queryByText('Strength: 0/255')).not.toBeInTheDocument()
  })
})
