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
