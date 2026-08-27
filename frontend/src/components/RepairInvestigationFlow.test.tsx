import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ActiveStage, PlayerCase } from '../types'
import { RepairInvestigationFlow } from './RepairInvestigationFlow'

function repairCase(attackType: 'patch' | 'fgsm'): ActiveStage {
  const method = attackType === 'patch' ? 'patch' : 'pixel'
  const playerCase: PlayerCase = {
    case_id: `stage3-trafficlight-${method}`,
    stage: 'stage3',
    subject: 'traffic light',
    attack_type: attackType,
    interaction_mode: 'runtime_repair',
    correct_label: 'traffic light',
    initial_state_id: `${method}-error`,
    initial_image_url: `/game/cases/stage3-trafficlight-${method}/states/start/image`,
    initial_top1: { label: attackType === 'patch' ? 'mailbox' : 'shopping cart', probability: 0.8, class_index: 1 },
    parameter_rules: attackType === 'patch' ? [
      { parameter: 'position_x', allowed_values: [0.4, 0.5], initial_value: 0.4, fallback_value: 0.4 },
      { parameter: 'position_y', allowed_values: [0.4, 0.5], initial_value: 0.5, fallback_value: 0.5 },
      { parameter: 'size_fraction', allowed_values: [0.1, 0.35], initial_value: 0.35, fallback_value: 0.1 },
    ] : [
      { parameter: 'epsilon_pixels', allowed_values: [0.5, 1, 2, 4], initial_value: 4, fallback_value: 0.5 },
    ],
    max_attempts: 3,
    available_states: [],
  }
  return {
    caseIndex: attackType === 'patch' ? 4 : 5,
    playerCase,
    stageRun: {
      id: `run-${method}`,
      session_id: 'session-1',
      case_id: playerCase.case_id,
      stage: 'stage3',
      attack_type: attackType,
      completion_status: 'in_progress',
      success: null,
      attempt_count: 0,
      used_hint: false,
      fallback_shown: false,
      initial_top1_label: playerCase.initial_top1.label,
      final_top1_label: null,
      classification_restored: null,
      started_at: '2026-08-03T12:00:00Z',
      completed_at: null,
    },
  }
}

describe('RepairInvestigationFlow', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('records the predicted repair direction before reclassifying a changed repair', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = input.toString()
      const body = url.endsWith('/preview') ? { image_url: '/preview.png', parameters: {} } : {
        attempt_number: 1,
        image_url: '/game/stage-runs/run-patch/attempts/1/image',
        top1: { label: 'traffic light', probability: 0.9, class_index: 920 },
        top5: [{ label: 'traffic light', probability: 0.9, class_index: 920 }],
        parameters: { position_x: 0.4, position_y: 0.5, size_fraction: 0.1 },
        classification_changed: true,
        correct_label_is_top1: true,
        classification_restored: true,
        attempts_remaining: 2,
      }
      return Promise.resolve(new Response(JSON.stringify(body), { status: url.endsWith('/preview') ? 200 : 201, headers: { 'Content-Type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<RepairInvestigationFlow cases={[repairCase('patch'), repairCase('fgsm')]} nextError={null} onStageComplete={vi.fn()} onContinue={vi.fn()} isMovingNext={false} />)

    expect(screen.getByText('Current incorrect classification')).toBeInTheDocument()
    expect(screen.getByText('mailbox')).toBeInTheDocument()
    expect(screen.getByText(/Autonomous attempts available: 3/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Predict a repair direction' }))

    expect(screen.queryByRole('radio', { name: 'Not sure yet' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('radio', { name: /Patch|size/i })).toHaveLength(3)
    expect(screen.queryByRole('radio', { name: 'Remove the Patch' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Adjust the Patch size' }))
    const continueButton = screen.getByRole('button', { name: 'Continue to Manipulate' })
    expect(continueButton).toBeEnabled()
    expect(screen.queryByText('What do you predict will happen?')).not.toBeInTheDocument()
    expect(screen.queryByText('Why do you think this repair method may help?')).not.toBeInTheDocument()
    await user.click(continueButton)

    expect(screen.getByText('Patch repair settings')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Previous Patch attempts and results' })).toHaveTextContent('No previous Patch attempts yet.')
    expect(screen.getByText('3 attempts left')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Adjust the Patch size', level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: 'Horizontal position' })).not.toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: 'Vertical position' })).not.toBeInTheDocument()
    expect(screen.getByText(/Current Patch position: X 0.40, Y 0.50/)).toBeInTheDocument()
    expect(screen.getByText('Change at least one repair parameter before reclassifying.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to Reclassify' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '10%' }))
    expect(screen.getByRole('button', { name: 'Continue to Reclassify' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Continue to Reclassify' }))
    expect(screen.queryByText('For this specific modification, what do you expect the AI’s main classification judgement to do?')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reclassify image' }))
    expect((await screen.findAllByText('traffic light')).length).toBeGreaterThanOrEqual(2)
    const reclassifyCall = fetchMock.mock.calls.find(([url]) => url.toString().endsWith('/reclassify'))
    expect(JSON.parse(String(reclassifyCall?.[1]?.body))).toMatchObject({
      parameters: { size_fraction: 0.1 },
      predicted_outcome: 'reduce_patch',
    })
    expect(JSON.parse(String(reclassifyCall?.[1]?.body))).not.toHaveProperty('prediction_reason')
    await user.click(screen.getByRole('button', { name: 'Continue to Compare' }))
    expect(screen.getByRole('heading', { name: 'The correct classification was restored' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Initial traffic light Patch image' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Modified traffic light Patch image' })).toBeInTheDocument()
    expect(screen.getByLabelText('Explore classification evidence for traffic light and mailbox')).toBeInTheDocument()
  })

  test('shows only the controls allowed by the selected Patch repair direction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ image_url: '/preview.png', parameters: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const user = userEvent.setup()
    render(<RepairInvestigationFlow cases={[repairCase('patch'), repairCase('fgsm')]} nextError={null} onStageComplete={vi.fn()} onContinue={vi.fn()} isMovingNext={false} />)

    await user.click(screen.getByRole('button', { name: 'Predict a repair direction' }))
    await user.click(screen.getByRole('radio', { name: 'Move the Patch' }))
    await user.click(screen.getByRole('button', { name: 'Continue to Manipulate' }))
    expect(screen.getByRole('slider', { name: /Horizontal position/ })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /Vertical position/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '10%' })).not.toBeInTheDocument()
    expect(screen.getByText(/Current Patch size: 35%/)).toBeInTheDocument()
  })

  test('uses a fixed-baseline Pixel preview with compact help and previous evidence', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ image_url: '/preview.png', parameters: { epsilon_pixels: 2 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<RepairInvestigationFlow cases={[repairCase('patch'), repairCase('fgsm')]} nextError={null} onStageComplete={vi.fn()} onContinue={vi.fn()} isMovingNext={false} />)

    await user.click(screen.getByRole('tab', { name: /Pixel/ }))
    await user.click(screen.getByRole('button', { name: 'Predict a repair direction' }))
    await user.click(screen.getByRole('radio', { name: 'Adjust the Pixel strength' }))
    await user.click(screen.getByRole('button', { name: 'Continue to Manipulate' }))

    expect(screen.queryByLabelText('About Pixel modification')).not.toBeInTheDocument()
    expect(screen.getByText('Before · Current Result | Preview · Selected Strength').closest('.pixel-manipulate-layout')).toBeInTheDocument()
    expect(screen.getByText('What is Pixel Strength?').closest('details')).not.toHaveAttribute('open')
    const strengthSlider = screen.getByRole('slider', { name: 'Pixel strength' })
    expect(strengthSlider).toHaveValue('3')
    const strengthControl = strengthSlider.closest('.pixel-strength-control')
    expect(strengthControl?.querySelector('.pixel-strength-ticks')).toHaveStyle({ gridTemplateColumns: 'repeat(4, minmax(48px, 1fr))' })
    expect(strengthControl).toHaveTextContent('0.5/255')
    expect(strengthControl).toHaveTextContent('1/255')
    expect(strengthControl).toHaveTextContent('2/255')
    expect(strengthControl).toHaveTextContent('4/255')
    expect(strengthControl).not.toHaveTextContent('0.25/255')
    expect(strengthControl).not.toHaveTextContent('0.75/255')
    expect(strengthControl).toHaveTextContent('Initial value')
    expect(strengthControl).not.toHaveTextContent('Locked')
    expect(strengthControl).not.toHaveTextContent('full range')
    expect(screen.getByText('Find a setting that restores the correct classification.')).toBeInTheDocument()
    expect(screen.getByText('Choose a new Pixel Strength to preview the modified image.')).toBeInTheDocument()
    expect(screen.getByText(/Strengths are not added to previous attempts/)).toBeInTheDocument()
    expect(screen.getByText('Previous attempts / results')).toBeInTheDocument()
    expect(screen.getByText('No previous Pixel attempts yet.')).toBeInTheDocument()
    expect(screen.getByText('Use the evidence from your previous attempts to decide what to try next.')).toBeInTheDocument()
    expect(screen.getByText('32×32 selected region')).toBeInTheDocument()
    fireEvent.change(strengthSlider, { target: { value: '0' } })
    await waitFor(() => {
      const previewCall = fetchMock.mock.calls.find(([url]) => url.toString().endsWith('/preview'))
      expect(JSON.parse(String(previewCall?.[1]?.body))).toMatchObject({ parameters: { epsilon_pixels: 0.5 } })
    })
  })
})
