import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import type { ActiveStage, PlayerCase } from '../types'
import { StageTwoFlow } from './StageTwoFlow'

function activeCase(attackType: 'patch' | 'fgsm'): ActiveStage {
  const method = attackType === 'patch' ? 'patch' : 'pixel'
  const playerCase: PlayerCase = {
    case_id: `stage2-pizza-${method}`,
    stage: 'stage2',
    subject: 'pizza',
    attack_type: attackType,
    interaction_mode: 'runtime_parameters',
    correct_label: 'pizza',
    initial_state_id: `${method}-start`,
    initial_image_url: `/game/cases/stage2-pizza-${method}/states/start/image`,
    initial_top1: { label: 'pizza', probability: 0.82, class_index: 963 },
    parameter_rules: attackType === 'patch' ? [
      { parameter: 'size_fraction', allowed_values: [0.25, 0.3, 0.35], initial_value: 0.3 },
      { parameter: 'position_x', allowed_values: [0.4, 0.5, 0.6], initial_value: 0.5 },
      { parameter: 'position_y', allowed_values: [0.4, 0.5, 0.7], initial_value: 0.5 },
    ] : [
      { parameter: 'epsilon_pixels', allowed_values: [0.5, 1, 2, 4], initial_value: 0.5 },
    ],
    max_attempts: null,
    available_states: [],
  }
  return {
    caseIndex: attackType === 'patch' ? 2 : 3,
    playerCase,
    stageRun: {
      id: `run-${method}`,
      session_id: 'session-1',
      case_id: playerCase.case_id,
      stage: 'stage2',
      attack_type: attackType,
      completion_status: 'in_progress',
      success: null,
      attempt_count: 0,
      used_hint: false,
      fallback_shown: false,
      initial_top1_label: 'pizza',
      final_top1_label: null,
      classification_restored: null,
      started_at: '2026-08-03T12:00:00Z',
      completed_at: null,
    },
  }
}

describe('StageTwoFlow', () => {
  test('shows both attacked-but-correct scenarios and both parameter toolsets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ image_url: '/preview.png', parameters: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const user = userEvent.setup()
    render(<StageTwoFlow cases={[activeCase('patch'), activeCase('fgsm')]} nextError={null} onStageComplete={vi.fn()} onContinue={vi.fn()} isMovingNext={false} />)

    expect(screen.getByAltText('Patch-attacked pizza')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Pixel.*Attack strength/i })).toBeInTheDocument()
    expect(screen.getByText(/Complete one, then choose the other/i)).toBeInTheDocument()
    expect(screen.getByText('Starting classification')).toBeInTheDocument()
    expect(screen.getByText('Current attack parameters')).toBeInTheDocument()
    expect(screen.getByText('Size 30% · X 0.50 · Y 0.50')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue with Patch' }))

    expect(screen.getByText('Patch size')).toBeInTheDocument()
    expect(screen.getByText('Patch position')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /position: position_x=/i })).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Top left position: position_x=0.4, position_y=0.4' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Top right position: position_x=0.6, position_y=0.4' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Centre position:.*position_y=0.5.*starting position/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Bottom left position: position_x=0.4, position_y=0.7' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bottom right position: position_x=0.6, position_y=0.7' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '25%' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '30%, starting size' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '35%' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '10%' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '15%' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '20%' })).not.toBeInTheDocument()
    expect(screen.getByText(/This is the starting image parameter combination/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose a different setting' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Top left position: position_x=0.4, position_y=0.4' }))
    expect(screen.getByRole('button', { name: 'Predict Patch result' })).toBeEnabled()
    expect(screen.queryByText('Pixel strength')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to variable choice' }))
    await user.click(screen.getByRole('tab', { name: /Pixel.*Attack strength/i }))
    await user.click(screen.getByRole('tab', { name: /Patch.*Size and position/i }))
    await user.click(screen.getByRole('button', { name: 'Continue with Patch' }))
    expect(screen.getByRole('button', { name: /Centre position:.*starting position/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '30%, starting size' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('img', { name: 'Patch-attacked pizza preview' }).getAttribute('src')).toMatch(/\/game\/cases\/stage2-pizza-patch\/states\/start\/image$/)
    vi.unstubAllGlobals()
  })

  test('shows Stage 2 Pixel as a fixed Observe-to-current comparison with numeric strengths', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ image_url: '/preview.png', parameters: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<StageTwoFlow cases={[activeCase('patch'), activeCase('fgsm')]} nextError={null} onStageComplete={vi.fn()} onContinue={vi.fn()} isMovingNext={false} />)

    await user.click(screen.getByRole('tab', { name: /Pixel.*Attack strength/i }))
    await user.click(screen.getByRole('button', { name: 'Continue with Pixel' }))

    expect(screen.getByLabelText('About Pixel modification')).toHaveTextContent('Many pixel values across the image are changed slightly—not just one pixel')
    expect(screen.getByText('Before · Observe Image | Preview · Selected Strength').closest('.pixel-manipulate-layout')).toBeInTheDocument()
    expect(screen.getByLabelText('What is Pixel Strength?')).toHaveTextContent('size of the changes made to the RGB values')
    expect(screen.getByText('Current / starting Strength: 0.5/255')).toBeInTheDocument()
    const availableStrengths = screen.getByLabelText('Available Pixel strengths')
    expect(availableStrengths).toHaveStyle({ gridTemplateColumns: 'repeat(4, minmax(48px, 1fr))' })
    expect(availableStrengths).toHaveTextContent('0.5/255')
    expect(availableStrengths).toHaveTextContent('1/255')
    expect(availableStrengths).toHaveTextContent('2/255')
    expect(availableStrengths).toHaveTextContent('4/255')
    expect(availableStrengths).not.toHaveTextContent('0.25/255')
    expect(availableStrengths).not.toHaveTextContent('0.75/255')
    expect(screen.queryByText('Weak')).not.toBeInTheDocument()
    expect(screen.queryByText('Strong')).not.toBeInTheDocument()
    expect(screen.getByText('1. Observe selected region')).toBeInTheDocument()
    expect(screen.getByText('2. Preview selected region')).toBeInTheDocument()
    expect(screen.getByLabelText('Observe strength 0.5/255, preview strength not selected')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Fixed Pixel Observe image with selected 32 by 32 region' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Current Pixel Strength preview with selected 32 by 32 region' })).not.toBeInTheDocument()
    expect(screen.getByText('Orange frame: fixed 32×32 region')).toBeInTheDocument()
    expect(screen.getByText('Choose a Pixel Strength to preview the modified image.')).toBeInTheDocument()
    expect(screen.getAllByText('Choose a Strength to compare the selected region.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: 'Select a Strength first' })).toBeDisabled()
    expect(screen.queryByLabelText('Next Pixel investigation action')).not.toBeInTheDocument()
    expect(screen.queryByText('Enhanced Difference')).not.toBeInTheDocument()
    expect(screen.queryByRole('grid', { name: 'Before Pixel Grid' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Current strength/)).not.toBeInTheDocument()

    expect(screen.getByRole('slider', { name: 'Pixel strength' })).toHaveValue('0')
    fireEvent.change(screen.getByRole('slider', { name: 'Pixel strength' }), { target: { value: '1' } })
    expect(await screen.findByRole('img', { name: 'Current Pixel Strength preview with selected 32 by 32 region' })).toBeInTheDocument()
    const previewCall = fetchMock.mock.calls.filter(([url]) => url.toString().endsWith('/preview')).at(-1)
    expect(JSON.parse(String(previewCall?.[1]?.body))).toMatchObject({ parameters: { epsilon_pixels: 1 } })
    expect(screen.getByRole('slider', { name: 'Pixel strength' })).toHaveValue('1')
    expect(screen.getByText('Selected Strength: 1/255 · preview only')).toBeInTheDocument()
    expect(screen.getByLabelText('Observe strength 0.5/255, preview strength 1/255')).toBeInTheDocument()
    expect(screen.getByLabelText('Next Pixel investigation action')).toHaveTextContent('You have chosen a Pixel Strength and previewed the modified image. Next, predict whether the change will affect the AI’s prediction, then reclassify the image to test your prediction.')
    expect(screen.getByRole('button', { name: 'Continue to Predict' })).toBeEnabled()
    vi.unstubAllGlobals()
  })

  test('moves the full Pixel lesson to Compare and keeps the Observe image fixed for every attempt', async () => {
    let reclassificationCount = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = input.toString()
      if (url.endsWith('/preview')) return new Response(JSON.stringify({ image_url: `/preview-${Date.now()}.png`, parameters: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/reclassify')) {
        reclassificationCount += 1
        const correct = reclassificationCount === 2
        return new Response(JSON.stringify({
          attempt_number: reclassificationCount,
          image_url: `/pixel-result-${reclassificationCount}.png`,
          top1: { label: correct ? 'pizza' : 'frying pan', probability: 0.8, class_index: correct ? 963 : 567 },
          top5: [], parameters: {}, classification_changed: !correct,
          correct_label_is_top1: correct, classification_restored: correct, attempts_remaining: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))
    const user = userEvent.setup()
    render(<StageTwoFlow cases={[activeCase('patch'), activeCase('fgsm')]} nextError={null} onStageComplete={vi.fn()} onContinue={vi.fn()} isMovingNext={false} />)

    await user.click(screen.getByRole('tab', { name: /Pixel.*Attack strength/i }))
    await user.click(screen.getByRole('button', { name: 'Continue with Pixel' }))
    const strength = screen.getByRole('slider', { name: 'Pixel strength' })
    fireEvent.change(strength, { target: { value: '2' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to Predict' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Continue to Predict' }))
    await user.click(screen.getByRole('radio', { name: "The AI's main judgement will change" }))
    await user.click(screen.getByRole('button', { name: 'Lock prediction and continue' }))
    expect(screen.getByLabelText('Why reclassify the image?')).toHaveTextContent('Reclassify the image to obtain classification evidence.')
    await user.click(screen.getByRole('button', { name: 'Reclassify image' }))
    await user.click(await screen.findByRole('button', { name: 'Continue to Compare' }))

    expect(screen.getByLabelText('Pixel inspection sequence')).toHaveTextContent('Whole image → 32×32 region → 8×8 region → RGB values / chart → Enhanced Difference')
    expect(screen.getByRole('region', { name: 'Pixel Inspector for pizza' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Pixel Inspector for pizza' })).toHaveClass('pixel-inspector--show-difference')
    expect(screen.getByText('Enhanced Difference · Same 8×8 Region')).toBeInTheDocument()
    expect(screen.getByLabelText(/Enhanced difference from Observe to Tested Strength for the same 8 by 8 Pixel region/)).toBeInTheDocument()
    expect(screen.getByLabelText('Fixed Pixel inspection region for pizza')).toBeInTheDocument()
    expect(screen.getByLabelText('Compare RGB and classification evidence')).toHaveTextContent('Finding RGB differences does not prove that the classification changed.')
    expect(screen.queryByLabelText('Why reclassify the image?')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Test another Pixel Strength' }))

    fireEvent.change(screen.getByRole('slider', { name: 'Pixel strength' }), { target: { value: '1' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to Predict' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Continue to Predict' }))
    await user.click(screen.getByRole('radio', { name: "The AI's main judgement will not change" }))
    await user.click(screen.getByRole('button', { name: 'Lock prediction and continue' }))
    await user.click(screen.getByRole('button', { name: 'Reclassify image' }))
    await user.click(await screen.findByRole('button', { name: 'Continue to Compare' }))

    expect(screen.queryByLabelText('Pixel inspection sequence')).not.toBeInTheDocument()
    expect(screen.getByText(/Use the same Pixel Inspector to examine this new Strength result/)).toBeInTheDocument()
    expect(screen.getByAltText('Fixed Pixel Observe image')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Pixel Inspector for pizza' })).toBeInTheDocument()
    expect(screen.getByLabelText('Fixed Pixel inspection region for pizza')).toBeInTheDocument()
    expect(screen.getByLabelText('Compare RGB and classification evidence')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
