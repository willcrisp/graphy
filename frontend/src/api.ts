/** Typed fetch client. One function per endpoint, all routed through
 *  `request`, which prefixes `/api`, attaches cookies, and turns a non-2xx
 *  response into a thrown `ApiError` carrying the server's own message. */

import type {
  AppConfig,
  AppMutation,
  AppsPayload,
  AppSummary,
  Board,
  EdgeMutation,
  Graph,
  NodeMutation,
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

// Mutations return the whole board, not just the row they wrote. The client
// patches optimistically and reconciles against this, so one round trip is
// enough to get from a click to a correct redraw.

// App-level mutations answer with the tab strip rather than a board: a delete
// removes the board the caller was looking at, so there is nothing to redraw
// until the client has picked a different app.

export const createApp = (name: string) =>
  request<AppMutation>('/apps', { method: 'POST', body: json({ name }) })

export const renameApp = (key: string, name: string) =>
  request<AppMutation>(`/apps/${key}`, { method: 'PATCH', body: json({ name }) })

export const deleteApp = (key: string) =>
  request<AppsPayload>(`/apps/${key}`, { method: 'DELETE' })

export const createNode = (
  key: string,
  body: { title: string; detail?: string | null; status: Status },
) => request<NodeMutation>(`/apps/${key}/nodes`, { method: 'POST', body: json(body) })

export const updateNode = (
  id: number,
  body: { title?: string; detail?: string | null; status?: Status },
) => request<NodeMutation>(`/nodes/${id}`, { method: 'PATCH', body: json(body) })

export const deleteNode = (id: number) =>
  request<Board>(`/nodes/${id}`, { method: 'DELETE' })

export const createEdge = (key: string, source_id: number, target_id: number) =>
  request<EdgeMutation>(`/apps/${key}/edges`, {
    method: 'POST',
    body: json({ source_id, target_id }),
  })

export const deleteEdge = (id: number) =>
  request<Board>(`/edges/${id}`, { method: 'DELETE' })
