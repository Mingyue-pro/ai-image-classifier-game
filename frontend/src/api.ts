import type {
  CreateParticipantRequest,
  CreateSessionRequest,
  ComplexTransferAction,
  ComplexTransferApiParameters,
  ComplexTransferRun,
  ComplexTransferReflection,
  FixedChoiceRequest,
  GameAction,
  HealthResponse,
  InvestigatorReport,
  Participant,
  PlayerCase,
  PredictedClassExamples,
  PreviewRequest,
  PreviewResult,
  ResearchSession,
  ReclassifyRequest,
  ResponseRequest,
  StageRun,
} from './types'


const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ??
  'http://127.0.0.1:8000'

type ApiErrorPayload = {
  detail?: string
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response | null = null
  let lastNetworkError: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(`${API_BASE_URL}${path}`, init)
      break
    } catch (error) {
      lastNetworkError = error
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
  if (response === null) {
    throw new Error(`Cannot reach the game server at ${API_BASE_URL}. Check that the backend is running on the same port.` , { cause: lastNetworkError })
  }
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    try {
      const payload = (await response.json()) as ApiErrorPayload
      if (payload.detail) {
        message = payload.detail
      }
    } catch {
      // Keep the status-based fallback when the server does not return JSON.
    }
    throw new ApiError(message, response.status)
  }
  return (await response.json()) as T
}

function jsonRequest(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export function getHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/health')
}

export function createParticipant(
  request: CreateParticipantRequest,
): Promise<Participant> {
  return requestJson<Participant>(
    '/research/participants',
    jsonRequest('POST', request),
  )
}

export function createSession(
  request: CreateSessionRequest,
): Promise<ResearchSession> {
  return requestJson<ResearchSession>(
    '/research/sessions',
    jsonRequest('POST', request),
  )
}

export function getPlayerCase(caseId: string): Promise<PlayerCase> {
  return requestJson<PlayerCase>(`/game/cases/${encodeURIComponent(caseId)}`)
}

export function initializeComplexTransfer(sessionId: string): Promise<ComplexTransferRun> {
  return requestJson<ComplexTransferRun>(`/game/sessions/${encodeURIComponent(sessionId)}/complex-transfer`, jsonRequest('POST', {}))
}

export function previewComplexTransfer(stageRunId: string, selectedFactor: string, parameters: ComplexTransferApiParameters): Promise<{ image_url: string; parameters: ComplexTransferApiParameters }> {
  return requestJson(`/game/complex-transfer-runs/${encodeURIComponent(stageRunId)}/preview`, jsonRequest('POST', { selected_factor: selectedFactor, parameters }))
}

export function reclassifyComplexTransfer(stageRunId: string, request: { selected_factor: string; parameters: ComplexTransferApiParameters; prediction: string; prediction_reason?: string }): Promise<ComplexTransferAction> {
  return requestJson<ComplexTransferAction>(`/game/complex-transfer-runs/${encodeURIComponent(stageRunId)}/reclassify`, jsonRequest('POST', request))
}

export function getComplexTransferReflection(stageRunId: string): Promise<ComplexTransferReflection> {
  return requestJson<ComplexTransferReflection>(`/game/complex-transfer-runs/${encodeURIComponent(stageRunId)}/reflection`)
}

export function saveComplexTransferReflection(stageRunId: string, request: { learning_reflection: string; new_error_strategy: string }): Promise<ComplexTransferReflection> {
  return requestJson<ComplexTransferReflection>(
    `/game/complex-transfer-runs/${encodeURIComponent(stageRunId)}/reflection`,
    jsonRequest('POST', request),
  )
}

export function getPredictedClassExamples(label: string): Promise<PredictedClassExamples> {
  return requestJson<PredictedClassExamples>(
    `/game/predicted-classes/${encodeURIComponent(label)}/examples`,
  )
}

export function startStageRun(
  sessionId: string,
  caseId: string,
): Promise<StageRun> {
  return requestJson<StageRun>(
    `/research/sessions/${encodeURIComponent(sessionId)}/stage-runs`,
    jsonRequest('POST', { case_id: caseId }),
  )
}

export function applyFixedChoice(
  stageRunId: string,
  request: FixedChoiceRequest,
): Promise<GameAction> {
  return requestJson<GameAction>(
    `/game/stage-runs/${encodeURIComponent(stageRunId)}/apply-choice`,
    jsonRequest('POST', request),
  )
}

export function reclassifyRuntimeImage(stageRunId: string, request: ReclassifyRequest): Promise<GameAction> {
  return requestJson<GameAction>(
    `/game/stage-runs/${encodeURIComponent(stageRunId)}/reclassify`,
    jsonRequest('POST', request),
  )
}

export function applyVerifiedFallback(stageRunId: string): Promise<GameAction> {
  return requestJson<GameAction>(
    `/game/stage-runs/${encodeURIComponent(stageRunId)}/apply-fallback`,
    jsonRequest('POST', {}),
  )
}

export function previewRuntimeImage(stageRunId: string, request: PreviewRequest): Promise<PreviewResult> {
  return requestJson<PreviewResult>(
    `/game/stage-runs/${encodeURIComponent(stageRunId)}/preview`,
    jsonRequest('POST', request),
  )
}

export function saveStageResponse(
  stageRunId: string,
  request: ResponseRequest,
): Promise<unknown> {
  return requestJson(
    `/research/stage-runs/${encodeURIComponent(stageRunId)}/responses`,
    jsonRequest('POST', request),
  )
}

export function updateStageRun(stageRunId: string, completionStatus: 'completed' | 'exited'): Promise<StageRun> {
  return requestJson<StageRun>(
    `/research/stage-runs/${encodeURIComponent(stageRunId)}`,
    jsonRequest('PATCH', { completion_status: completionStatus }),
  )
}

export function completeStageRun(stageRunId: string): Promise<StageRun> {
  return updateStageRun(stageRunId, 'completed')
}

export function completeResearchSession(sessionId: string): Promise<ResearchSession> {
  return requestJson<ResearchSession>(
    `/research/sessions/${encodeURIComponent(sessionId)}`,
    jsonRequest('PATCH', { completion_status: 'completed' }),
  )
}

export function getInvestigatorReport(sessionId: string): Promise<InvestigatorReport> {
  return requestJson<InvestigatorReport>(`/research/sessions/${encodeURIComponent(sessionId)}/report`)
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path
  }
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}
