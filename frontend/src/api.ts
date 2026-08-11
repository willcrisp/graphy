import type {
  AppConfig,
  AppSummary,
  FeatureNodeData,
  Graph,
  GraphEdge,
  Status,
} from './types'

/** Carries the server's own message so the UI can show what actually went
 *  wrong -- the cycle rejection in particular reads as a sentence, not a code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const FALLBACK: Record<number, string> = {
  401: 'Your session has expired. Sign in again.',
  403: 'This board is published read-only.',
  404: 'That item no longer exists. Refresh the page.',
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.')
  }

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: unknown }) => normaliseDetail(body.detail))
      .catch(() => undefined)
    throw new ApiError(
      response.status,
      detail ?? FALLBACK[response.status] ?? `Request failed (${response.status}).`,
    )
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** FastAPI returns a string for our own errors and a list of objects for
 *  schema validation failures. Flatten both to one readable sentence. */
function normaliseDetail(detail: unknown): string | undefined {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (typeof item?.msg === 'string' ? item.msg : null))
      .filter((msg): msg is string => Boolean(msg))
      .map((msg) => msg.replace(/^Value error,\s*/, ''))
    if (messages.length) return messages.join(' ')
  }
  return undefined
}

const json = (body: unknown): RequestInit['body'] => JSON.stringify(body)

export const getConfig = () => request<AppConfig>('/config')
export const getApps = () => request<AppSummary[]>('/apps')
export const getGraph = (key: string) => request<Graph>(`/apps/${key}/graph`)

export const login = (password: string) =>
  request<void>('/auth/login', { method: 'POST', body: json({ password }) })

export const logout = () => request<void>('/auth/logout', { method: 'POST' })

export const createNode = (
  key: string,
  body: { title: string; detail?: string | null; status: Status },
) => request<FeatureNodeData>(`/apps/${key}/nodes`, { method: 'POST', body: json(body) })

export const updateNode = (
  id: number,
  body: { title?: string; detail?: string | null; status?: Status },
) => request<FeatureNodeData>(`/nodes/${id}`, { method: 'PATCH', body: json(body) })

export const deleteNode = (id: number) =>
  request<void>(`/nodes/${id}`, { method: 'DELETE' })

export const createEdge = (key: string, source_id: number, target_id: number) =>
  request<GraphEdge>(`/apps/${key}/edges`, {
    method: 'POST',
    body: json({ source_id, target_id }),
  })

export const deleteEdge = (id: number) =>
  request<void>(`/edges/${id}`, { method: 'DELETE' })
