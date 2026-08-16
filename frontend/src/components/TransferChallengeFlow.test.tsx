import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ActiveStage } from '../types'
import { TransferChallengeFlow } from './TransferChallengeFlow'

function transferCase(attackType: 'patch' | 'fgsm'): ActiveStage {
  const method = attackType === 'patch' ? 'patch' : 'pixel'
  return {
    caseIndex: attackType === 'patch' ? 6 : 7,
    playerCase: {
      case_id: `transfer-icecream-${method}`, stage: 'transfer', subject: 'ice cream', attack_type: attackType,
      interaction_mode: 'runtime_transfer', correct_label: 'ice cream', initial_state_id: `${method}-initial`,
      initial_image_url: `/game/cases/transfer-icecream-${method}/states/initial/image`,
      initial_top1: { label: attackType === 'patch' ? 'toaster' : 'acorn squash', probability: 0.8, class_index: 1 },
      parameter_rules: attackType === 'patch' ? [
        { parameter: 'position_x', allowed_values: [0.4, 0.5], initial_value: 0.4, fallback_value: 0.5 },
        { parameter: 'position_y', allowed_values: [0.2, 0.4], initial_value: 0.2, fallback_value: 0.4 },
        { parameter: 'size_fraction', allowed_values: [0.2, 0.3, 0.35], initial_value: 0.3, fallback_value: 0.2 },
      ] : [{ parameter: 'epsilon_pixels', allowed_values: [0, 2, 4], initial_value: 4, fallback_value: 0 }],
      max_attempts: 3, available_states: [],
    },
    stageRun: {
      id: `run-${method}`, session_id: 'session-1', case_id: `transfer-icecream-${method}`, stage: 'transfer', attack_type: attackType,
      completion_status: 'in_progress', success: null, attempt_count: 0, used_hint: false, fallback_shown: false,
      initial_top1_label: attackType === 'patch' ? 'toaster' : 'acorn squash', final_top1_label: null,
      classification_restored: null, started_at: '2026-08-03T12:00:00Z', completed_at: null,
    },
  }
}

describe('TransferChallengeFlow', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('saves the strategy feedback and one repair direction before manipulation', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve(
      new Response(JSON.stringify(url.endsWith('/preview') ? { image_url: '/preview.png', parameters: {} } : { id: 'response-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<TransferChallengeFlow cases={[transferCase('patch'), transferCase('fgsm')]} nextError={null} onStageComplete={vi.fn()} onViewReport={vi.fn()} />)

    expect(screen.queryByText('Reclassify', { selector: '.step-progress *' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Previously unseen ice cream Patch case' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Previously unseen ice cream Pixel case' })).toBeInTheDocument()
    expect(screen.getByText('You will investigate these two incorrectly classified images. Which next step would provide the most useful evidence?')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Choose a repair direction/ }))
    await user.type(screen.getByRole('textbox', { name: 'Why did you choose this next step?' }), 'It changes one variable and produces comparable evidence.')
    await user.click(screen.getByRole('button', { name: 'Submit answer' }))
    expect(await screen.findByRole('heading', { name: 'This step creates useful comparison evidence' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Begin the Patch case' }))
    expect(screen.getByRole('heading', { name: 'Which Patch repair direction will you test?' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Adjust the Pixel strength' })).not.toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Continue to Manipulate' })
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Move the Patch' }))
    expect(submit).toBeEnabled()
    expect(screen.queryByRole('textbox', { name: 'Why did you choose this repair direction?' })).not.toBeInTheDocument()
    await user.click(submit)

    expect(await screen.findByRole('heading', { name: 'Move the Patch', level: 2 })).toBeInTheDocument()
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ question_key: 'transfer_next_step_strategy', answer_value: 'controlled_investigation' })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ question_key: 'transfer_next_step_reason' })
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({ question_key: 'transfer_patch_repair_direction', answer_value: 'move_patch' })
    expect(fetchMock.mock.calls.map(([, request]) => request?.body && JSON.parse(String(request.body)).question_key)).not.toContain('transfer_patch_repair_reason')
    expect(screen.queryByText('What do you expect to happen after applying this adjustment?')).not.toBeInTheDocument()
  })

  test('keeps the Patch image through its sub-case before moving to the Pixel image', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, request?: RequestInit) => {
      const submitted = request?.body ? JSON.parse(String(request.body)) : null
      const isPixelReclassify = url.includes('run-pixel') && url.endsWith('/reclassify')
      const isBaselineCheck = isPixelReclassify && submitted?.parameters?.epsilon_pixels === 0
      const body = url.endsWith('/preview')
        ? { image_url: '/patch-preview.png', parameters: {} }
        : url.endsWith('/reclassify')
          ? { attempt_number: isBaselineCheck ? 2 : 1, image_url: isPixelReclassify ? '/pixel-result.png' : '/patch-result.png', top1: { label: isPixelReclassify && !isBaselineCheck ? 'acorn squash' : 'ice cream', probability: 0.9, class_index: 2 }, top5: [], parameters: submitted?.parameters ?? {}, classification_changed: true, correct_label_is_top1: !isPixelReclassify || isBaselineCheck, classification_restored: !isPixelReclassify || isBaselineCheck, attempts_remaining: isBaselineCheck ? 1 : 2 }
          : { id: 'response-1' }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<TransferChallengeFlow cases={[transferCase('patch'), transferCase('fgsm')]} nextError={null} onStageComplete={vi.fn()} onViewReport={vi.fn()} />)

    await user.click(screen.getByRole('radio', { name: /Choose a repair direction/ }))
    await user.type(screen.getByRole('textbox', { name: 'Why did you choose this next step?' }), 'It produces controlled evidence.')
    await user.click(screen.getByRole('button', { name: 'Submit answer' }))
    await user.click(await screen.findByRole('button', { name: 'Begin the Patch case' }))
    await user.click(screen.getByRole('radio', { name: 'Move the Patch' }))
    await user.click(screen.getByRole('button', { name: 'Continue to Manipulate' }))

    expect(await screen.findByRole('img', { name: 'Ice cream Patch preview' })).toHaveAttribute('src', expect.stringContaining('patch'))
    await user.click(screen.getByRole('button', { name: 'Continue to Reclassify' }))
    await user.click(screen.getByRole('button', { name: 'Reclassify image' }))
    await user.click(await screen.findByRole('button', { name: 'Review repair settings' }))
    expect(screen.getByRole('heading', { name: 'Recorded repair settings' })).toBeInTheDocument()
    expect(screen.getByText('X 0.40 · Y 0.20 · Size 35%')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Return to result' }))
    await user.click(await screen.findByRole('button', { name: 'Continue to Compare' }))
    expect(screen.queryByText('Did the result support, weaken, or change your original thinking?')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review Patch result' }))

    expect(await screen.findByRole('heading', { name: 'The Patch image is repaired' })).toBeInTheDocument()
    expect(screen.getByText('The repaired image now receives the correct classification. Continue to investigate and repair the Pixel image.')).toBeInTheDocument()
    expect(screen.queryByText('Final Patch result')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Begin Pixel repair' }))

    expect(await screen.findByRole('heading', { name: 'Which Pixel repair direction will you test?' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Ice cream Pixel case' })).toHaveAttribute('src', expect.stringContaining('transfer-icecream-pixel'))
    expect(screen.queryByRole('radio', { name: 'Move the Patch' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Adjust the Pixel strength' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Keep the current strength' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([, request]) => request?.body && JSON.parse(String(request.body)).question_key)).not.toContain('transfer_patch_attempt_1_thinking_effect')

    await user.click(screen.getByRole('radio', { name: 'Adjust the Pixel strength' }))
    await user.click(screen.getByRole('button', { name: 'Continue to Manipulate' }))
    expect(screen.getByText('Baseline check unlocked: 0/255 removes the Pixel modification and returns to the original pixels.')).toBeInTheDocument()
    expect(screen.getByText('Change at least one repair parameter before reclassifying.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to Reclassify' })).toBeDisabled()
    const pixelStrength = screen.getByRole('slider', { name: 'Pixel strength' })
    expect(pixelStrength).toHaveAttribute('min', '0')
    fireEvent.change(pixelStrength, { target: { value: '1' } })
    expect(screen.getByRole('button', { name: 'Continue to Reclassify' })).toBeEnabled()
    await user.click(await screen.findByRole('button', { name: 'Continue to Reclassify' }))
    await user.click(screen.getByRole('button', { name: 'Reclassify image' }))
    await user.click(await screen.findByRole('button', { name: 'Continue to Compare' }))
    await user.click(screen.getByRole('button', { name: 'Try another repair' }))
    expect(await screen.findByText('Baseline check unlocked: 0/255 removes the Pixel modification and returns to the original pixels.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to Reclassify' })).toBeDisabled()
    const unlockedBaseline = screen.getByRole('slider', { name: 'Pixel strength' })
    expect(unlockedBaseline).toHaveAttribute('min', '0')
    fireEvent.change(unlockedBaseline, { target: { value: '0' } })
    expect(screen.getAllByText('0/255').length).toBeGreaterThanOrEqual(2)
    await user.click(screen.getByRole('button', { name: 'Continue to Reclassify' }))
    await user.click(screen.getByRole('button', { name: 'Reclassify image' }))
    await user.click(await screen.findByRole('button', { name: 'Continue to Compare' }))
    await user.click(screen.getByRole('button', { name: 'Continue to Reflection' }))

    const causeQuestion = screen.getByText('Do you think the image modification was the only possible cause of the incorrect classification?')
    const conclusionQuestion = screen.getByText('Which conclusion is best supported by the evidence from this case?')
    expect(causeQuestion.compareDocumentPosition(conclusionQuestion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'What other factors might also have contributed to the incorrect classification?' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'All Transfer repair results' })).toBeInTheDocument()
    expect(screen.getByText(/User baseline check/)).toBeInTheDocument()
  })
})
