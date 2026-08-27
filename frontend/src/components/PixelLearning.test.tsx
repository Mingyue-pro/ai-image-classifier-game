import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { EnhancedDifferenceExplanation, PixelConceptNote, PixelLearningSummary, PixelReclassifyConnection, PixelStrengthHelp } from './PixelLearning'

describe('shared FIN-02 Pixel learning content', () => {
  test('keeps the Stage 1 introduction neutral before observation', () => {
    render(<PixelConceptNote variant="introduction" />)
    expect(screen.getByLabelText('About Pixel modification')).toHaveTextContent('many pixels—not just one pixel')
    expect(screen.queryByText(/difficult to notice/i)).not.toBeInTheDocument()
  })

  test('provides one full and one compact Strength explanation', () => {
    const { rerender } = render(<PixelStrengthHelp />)
    expect(screen.getByLabelText('What is Pixel Strength?')).toHaveTextContent('size of the changes made to the RGB values')
    expect(screen.getByLabelText('What is Pixel Strength?')).toHaveTextContent('brightness or saturation')
    expect(screen.getByLabelText('What is Pixel Strength?')).toHaveTextContent('increase or decrease different RGB values')

    rerender(<PixelStrengthHelp variant="compact" />)
    expect(screen.getByText('What is Pixel Strength?')).toBeInTheDocument()
    expect(screen.queryByText(/increase or decrease different RGB values/i)).not.toBeInTheDocument()
  })

  test('centralises reclassification, summary and Enhanced Difference guidance', () => {
    const { rerender } = render(<><PixelReclassifyConnection /><PixelLearningSummary /><EnhancedDifferenceExplanation /></>)
    expect(screen.getByLabelText('Why reclassify the image?')).toHaveTextContent('reclassification tests whether that change affected the AI’s prediction')
    expect(screen.getByLabelText('Why reclassify the image?')).not.toHaveTextContent('Finding RGB differences')
    expect(screen.getByText(/cannot be assumed/i)).toBeInTheDocument()
    expect(screen.getByText(/not the image sent to the classifier/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Enhanced difference colour guide')).toHaveTextContent('Black: No stored RGB difference')
    expect(screen.getByLabelText('Enhanced difference colour guide')).toHaveTextContent('Grey: R, G and B changed by similar amounts')
    expect(screen.getByLabelText('Enhanced difference colour guide')).toHaveTextContent('Coloured: The RGB channels changed by different amounts')
    expect(screen.getByText(/each change by 4.*128, 128, 128.*grey/i)).toBeInTheDocument()
    expect(screen.getByText(/Grey means equal channel changes—not no change/i)).toBeInTheDocument()

    rerender(<PixelReclassifyConnection context="after" />)
    expect(screen.getByLabelText('Compare RGB and classification evidence')).toHaveTextContent('Finding RGB differences does not prove that the classification changed.')
  })
})
