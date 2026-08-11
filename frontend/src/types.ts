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

export interface FeatureNodeData {
  id: number
  app_id: number
  title: string
  detail: string | null
  status: Status
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
  nodes: FeatureNodeData[]
  edges: GraphEdge[]
  last_updated: string | null
}

export interface AppConfig {
  readonly: boolean
  authenticated: boolean
}
