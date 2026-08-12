/** Shapes shared between the API client (`api.ts`), the optimistic patcher
 *  (`optimistic.ts`), and every component. Mirrors `schemas.py` field for
 *  field -- if a response shape changes on the backend, this is the first
 *  place to update, and the compiler will point at everything downstream
 *  that needs to follow. */

export const STATUSES = ['done', 'wip', 'todo', 'blocked'] as const
export type Status = (typeof STATUSES)[number]

/** Shown on the node and in the panel. Status must never be colour-only. */
export const STATUS_LABEL: Record<Status, string> = {
  done: 'Done',
  wip: 'In progress',
  todo: 'Planned',
  blocked: 'Blocked',
}

/** A drafting-mark glyph per status, so the marker reads without colour. */
export const STATUS_GLYPH: Record<Status, string> = {
  done: '■', // filled square
  wip: '◧', // half-filled square
  todo: '□', // open square
  blocked: '◆', // filled diamond
}

export interface StatusCounts {
  done: number
  wip: number
  todo: number
  blocked: number
}

/** The one place that sums a `StatusCounts` -- the tab strip, the delete-app
 *  confirmation, and the title block all need "how many tasks", and summing
 *  the four fields by hand in three places is exactly the kind of thing that
 *  silently drifts if a fifth status is ever added. */
export const totalOf = (counts: StatusCounts): number =>
  STATUSES.reduce((sum, status) => sum + counts[status], 0)

export interface AppInfo {
  id: number
  key: string
  name: string
  accent: string
  sort_order: number
}

export interface AppSummary extends AppInfo {
  counts: StatusCounts
}

/** App-level mutations answer with the whole strip: after a delete the active
 *  board may be gone, so the client cannot patch a single entry. */
export interface AppsPayload {
  apps: AppSummary[]
}

export interface AppMutation extends AppsPayload {
  app: AppInfo
}

export interface TaskNodeData {
  id: number
  app_id: number
  title: string
  detail: string | null
  status: Status
  /** Opaque id from whatever external system created this task (e.g. a Jira
   *  key). Set by an importer, never by the UI -- read-only here. */
  external_ref: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface GraphEdge {
  id: number
  app_id: number
  source_id: number
  target_id: number
}

export interface Graph {
  app: AppInfo
  nodes: TaskNodeData[]
  edges: GraphEdge[]
  last_updated: string | null
}

/** What every mutating endpoint returns: enough to redraw without a re-fetch.
 *  `apps` rides along because the tab counts move whenever a node does. */
export interface Board {
  graph: Graph
  apps: AppSummary[]
}

export interface NodeMutation extends Board {
  node: TaskNodeData
}

export interface EdgeMutation extends Board {
  edge: GraphEdge
}

export interface AppConfig {
  readonly: boolean
  authenticated: boolean
}
