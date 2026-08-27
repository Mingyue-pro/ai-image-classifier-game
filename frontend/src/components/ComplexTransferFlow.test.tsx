import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { ComplexTransferFlow } from './ComplexTransferFlow'
import type { ComplexTransferAttempt } from '../types'


const summaryAttempts: ComplexTransferAttempt[] = [
  {
    attempt_number: 1,
    selected_factor: 'blur',
    prediction: 'stay_same',
    before_parameters: { patch: { size_fraction: 0.3, position_x: 0.6, position_y: 0.2 }, pixel_strength: 4, blur_level: 'high' },
    after_parameters: { patch: { size_fraction: 0.3, position_x: 0.6, position_y: 0.2 }, pixel_strength: 4, blur_level: 'low' },
    before_classification: 'toaster',
    after_classification: 'toaster',
    classification_restored: false,
    timestamp: '2026-08-16T08:00:00Z',
  },
  {
    attempt_number: 2,
    selected_factor: 'pixel',
    prediction: 'restore_correct',
    before_parameters: { patch: { size_fraction: 0.3, position_x: 0.6, position_y: 0.2 }, pixel_strength: 4, blur_level: 'low' },
    after_parameters: { patch: { size_fraction: 0.3, position_x: 0.6, position_y: 0.2 }, pixel_strength: 0, blur_level: 'low' },
    before_classification: 'toaster',
    after_classification: 'ice cream',
    classification_restored: true,
    timestamp: '2026-08-16T08:01:00Z',
  },
]


test('shows neutral Observe evidence without revealing the three-factor case construction', async () => {
  const user = userEvent.setup()
  render(<ComplexTransferFlow imageUrl="/complex-transfer.png" subject="ice cream" currentPrediction={{ label: 'toaster', probability: 0.497349, class_index: 859 }} onPlanConfirmed={vi.fn()} />)

  expect(screen.getByText('The AI has classified this image incorrectly. Investigate what might be affecting the classification.')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'New Transfer image showing ice cream' })).toHaveAttribute('src', '/complex-transfer.png')
  expect(screen.getByRole('region', { name: 'Starting classification' })).toHaveTextContent('toaster')
  expect(screen.getByRole('region', { name: 'Starting classification' })).toHaveTextContent('True classice cream')
  expect(screen.getByRole('region', { name: 'Starting classification' })).toHaveTextContent("AI's current main classification judgementDoes not match true class")
  expect(screen.getByRole('region', { name: 'Starting classification' })).toHaveTextContent('Investigation limitUp to 5 valid attempts')
  expect(screen.queryByText(/Complex Transfer · Observe/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Patch \+ Pixel \+ Blur/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/three problems/i)).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Plan the first investigation' }))
  expect(screen.getByText('What would you like to investigate first?')).toBeInTheDocument()
  expect(screen.getByText(/Patch and Pixel were examples used for practice in Stage 3/)).toBeInTheDocument()
  expect(screen.getByText(/They are not required steps, and there is no fixed order/)).toBeInTheDocument()
})


test('records both choices while keeping the short reason optional', async () => {
  const user = userEvent.setup()
  const onPlanConfirmed = vi.fn()
  render(<ComplexTransferFlow imageUrl="/complex-transfer.png" subject="ice cream" currentPrediction={{ label: 'toaster', probability: 0.49, class_index: 859 }} onPlanConfirmed={onPlanConfirmed} />)
  await user.click(screen.getByRole('button', { name: 'Plan the first investigation' }))

  const submit = screen.getByRole('button', { name: 'Confirm plan' })
  expect(submit).toBeDisabled()
  expect(screen.getByRole('radio', { name: 'Patch' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Pixel-level modification' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Blur' })).toBeInTheDocument()
  expect(screen.getAllByRole('radio', { name: 'Not sure' })).toHaveLength(2)
  expect(screen.queryByText(/six steps/i)).not.toBeInTheDocument()

  await user.click(screen.getByRole('radio', { name: 'Blur' }))
  await user.click(screen.getByRole('radio', { name: 'The AI may stay the same' }))
  expect(submit).toBeEnabled()
  await user.click(submit)

  expect(onPlanConfirmed).toHaveBeenCalledWith({ selectedFactor: 'blur', prediction: 'stay_same', reason: null })
  expect(screen.getByRole('heading', { name: 'Adjust the blur' })).toBeInTheDocument()
  expect(screen.getByText('Please make a change before reclassifying.')).toBeInTheDocument()
})


test('records page visits and a factor-specific Manipulate duration without creating an Attempt', async () => {
  const user = userEvent.setup()
  const onTimingEvent = vi.fn()
  const onManipulationConfirmed = vi.fn()
  render(<ComplexTransferFlow
    imageUrl="/complex-transfer.png"
    subject="ice cream"
    currentPrediction={{ label: 'toaster', probability: 0.49, class_index: 859 }}
    onPlanConfirmed={vi.fn()}
    onManipulationConfirmed={onManipulationConfirmed}
    onTimingEvent={onTimingEvent}
  />)

  await user.click(screen.getByRole('button', { name: 'Plan the first investigation' }))
  await waitFor(() => expect(onTimingEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'complex_transfer_page_visit',
    eventData: expect.objectContaining({ page_key: 'observe', attempt_index: 0 }),
  })))

  await user.click(screen.getByRole('radio', { name: 'Pixel-level modification' }))
  await user.click(screen.getByRole('radio', { name: 'The AI may stay the same' }))
  await user.click(screen.getByRole('button', { name: 'Confirm plan' }))
  const pixelStrengthSlider = screen.getByRole('slider', { name: 'Transfer Pixel Strength' })
  expect(pixelStrengthSlider).toHaveAttribute('min', '0')
  expect(pixelStrengthSlider).toHaveAttribute('max', '4')
  expect(pixelStrengthSlider).toHaveValue('4')
  expect(pixelStrengthSlider).toHaveAttribute('aria-valuetext', '4/255')
  fireEvent.change(pixelStrengthSlider, { target: { value: '3' } })
  expect(pixelStrengthSlider).toHaveValue('3')
  expect(pixelStrengthSlider).toHaveAttribute('aria-valuetext', '2/255')
  await user.click(screen.getByRole('button', { name: 'Continue' }))

  await waitFor(() => expect(onTimingEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'complex_transfer_factor_duration',
    eventData: expect.objectContaining({
      page_key: 'manipulate',
      factor: 'pixel',
      attempt_index: 1,
      duration_scope: 'manipulate_page',
      active_duration_ms: expect.any(Number),
      elapsed_duration_ms: expect.any(Number),
    }),
  })))
  expect(onManipulationConfirmed).toHaveBeenCalledTimes(1)
})


test('preserves an optional short reason without imposing a minimum length', async () => {
  const user = userEvent.setup()
  const onPlanConfirmed = vi.fn()
  render(<ComplexTransferFlow imageUrl="/complex-transfer.png" subject="ice cream" currentPrediction={{ label: 'toaster', probability: 0.49, class_index: 859 }} onPlanConfirmed={onPlanConfirmed} />)
  await user.click(screen.getByRole('button', { name: 'Plan the first investigation' }))
  await user.click(screen.getAllByRole('radio', { name: 'Not sure' })[0])
  await user.click(screen.getByRole('radio', { name: 'The AI may return to the correct category' }))
  await user.type(screen.getByRole('textbox', { name: /Why do you want to test this first/ }), 'Blurred')
  await user.click(screen.getByRole('button', { name: 'Confirm plan' }))

  expect(onPlanConfirmed).toHaveBeenCalledWith({ selectedFactor: 'not_sure', prediction: 'restore_correct', reason: 'Blurred' })
  expect(screen.getByText('Choose one tool for this attempt')).toBeInTheDocument()
})


test('returns from Manipulate to a visible choice page when no in-memory Compare result exists', async () => {
  const user = userEvent.setup()
  render(<ComplexTransferFlow imageUrl="/attempt-2.png" subject="ice cream" attemptIndex={2} currentPrediction={{ label: 'toaster', probability: 0.49, class_index: 859 }} onPlanConfirmed={vi.fn()} />)

  await user.click(screen.getByRole('button', { name: 'Plan the first investigation' }))
  await user.click(screen.getByRole('radio', { name: 'Pixel-level modification' }))
  await user.click(screen.getByRole('radio', { name: 'The AI may stay the same' }))
  await user.click(screen.getByRole('button', { name: 'Confirm plan' }))
  await user.click(screen.getByRole('button', { name: 'Back to Choose' }))

  expect(screen.getByRole('heading', { name: 'Choose your investigation' })).toBeInTheDocument()
  expect(screen.getByText('What would you like to investigate first?')).toBeInTheDocument()
})


test('activates only Pixel and preserves the current Patch and Blur state', async () => {
  const user = userEvent.setup()
  const onManipulationConfirmed = vi.fn()
  render(<ComplexTransferFlow imageUrl="/complex-transfer.png" subject="ice cream" currentPrediction={{ label: 'toaster', probability: 0.49, class_index: 859 }} onPlanConfirmed={vi.fn()} onManipulationConfirmed={onManipulationConfirmed} />)
  await user.click(screen.getByRole('button', { name: 'Plan the first investigation' }))
  await user.click(screen.getByRole('radio', { name: 'Pixel-level modification' }))
  await user.click(screen.getByRole('radio', { name: 'The AI may change category, but I am not sure whether it will be correct' }))
  await user.click(screen.getByRole('button', { name: 'Confirm plan' }))

  expect(screen.getByText('Before · Current Cumulative State | Preview · Selected Strength').closest('.pixel-manipulate-layout')).toBeInTheDocument()
  expect(screen.queryByLabelText('About Pixel modification')).not.toBeInTheDocument()
  expect(screen.getByText('What is Pixel Strength?').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByText('Investigate the image and find a way to restore the correct classification.')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Current cumulative ice cream state with fixed 32 by 32 region' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: '32×32 Selected Region' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Select Pixel inspection region for ice cream')).not.toBeInTheDocument()
  expect(screen.getByText('Previous attempts / results')).toBeInTheDocument()
  expect(screen.queryByText('Use the evidence from your previous attempts to decide what to try next.')).not.toBeInTheDocument()
  expect(screen.queryByRole('slider', { name: 'Patch horizontal position' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Setting 8/i })).not.toBeInTheDocument()
  const continueButton = screen.getByRole('button', { name: 'Continue' })
  expect(continueButton).toBeDisabled()
  fireEvent.change(screen.getByRole('slider', { name: 'Transfer Pixel Strength' }), { target: { value: '3' } })
  expect(continueButton).toBeEnabled()
  await user.click(continueButton)

  expect(onManipulationConfirmed).toHaveBeenCalledWith({
    selectedFactor: 'pixel',
    beforeParameters: { patch: { size: 0.3, positionX: 0.75, positionY: 0.25 }, pixelStrength: 4, blurLevel: 'high' },
    afterParameters: { patch: { size: 0.3, positionX: 0.75, positionY: 0.25 }, pixelStrength: 2, blurLevel: 'high' },
  })
  expect(screen.getByRole('heading', { name: 'Image after manipulation' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Complex Transfer ice cream after manipulation' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'New classification' })).toHaveTextContent('Result hidden')
})


test('offers Patch position, size, or both without changing other factors', async () => {
  const user = userEvent.setup()
  const onManipulationConfirmed = vi.fn()
  render(<ComplexTransferFlow imageUrl="/complex-transfer.png" subject="ice cream" currentPrediction={{ label: 'toaster', probability: 0.49, class_index: 859 }} onPlanConfirmed={vi.fn()} onManipulationConfirmed={onManipulationConfirmed} />)
  await user.click(screen.getByRole('button', { name: 'Plan the first investigation' }))
  await user.click(screen.getByRole('radio', { name: 'Patch' }))
  await user.click(screen.getByRole('radio', { name: 'The AI may stay the same' }))
  await user.click(screen.getByRole('button', { name: 'Confirm plan' }))

  expect(screen.getByRole('slider', { name: 'Patch horizontal position' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '15%' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'Both' }))
  expect(screen.getByRole('button', { name: '15%' })).toBeInTheDocument()
  fireEvent.change(screen.getByRole('slider', { name: 'Patch horizontal position' }), { target: { value: '0.8' } })
  await user.click(screen.getByRole('button', { name: '15%' }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))

  expect(onManipulationConfirmed).toHaveBeenCalledWith(expect.objectContaining({
    selectedFactor: 'patch',
    afterParameters: { patch: { size: 0.15, positionX: 0.8, positionY: 0.25 }, pixelStrength: 4, blurLevel: 'high' },
  }))
})


test('uses the Phase 1 Gaussian Blur levels and requires a different level', async () => {
  const user = userEvent.setup()
  const onManipulationConfirmed = vi.fn()
  render(<ComplexTransferFlow imageUrl="/complex-transfer.png" subject="ice cream" currentPrediction={{ label: 'toaster', probability: 0.49, class_index: 859 }} onPlanConfirmed={vi.fn()} onManipulationConfirmed={onManipulationConfirmed} />)
  await user.click(screen.getByRole('button', { name: 'Plan the first investigation' }))
  await user.click(screen.getByRole('radio', { name: 'Blur' }))
  await user.click(screen.getAllByRole('radio', { name: 'Not sure' })[1])
  await user.click(screen.getByRole('button', { name: 'Confirm plan' }))

  expect(screen.getByRole('group', { name: 'Blur Strength' })).toBeInTheDocument()
  expect(screen.getByText(/Blur Strength controls how strongly and broadly neighbouring pixel values are blended/)).toBeInTheDocument()
  expect(screen.getByText('? What do the Blur values mean?').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByRole('button', { name: /High.*Setting 16/i })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /Medium.*Setting 8/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Low.*Setting 4/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /None.*Setting 0/i })).toBeInTheDocument()
  await user.click(screen.getByText('? What do the Blur values mean?'))
  expect(screen.getByText(/The values are not pixel counts or circular boundaries/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /Low.*Setting 4/i }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(onManipulationConfirmed).toHaveBeenCalledWith(expect.objectContaining({
    selectedFactor: 'blur',
    afterParameters: expect.objectContaining({ blurLevel: 'low' }),
  }))
})


test.each(['Patch', 'Blur'] as const)('shows previous Transfer attempts while manipulating %s', async (factor) => {
  const user = userEvent.setup()
  render(<ComplexTransferFlow
    imageUrl="/attempt-1.png"
    subject="mailbox"
    currentPrediction={{ label: 'punching bag', probability: 0.64, class_index: 747 }}
    attemptIndex={1}
    attemptHistory={[summaryAttempts[0]]}
    onPlanConfirmed={vi.fn()}
  />)

  await user.click(screen.getByRole('button', { name: 'Plan the first investigation' }))
  await user.click(screen.getByRole('radio', { name: factor }))
  await user.click(screen.getByRole('radio', { name: 'The AI may stay the same' }))
  await user.click(screen.getByRole('button', { name: 'Confirm plan' }))

  const history = screen.getByRole('region', { name: `Previous Transfer attempts and results for ${factor.toLowerCase()}` })
  expect(history).toHaveTextContent('Previous attempts / results')
  expect(history).toHaveTextContent('Attempt 1: Blur')
  expect(history).toHaveTextContent('Incorrect · toaster')
})


test('shows the new classification before the user continues to factual comparison evidence', async () => {
  const user = userEvent.setup()
  const onReclassify = vi.fn().mockResolvedValue({
    imageUrl: '/attempt-1.png',
    beforePrediction: { label: 'toaster', probability: 0.49, class_index: 859 },
    prediction: { label: 'eggnog', probability: 0.62, class_index: 442 },
    classificationRestored: false,
    attemptIndex: 1,
    remainingAttempts: 4,
  })
  render(<ComplexTransferFlow imageUrl="/complex-transfer.png" subject="ice cream" currentPrediction={{ label: 'toaster', probability: 0.49, class_index: 859 }} onPlanConfirmed={vi.fn()} onReclassify={onReclassify} onDecideNext={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: 'Plan the first investigation' }))
  await user.click(screen.getByRole('radio', { name: 'Blur' }))
  await user.click(screen.getByRole('radio', { name: 'The AI may change category, but I am not sure whether it will be correct' }))
  await user.click(screen.getByRole('button', { name: 'Confirm plan' }))
  await user.click(screen.getByRole('button', { name: /Low.*Setting 4/i }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(screen.getByRole('button', { name: 'Reclassify image' }))

  expect(await screen.findByRole('region', { name: 'New classification' })).toHaveTextContent('eggnog')
  expect(screen.queryByRole('heading', { name: 'Still incorrect' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByRole('heading', { name: 'Still incorrect' })).toBeInTheDocument()
  expect(onReclassify).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('region', { name: 'Before classification' })).toHaveTextContent('toaster')
  expect(screen.getByRole('region', { name: 'Before classification' })).toHaveTextContent('Blur StrengthHigh · Setting 16')
  expect(screen.getByRole('region', { name: 'After classification' })).toHaveTextContent('eggnog')
  expect(screen.getByRole('region', { name: 'After classification' })).toHaveTextContent('Blur Strength Modified factorLow · Setting 4')
  expect(screen.getByText('Remaining attempts').parentElement).toHaveTextContent('4')
  expect(screen.queryByText(/Patch is solved/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/Pixel no longer matters/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/remaining problem/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/You should now modify/i)).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Choose and predict the next adjustment' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Continue repair' }))
  expect(screen.getByRole('heading', { name: 'Choose and predict the next adjustment' })).toBeInTheDocument()
  expect(screen.getByText(/What would you like to investigate next?/)).toBeInTheDocument()
})


test('uses the refreshed backend state when a second Attempt changes another factor', async () => {
  const user = userEvent.setup()
  const onReclassify = vi.fn()
    .mockResolvedValueOnce({
      imageUrl: '/attempt-1.png',
      beforePrediction: { label: 'toaster', probability: 0.49, class_index: 859 },
      prediction: { label: 'toaster', probability: 0.86, class_index: 859 },
      classificationRestored: false,
      attemptIndex: 1,
      remainingAttempts: 4,
    })
    .mockResolvedValueOnce({
      imageUrl: '/attempt-2.png',
      beforePrediction: { label: 'toaster', probability: 0.86, class_index: 859 },
      prediction: { label: 'eggnog', probability: 0.55, class_index: 442 },
      classificationRestored: false,
      attemptIndex: 2,
      remainingAttempts: 3,
    })
  const onDecideNext = vi.fn().mockResolvedValue(undefined)
  const initialProps = {
    imageUrl: '/complex-transfer.png',
    subject: 'ice cream',
    currentPrediction: { label: 'toaster', probability: 0.49, class_index: 859 },
    currentParameters: { patch: { size: 0.3, positionX: 0.6, positionY: 0.2 }, pixelStrength: 4, blurLevel: 'high' as const },
    onPlanConfirmed: vi.fn(),
    onReclassify,
    onDecideNext,
  }
  const view = render(<ComplexTransferFlow {...initialProps} />)
  await user.click(screen.getByRole('button', { name: 'Plan the first investigation' }))
  await user.click(screen.getByRole('radio', { name: 'Blur' }))
  await user.click(screen.getByRole('radio', { name: 'The AI may stay the same' }))
  await user.click(screen.getByRole('button', { name: 'Confirm plan' }))
  await user.click(screen.getByRole('button', { name: /Low.*Setting 4/i }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(screen.getByRole('button', { name: 'Reclassify image' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('heading', { name: 'Still incorrect' })

  view.rerender(<ComplexTransferFlow {...initialProps} imageUrl="/attempt-1.png" attemptIndex={1} currentPrediction={{ label: 'toaster', probability: 0.86, class_index: 859 }} currentParameters={{ ...initialProps.currentParameters, blurLevel: 'low' }} />)
  await user.click(screen.getByRole('button', { name: 'Continue repair' }))
  await user.click(screen.getByRole('radio', { name: 'Pixel-level modification' }))
  await user.click(screen.getByRole('radio', { name: 'The AI may change category, but I am not sure whether it will be correct' }))
  await user.click(screen.getByRole('button', { name: 'Continue to Manipulate' }))
  expect(onDecideNext).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Blur: Low · Setting 4')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Back to Choose' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Back to Choose' }))
  expect(screen.getByRole('heading', { name: 'Choose and predict the next adjustment' })).toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'Pixel-level modification' }))
  await user.click(screen.getByRole('button', { name: 'Continue to Manipulate' }))
  fireEvent.change(screen.getByRole('slider', { name: 'Transfer Pixel Strength' }), { target: { value: '3' } })
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(screen.getByRole('button', { name: 'Reclassify image' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('Remaining attempts')
  const pixelInspector = screen.getByText('Inspect pixel-level differences').closest('details')
  expect(pixelInspector).not.toHaveAttribute('open')
  await user.click(screen.getByText('Inspect pixel-level differences'))
  expect(pixelInspector).toHaveAttribute('open')
  expect(screen.getByText('1. Pre-round cumulative state selected crop')).toBeInTheDocument()
  expect(screen.getByText('2. Post-round state selected crop')).toBeInTheDocument()
  expect(screen.getByText('Enhanced Difference · Same 8×8 Region')).toBeInTheDocument()
  expect(screen.queryByText('1. Original selected crop')).not.toBeInTheDocument()

  expect(onReclassify).toHaveBeenNthCalledWith(2, expect.objectContaining({
    selectedFactor: 'pixel',
    beforeParameters: expect.objectContaining({ blurLevel: 'low', pixelStrength: 4 }),
    afterParameters: expect.objectContaining({ blurLevel: 'low', pixelStrength: 2 }),
  }), expect.anything())
  expect(screen.getByText('Remaining attempts').parentElement).toHaveTextContent('3')
})


test('carries a previous Pixel change into the next Blur attempt', async () => {
  const user = userEvent.setup()
  const onManipulationConfirmed = vi.fn()
  const onReclassify = vi.fn().mockResolvedValue({
    imageUrl: '/attempt-1.png',
    beforePrediction: { label: 'punching bag', probability: 0.64, class_index: 747 },
    prediction: { label: 'punching bag', probability: 0.62, class_index: 747 },
    classificationRestored: false,
    attemptIndex: 1,
    remainingAttempts: 4,
  })
  const initialParameters = {
    patch: { size: 0.3, positionX: 0.75, positionY: 0.25 },
    pixelStrength: 4,
    blurLevel: 'high' as const,
  }
  const props = {
    imageUrl: '/complex-transfer.png',
    subject: 'mailbox',
    currentPrediction: { label: 'punching bag', probability: 0.64, class_index: 747 },
    currentParameters: initialParameters,
    onPlanConfirmed: vi.fn(),
    onManipulationConfirmed,
    onReclassify,
    onDecideNext: vi.fn().mockResolvedValue(undefined),
  }
  const view = render(<ComplexTransferFlow {...props} />)

  await user.click(screen.getByRole('button', { name: 'Plan the first investigation' }))
  await user.click(screen.getByRole('radio', { name: 'Pixel-level modification' }))
  await user.click(screen.getByRole('radio', { name: 'The AI may stay the same' }))
  await user.click(screen.getByRole('button', { name: 'Confirm plan' }))
  fireEvent.change(screen.getByRole('slider', { name: 'Transfer Pixel Strength' }), { target: { value: '3' } })
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(screen.getByRole('button', { name: 'Reclassify image' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))

  const cumulativeParameters = { ...initialParameters, pixelStrength: 2 }
  view.rerender(<ComplexTransferFlow {...props} imageUrl="/attempt-1.png" attemptIndex={1} currentParameters={cumulativeParameters} />)
  await user.click(screen.getByRole('button', { name: 'Continue repair' }))
  await user.click(screen.getByRole('radio', { name: 'Blur / image clarity' }))
  await user.click(screen.getByRole('radio', { name: 'The AI may stay the same' }))
  await user.click(screen.getByRole('button', { name: 'Continue to Manipulate' }))
  await user.click(screen.getByRole('button', { name: /Low.*Setting 4/i }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))

  expect(onManipulationConfirmed).toHaveBeenNthCalledWith(2, {
    selectedFactor: 'blur',
    beforeParameters: cumulativeParameters,
    afterParameters: { ...cumulativeParameters, blurLevel: 'low' },
  })
})


test('keeps the Reclassify step visible and reports a backend error', async () => {
  const user = userEvent.setup()
  const onReclassify = vi.fn().mockRejectedValue(
    new Error('Please make a change before reclassifying.'),
  )
  render(<ComplexTransferFlow imageUrl="/complex-transfer.png" subject="ice cream" currentPrediction={{ label: 'toaster', probability: 0.49, class_index: 859 }} onPlanConfirmed={vi.fn()} onReclassify={onReclassify} />)
  await user.click(screen.getByRole('button', { name: 'Plan the first investigation' }))
  await user.click(screen.getByRole('radio', { name: 'Blur' }))
  await user.click(screen.getByRole('radio', { name: 'The AI may stay the same' }))
  await user.click(screen.getByRole('button', { name: 'Confirm plan' }))
  await user.click(screen.getByRole('button', { name: /Low.*Setting 4/i }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(screen.getByRole('button', { name: 'Reclassify image' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Please make a change before reclassifying.',
  )
  expect(screen.getByRole('button', { name: 'Reclassify image' })).toBeEnabled()
  expect(screen.queryByRole('heading', { name: 'Still incorrect' })).not.toBeInTheDocument()
})


test('uses the two required Reflection questions after a successful run and completes without an Attempt', async () => {
  const user = userEvent.setup()
  const onSubmitReflection = vi.fn().mockResolvedValue(undefined)
  render(<ComplexTransferFlow
    imageUrl="/attempt-2.png"
    subject="ice cream"
    currentPrediction={{ label: 'ice cream', probability: 0.61, class_index: 928 }}
    attemptIndex={2}
    maxAttempts={5}
    initialClassification="toaster"
    attemptHistory={summaryAttempts}
    runFinished
    runSuccess
    onPlanConfirmed={vi.fn()}
    onSubmitReflection={onSubmitReflection}
  />)

  expect(screen.getByRole('heading', { name: 'Classification restored' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Transfer result' })).toHaveTextContent('toaster')
  expect(screen.getByRole('region', { name: 'Transfer result' })).toHaveTextContent('ice cream')
  expect(screen.getByRole('region', { name: 'Transfer result' })).toHaveTextContent('2 / 5')
  expect(screen.getByRole('heading', { name: 'Final repair parameters' }).parentElement).toHaveTextContent('Enabled · Size 30% · X 0.60 · Y 0.20')
  expect(screen.getByRole('heading', { name: 'Final repair parameters' }).parentElement).toHaveTextContent('0/255')
  expect(screen.getByRole('heading', { name: 'Final repair parameters' }).parentElement).toHaveTextContent('Low · Setting 4')
  expect(screen.getByRole('heading', { name: 'Final repair parameters' }).parentElement).toHaveTextContent('Final classificationice cream')
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText('Attempt 1 — Blur')).toBeInTheDocument()
  expect(screen.getByText('Attempt 2 — Pixel')).toBeInTheDocument()
  expect(screen.getByText(/associated with the classification returning in this case/i)).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'What would you like to investigate next?' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Reclassify image' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Continue to reflection' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Your final state vs one verified reference' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Continue to reflection' }))
  const q1 = screen.getByRole('textbox', { name: 'What did you learn from the results of your different attempts?' })
  const q2 = screen.getByRole('textbox', { name: 'If you encountered a new AI image-classification error and did not know the cause, how would you investigate it?' })
  const finish = screen.getByRole('button', { name: 'Finish transfer' })
  expect(finish).toBeDisabled()
  await user.type(q1, 'A')
  expect(finish).toBeDisabled()
  await user.type(q2, 'B')
  expect(finish).toBeEnabled()
  expect(screen.queryByText(/Observe.*Predict.*Manipulate/i)).not.toBeInTheDocument()
  await user.click(finish)
  expect(onSubmitReflection).toHaveBeenCalledWith({ learningReflection: 'A', newErrorStrategy: 'B' })
  expect(await screen.findByRole('heading', { name: 'Transfer complete' })).toBeInTheDocument()
  expect(screen.getByText(/Patch, Pixel and Blur were examples; the reusable outcome is the investigation process/)).toBeInTheDocument()
})


test('uses the same Reflection questions after an exhausted run', async () => {
  const user = userEvent.setup()
  const exhaustedAttempts: ComplexTransferAttempt[] = Array.from({ length: 5 }, (_, index) => ({
    ...summaryAttempts[0],
    attempt_number: index + 1,
    after_parameters: { ...summaryAttempts[0].after_parameters, blur_level: index % 2 ? 'medium' : 'low' },
    after_classification: 'toaster',
  }))
  render(<ComplexTransferFlow
    imageUrl="/attempt-5.png"
    subject="ice cream"
    currentPrediction={{ label: 'toaster', probability: 0.8, class_index: 859 }}
    attemptIndex={5}
    maxAttempts={5}
    initialClassification="toaster"
    attemptHistory={exhaustedAttempts}
    runFinished
    runSuccess={false}
    referenceParameters={{ patch: { size: 0, positionX: 0.75, positionY: 0.25 }, pixelStrength: 0.5, blurLevel: 'none' }}
    referenceTop1Label="ice cream"
    onPlanConfirmed={vi.fn()}
    onSubmitReflection={vi.fn().mockResolvedValue(undefined)}
  />)

  expect(screen.getByRole('heading', { name: 'Investigation complete' })).toBeInTheDocument()
  expect(screen.getByText('The classification was not restored within five attempts.')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Transfer result' })).toHaveTextContent('5 / 5')
  expect(screen.getAllByRole('listitem')).toHaveLength(5)
  expect(screen.getByRole('heading', { name: 'Your final state vs one verified reference' })).toBeInTheDocument()
  expect(screen.getByText('One verified reference is a parameter configuration that produced the correct classification for this case. Other parameter combinations may also produce different results.')).toBeInTheDocument()
  const finalComparison = screen.getByRole('region', { name: 'Your final state' })
  const referenceComparison = screen.getByRole('region', { name: 'One verified reference' })
  expect(finalComparison).toHaveTextContent('Enabled · Size 30% · X 0.60 · Y 0.20')
  expect(finalComparison).toHaveTextContent('4/255')
  expect(finalComparison).toHaveTextContent('Low · Setting 4')
  expect(finalComparison).toHaveTextContent('Final state classificationtoaster')
  expect(referenceComparison).toHaveTextContent('Removed · Size 0%')
  expect(referenceComparison).not.toHaveTextContent('X 0.75')
  expect(referenceComparison).toHaveTextContent('0.5/255')
  expect(referenceComparison).toHaveTextContent('None · Setting 0')
  expect(referenceComparison).toHaveTextContent('Verified classificationice cream')
  expect(screen.queryByRole('heading', { name: 'What would you like to investigate next?' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Reclassify image' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Continue to reflection' }))
  expect(screen.getByRole('textbox', { name: 'What did you learn from the results of your different attempts?' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'If you encountered a new AI image-classification error and did not know the cause, how would you investigate it?' })).toBeInTheDocument()
})


test('restores a submitted Reflection directly to the completed state', async () => {
  const user = userEvent.setup()
  const onViewReport = vi.fn().mockResolvedValue(undefined)
  render(<ComplexTransferFlow
    imageUrl="/attempt-2.png"
    subject="ice cream"
    currentPrediction={{ label: 'ice cream', probability: 0.61, class_index: 928 }}
    attemptIndex={2}
    attemptHistory={summaryAttempts}
    runFinished
    runSuccess
    reflectionCompleted
    onPlanConfirmed={vi.fn()}
    onViewReport={onViewReport}
  />)

  expect(screen.getByRole('heading', { name: 'Transfer complete' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Continue to reflection' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'View Investigator Report' }))
  expect(onViewReport).toHaveBeenCalledOnce()
})
