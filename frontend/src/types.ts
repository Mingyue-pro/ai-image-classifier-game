export type HealthResponse = {
  status: string
}

export type Participant = {
  id: string
  participant_code: string
  background: Record<string, unknown> | null
  created_at: string
}

export type ResearchSession = {
  id: string
  participant_id: string
  game_version: string
  study_phase: string | null
  completion_status: string
  consent_version: string | null
  consent_confirmed_at: string | null
  started_at: string
  completed_at: string | null
}

export type CreateParticipantRequest = {
  participant_code: string
  background?: Record<string, unknown>
}

export type CreateSessionRequest = {
  participant_id: string
  game_version: string
  study_phase: string
  consent_version: string
  consent_confirmed: boolean
}

export type Prediction = {
  label: string
  probability: number
  class_index: number
}

export type PredictedClassExample = {
  image_url: string
  source: string
  alt: string
}

export type PredictedClassExamples = {
  label: string
  examples: PredictedClassExample[]
}

export type PlayerCaseState = {
  state_id: string
  role: string
  image_url: string
  parameters: Record<string, unknown>
}

export type ParameterRule = {
  parameter: string
  control_type?: string
  allowed_values?: number[]
  initial_value?: number
  fallback_value?: number
  fixed_parameters?: Record<string, number>
}

export type PlayerCase = {
  case_id: string
  stage: string
  subject: string
  attack_type: string
  interaction_mode: string
  correct_label: string
  initial_state_id: string
  initial_image_url: string
  original_image_url?: string
  initial_top1: Prediction
  parameter_rules: ParameterRule[]
  max_attempts: number | null
  available_states: PlayerCaseState[]
}

export type StageRun = {
  id: string
  session_id: string
  case_id: string
  stage: string
  attack_type: string
  completion_status: string
  success: boolean | null
  attempt_count: number
  used_hint: boolean
  fallback_shown: boolean
  initial_top1_label: string | null
  final_top1_label: string | null
  classification_restored: boolean | null
  started_at: string
  completed_at: string | null
}

export type ActiveStage = {
  caseIndex: number
  playerCase: PlayerCase
  stageRun: StageRun
}

export type FixedChoiceRequest = {
  state_id: string
  predicted_outcome: string
  prediction_reason?: string
}

export type ReclassifyRequest = {
  tool_type: 'adjust_patch' | 'change_epsilon'
  parameters: Record<string, number>
  predicted_outcome?: string
  prediction_reason?: string
}

export type PreviewRequest = {
  tool_type: 'adjust_patch' | 'change_epsilon'
  parameters: Record<string, number>
}

export type PreviewResult = {
  image_url: string
  parameters: Record<string, number>
}

export type ComplexTransferApiParameters = {
  patch: { size_fraction: number; position_x: number; position_y: number }
  pixel_strength: number
  blur_level: 'high' | 'medium' | 'low' | 'none'
}

export type ComplexTransferRun = {
  stage_run_id: string
  image_url: string
  original_image_url?: string
  expected_class: string
  current_top1: Prediction
  current_parameters: ComplexTransferApiParameters
  attempt_index: number
  remaining_attempts: number
  max_attempts: number
  success: boolean
  finished: boolean
  exhausted: boolean
  initial_top1_label: string
  attempts: ComplexTransferAttempt[]
  reference_recoverable_parameters: ComplexTransferApiParameters
  reference_top1_label: string
}

export type ComplexTransferAttempt = {
  attempt_number: number
  selected_factor: 'patch' | 'pixel' | 'blur'
  prediction: string
  before_parameters: ComplexTransferApiParameters
  after_parameters: ComplexTransferApiParameters
  before_classification: string
  after_classification: string
  classification_restored: boolean
  timestamp: string
}

export type ComplexTransferAction = {
  stage_run_id: string
  attempt_index: number
  image_url: string
  selected_factor: string
  prediction: string
  before_parameters: ComplexTransferApiParameters
  after_parameters: ComplexTransferApiParameters
  before_top1: Prediction
  after_top1: Prediction
  classification_restored: boolean
  remaining_attempts: number
}

export type ComplexTransferReflection = {
  stage_run_id: string
  completed: boolean
  learning_reflection: string | null
  new_error_strategy: string | null
}

export type StageTwoAttempt = {
  method: 'Patch' | 'Pixel'
  parameters: Record<string, number>
  prediction: string
  action: GameAction
}

export type RepairAttempt = {
  method: 'Patch' | 'Pixel'
  direction: string
  prediction: string
  reason: string
  parameters: Record<string, number>
  action: GameAction
  fallback: boolean
}

export type GameAction = {
  attempt_number: number
  image_url: string
  top1: Prediction
  top5: Prediction[]
  parameters: Record<string, unknown>
  classification_changed: boolean
  correct_label_is_top1: boolean
  classification_restored: boolean
  attempts_remaining: number | null
}

export type ResponseRequest = {
  question_key: string
  question_version: number
  answer_type: 'text' | 'choice' | 'multiple_choice' | 'scale'
  answer_text?: string
  answer_value?: string
  answer_json?: unknown
}

export type StageOneSummary = {
  method: 'Patch' | 'Pixel'
  parameters: Record<string, unknown>
  prediction: string
  top1_before: string
  top1_after: string
  classification_changed: boolean
  prediction_matched: boolean | null
}

export type ReportEvidence = {
  stage: string
  stage_name: string
  case_id: string
  method: 'Patch' | 'Pixel' | 'Blur'
  attempt_number: number
  fallback: boolean
  tool_type: string
  parameters_before: Record<string, unknown> | null
  parameters_after: Record<string, unknown>
  prediction: string | null
  prediction_reason: string | null
  prediction_match: boolean | null
  top1_before: string | null
  top1_after: string
  classification_changed: boolean
  classification_restored: boolean
  confidence_after: number | null
  correct_rank_after: number | null
}

export type ComplexTransferReportAttempt = {
  attempt_number: number
  selected_factor: 'Patch' | 'Pixel' | 'Blur'
  prediction: string | null
  prediction_reason: string | null
  parameters_before: Record<string, unknown> | null
  parameters_after: Record<string, unknown> | null
  classification_before: string | null
  classification_after: string
  classification_restored: boolean
}

export type ComplexTransferReport = {
  case_id: string
  completion_status: string
  attempts_used: number
  operational_success: boolean
  autonomous_success: boolean
  fallback_used: boolean
  classification_restored: boolean
  initial_classification: string | null
  initial_parameters: Record<string, unknown> | null
  final_classification: string | null
  final_parameters: Record<string, unknown> | null
  attempts: ComplexTransferReportAttempt[]
  reflection: {
    learning_reflection: string | null
    new_error_strategy: string | null
  }
  verified_reference: {
    parameters: Record<string, unknown>
    classification: string
  } | null
}

export type InvestigatorReport = {
  report_version: number
  session: { completion_status: string; completed_at: string | null; game_version: string }
  overview: {
    stages_completed: number; stages_total: number; evidence_records: number
    autonomous_attempts: number; fallback_records: number; predictions_recorded: number
    decisive_predictions: number; prediction_matches: number; uncertain_predictions: number
    autonomous_restorations: number; fallback_methods: string[]
  }
  process_profile: {
    controlled_adjustments: number
    transfer_conclusion_status: 'supported' | 'review_recommended'
  }
  transfer: {
    strategy: string | null; strategy_reason: string | null
    repairs: Record<'Patch' | 'Pixel', { direction: string | null; reason: string | null }>
    evidence_conclusion: string | null; evidence_explanation: string | null
  }
  complex_transfer: ComplexTransferReport | null
  stage3_reflection: Record<string, unknown>
  evidence: ReportEvidence[]
  feedback: string[]
}
