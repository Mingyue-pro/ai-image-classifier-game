import type {
  CreateParticipantRequest,
  CreateSessionRequest,
  HealthResponse,
  Participant,
  ResearchSession,
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
  const response = await fetch(`${API_BASE_URL}${path}`, init)
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
