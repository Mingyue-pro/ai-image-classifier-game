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
