import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { InvestigatorReport } from './InvestigatorReport'


describe('InvestigatorReport', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('renders process evidence without exposing internal identifiers', async () => {
    const payload = {
      report_version: 1,
      session: { completion_status: 'completed', completed_at: '2026-08-04T00:00:00Z', game_version: 'mvp-1' },
      overview: { stages_completed: 4, stages_total: 4, evidence_records: 1, autonomous_attempts: 1, fallback_records: 0, predictions_recorded: 1, decisive_predictions: 1, prediction_matches: 0, uncertain_predictions: 0, autonomous_restorations: 0, fallback_methods: [] },
      process_profile: { controlled_adjustments: 1, transfer_conclusion_status: 'supported' },
      transfer: { strategy: 'controlled_investigation', strategy_reason: 'It creates comparable evidence.', repairs: { Patch: { direction: 'move_patch', reason: 'It changes one Patch property.' }, Pixel: { direction: 'reduce_pixel_strength', reason: 'It changes one Pixel property.' } }, evidence_conclusion: 'conditional_evidence', evidence_explanation: 'The result only supports this case.' },
      stage3_reflection: {}, feedback: ['A prediction mismatch is useful evidence.'],
      evidence: [{ stage: 'transfer', stage_name: 'Transfer', case_id: 'transfer-case', method: 'Patch', attempt_number: 1, fallback: false, tool_type: 'adjust_patch', parameters_before: { size_fraction: 0.3, patch_path: 'private/patch.png' }, parameters_after: { size_fraction: 0.2, patch_path: 'private/patch.png' }, prediction: 'move_patch', prediction_reason: 'May help', prediction_match: false, top1_before: 'toaster', top1_after: 'toaster', classification_changed: false, classification_restored: false, confidence_after: 0.7, correct_rank_after: null }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    render(<InvestigatorReport sessionId="internal-session-id" onHome={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Investigator Report' })).toBeInTheDocument()
    expect(screen.getByText('0/1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tutorial' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Condition Investigation' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Repair Investigation' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Transfer' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Parameters before' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Classification after' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Confidence' })).not.toBeInTheDocument()
    expect(screen.queryByText('private/patch.png')).not.toBeInTheDocument()
    expect(screen.getByText('Did not match')).toBeInTheDocument()
    expect(screen.queryByText('Investigation overview')).not.toBeInTheDocument()
    expect(screen.queryByText('Modifications tested')).not.toBeInTheDocument()
    expect(screen.getByText('Transfer review')).toBeInTheDocument()
    expect(screen.queryByText('Investigation-process profile')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Explain Classification checks' }))
    expect(screen.getByText(/Every modification followed by a classifier result/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Explain Predictions matching results' }))
    expect(screen.getByText(/excluded from both the matched count and the scored-prediction total/)).toBeInTheDocument()
    expect(screen.getByText(/remain included in Classification checks/)).toBeInTheDocument()
    expect(screen.queryByText('internal-session-id')).not.toBeInTheDocument()
  })

  test('renders a successful Complex Transfer as one ordered Attempt timeline', async () => {
    const parameters = { patch_enabled: true, patch_size_fraction: 0.3, patch_position_x: 0.6, patch_position_y: 0.2, epsilon_pixels: 4, blur_level: 'high', blur_radius: 16 }
    const finalParameters = { ...parameters, patch_size_fraction: 0.1, patch_position_x: 0.8, epsilon_pixels: 0, blur_level: 'low', blur_radius: 4 }
    const payload = {
      report_version: 2,
      session: { completion_status: 'completed', completed_at: '2026-08-16T00:00:00Z', game_version: 'v2' },
      overview: { stages_completed: 4, stages_total: 4, evidence_records: 3, autonomous_attempts: 3, fallback_records: 0, predictions_recorded: 3, decisive_predictions: 0, prediction_matches: 0, uncertain_predictions: 0, autonomous_restorations: 1, fallback_methods: [] },
      process_profile: { controlled_adjustments: 3, transfer_conclusion_status: 'review_recommended' },
      transfer: { strategy: null, strategy_reason: null, repairs: { Patch: { direction: null, reason: null }, Pixel: { direction: null, reason: null } }, evidence_conclusion: null, evidence_explanation: null },
      complex_transfer: {
        case_id: 'complex-transfer-icecream', completion_status: 'completed', attempts_used: 3,
        operational_success: true, autonomous_success: true, fallback_used: false, classification_restored: true,
        initial_classification: 'toaster', initial_parameters: parameters, final_classification: 'ice cream', final_parameters: finalParameters,
        attempts: [
          { attempt_number: 1, selected_factor: 'Blur', prediction: 'change_uncertain', prediction_reason: 'Clarity may affect the result.', parameters_before: parameters, parameters_after: { ...parameters, blur_level: 'low', blur_radius: 4 }, classification_before: 'toaster', classification_after: 'eggnog', classification_restored: false },
          { attempt_number: 2, selected_factor: 'Pixel', prediction: 'stay_same', prediction_reason: null, parameters_before: parameters, parameters_after: { ...parameters, epsilon_pixels: 0 }, classification_before: 'eggnog', classification_after: 'toaster', classification_restored: false },
          { attempt_number: 3, selected_factor: 'Patch', prediction: 'restore_correct', prediction_reason: null, parameters_before: parameters, parameters_after: finalParameters, classification_before: 'toaster', classification_after: 'ice cream', classification_restored: true },
        ],
        reflection: { learning_reflection: 'Each result informed my next attempt.', new_error_strategy: 'I would test a change and compare the result.' },
        verified_reference: null,
      },
      stage3_reflection: {}, feedback: [],
      evidence: [
        { stage: 'transfer', stage_name: 'Transfer', case_id: 'complex-transfer-icecream', method: 'Blur', attempt_number: 1, fallback: false, tool_type: 'complex_transfer_blur', parameters_before: parameters, parameters_after: parameters, prediction: 'change_uncertain', prediction_reason: 'Clarity may affect the result.', prediction_match: null, top1_before: 'toaster', top1_after: 'eggnog', classification_changed: true, classification_restored: false, confidence_after: 0.7, correct_rank_after: null },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    render(<InvestigatorReport sessionId="complex-success" onHome={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Complex Transfer' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Complex Transfer outcomes' })).toHaveTextContent('Operational successYes')
    expect(screen.getByRole('region', { name: 'Complex Transfer outcomes' })).toHaveTextContent('Fallback usedNo')
    const timeline = screen.getByRole('heading', { name: 'Attempt timeline' }).parentElement!
    expect(timeline).toHaveTextContent('Attempt 1 · Blur')
    expect(timeline).toHaveTextContent('Attempt 2 · Pixel')
    expect(timeline).toHaveTextContent('Attempt 3 · Patch')
    expect(timeline).toHaveTextContent('Clarity may affect the result.')
    expect(timeline).toHaveTextContent('ice cream')
    expect(screen.getByText('Each result informed my next attempt.')).toBeInTheDocument()
    expect(screen.getByText('I would test a change and compare the result.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your final state vs one verified reference' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tutorial to Repair Investigation evidence record' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tutorial to Repair Investigation evidence record' }).parentElement).toHaveTextContent('0 records')
    expect(screen.getByRole('heading', { name: 'Tutorial' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Repair Investigation' })).toBeInTheDocument()
    expect(screen.queryByText(/reasoning_success/i)).not.toBeInTheDocument()
  })

  test('renders the exhausted final state and one reference outside the five Attempts', async () => {
    const state = { patch_enabled: true, patch_size_fraction: 0.3, patch_position_x: 0.6, patch_position_y: 0.2, epsilon_pixels: 2, blur_level: 'medium', blur_radius: 8 }
    const reference = { patch_enabled: true, patch_size_fraction: 0.1, patch_position_x: 0.8, patch_position_y: 0.2, epsilon_pixels: 0, blur_level: 'low', blur_radius: 4 }
    const attempts = Array.from({ length: 5 }, (_, index) => ({ attempt_number: index + 1, selected_factor: (['Patch', 'Pixel', 'Blur', 'Pixel', 'Patch'] as const)[index], prediction: 'not_sure', prediction_reason: null, parameters_before: state, parameters_after: state, classification_before: 'toaster', classification_after: 'eggnog', classification_restored: false }))
    const payload = {
      report_version: 2, session: { completion_status: 'completed', completed_at: null, game_version: 'v2' },
      overview: { stages_completed: 1, stages_total: 4, evidence_records: 5, autonomous_attempts: 5, fallback_records: 0, predictions_recorded: 5, decisive_predictions: 0, prediction_matches: 0, uncertain_predictions: 0, autonomous_restorations: 0, fallback_methods: [] },
      process_profile: { controlled_adjustments: 5, transfer_conclusion_status: 'review_recommended' },
      transfer: { strategy: null, strategy_reason: null, repairs: { Patch: { direction: null, reason: null }, Pixel: { direction: null, reason: null } }, evidence_conclusion: null, evidence_explanation: null },
      complex_transfer: { case_id: 'complex-transfer-icecream', completion_status: 'completed', attempts_used: 5, operational_success: false, autonomous_success: false, fallback_used: false, classification_restored: false, initial_classification: 'toaster', initial_parameters: state, final_classification: 'eggnog', final_parameters: state, attempts, reflection: { learning_reflection: 'The attempts gave different results.', new_error_strategy: 'I would continue testing evidence.' }, verified_reference: { parameters: reference, classification: 'ice cream' } },
      stage3_reflection: {}, feedback: [], evidence: [],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    render(<InvestigatorReport sessionId="complex-exhausted" onHome={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Your final state vs one verified reference' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Complex Transfer outcomes' })).toHaveTextContent('Operational successNo')
    expect(screen.getByRole('region', { name: 'Complex Transfer outcomes' })).toHaveTextContent('Autonomous successNo')
    expect(screen.getByRole('region', { name: 'Complex Transfer outcomes' })).toHaveTextContent('Fallback usedNo')
    expect(screen.getByRole('heading', { name: 'Attempt timeline' }).parentElement).toHaveTextContent('Attempt 5 · Patch')
    expect(screen.getByRole('heading', { name: 'Attempt timeline' }).parentElement?.querySelectorAll('li')).toHaveLength(5)
    expect(screen.getByRole('heading', { name: 'One verified configuration for this case' })).toBeInTheDocument()
    expect(screen.getByText('Verified classification').parentElement).toHaveTextContent('ice cream')
  })
})
