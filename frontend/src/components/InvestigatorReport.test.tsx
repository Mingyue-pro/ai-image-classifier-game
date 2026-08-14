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
    expect(screen.getByText('Investigation overview')).toBeInTheDocument()
    expect(screen.getByText('Transfer review')).toBeInTheDocument()
    expect(screen.queryByText('Investigation-process profile')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Explain Classification checks' }))
    expect(screen.getByText(/Every modification followed by a classifier result/)).toBeInTheDocument()
    expect(screen.queryByText('internal-session-id')).not.toBeInTheDocument()
  })
})
