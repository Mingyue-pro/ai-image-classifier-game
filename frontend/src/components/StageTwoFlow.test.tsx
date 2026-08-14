import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import type { ActiveStage, PlayerCase } from '../types'
import { StageTwoFlow } from './StageTwoFlow'

function activeCase(attackType: 'patch' | 'fgsm'): ActiveStage {
  const method = attackType === 'patch' ? 'patch' : 'pixel'
  const playerCase: PlayerCase = {
    case_id: `stage2-strawberry-${method}`,
    stage: 'stage2',
    subject: 'strawberry',
    attack_type: attackType,
    interaction_mode: 'runtime_parameters',
    correct_label: 'strawberry',
    initial_state_id: `${method}-start`,
    initial_image_url: `/game/cases/stage2-strawberry-${method}/states/start/image`,
    initial_top1: { label: 'strawberry', probability: 0.82, class_index: 949 },
    parameter_rules: attackType === 'patch' ? [
      { parameter: 'size_fraction', allowed_values: [0.1, 0.15, 0.2], initial_value: 0.15 },
      { parameter: 'position_x', allowed_values: [0.4, 0.5, 0.6], initial_value: 0.5 },
      { parameter: 'position_y', allowed_values: [0.4, 0.5, 0.6], initial_value: 0.5 },
    ] : [
      { parameter: 'epsilon_pixels', allowed_values: [0, 0.25, 0.5, 0.75, 1], initial_value: 0.25 },
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
      initial_top1_label: 'strawberry',
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

    expect(screen.getByAltText('Patch-attacked strawberry')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Pixel.*Attack strength/i })).toBeInTheDocument()
    expect(screen.getByText(/Complete one, then choose the other/i)).toBeInTheDocument()
    expect(screen.getByText('Starting classification')).toBeInTheDocument()
    expect(screen.getByText('Current attack parameters')).toBeInTheDocument()
    expect(screen.getByText('Size 15% · X 0.50 · Y 0.50')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue with Patch' }))

    expect(screen.getByText('Patch size')).toBeInTheDocument()
    expect(screen.getByText('Patch position')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /position: position_x=/i })).toHaveLength(5)
    expect(screen.getByRole('button', { name: /Centre position:.*starting position/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '15%, starting size' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/This is the starting image parameter combination/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose a different setting' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Top left position: position_x=0.4, position_y=0.4' }))
    expect(screen.getByRole('button', { name: 'Predict Patch result' })).toBeEnabled()
    expect(screen.queryByText('Pixel strength')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to variable choice' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
