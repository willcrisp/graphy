/** Local application of a mutation, so the board redraws on the click rather
 *  than a round trip later.
 *
 *  Everything here is pure: `(graph, change) -> graph`. The server stays the
 *  authority — `App.tsx` replaces the whole graph with the mutation response
 *  when it lands, and restores the previous one if it fails. These functions
 *  only have to be right about the shape of the result, not durable.
 *
 *  The one rule worth stating: **these must mirror the service layer's
 *  behaviour, not guess at it.** Deleting a node cascades its edges and does
 *  not reparent its children, exactly as `services/graph.py` does, because a
 *  divergence shows up as the board visibly changing twice.
 */

import type {
  AppSummary,
  Graph,
  GraphEdge,
  Status,
  StatusCounts,
  TaskNodeData,
} from './types'

/** Rows that exist only on the client carry a negative id. Real ids are
 *  SQLite rowids and always positive, so the two can never collide, and any
 *  code that leaks a temp id to the API gets an obvious 404 rather than
 *  silently editing row 1. */
let lastTempId = 0

export function tempId(): number {
  lastTempId -= 1
  return lastTempId
}

export const isTempId = (id: number): boolean => id < 0

const now = () => new Date().toISOString()

export function countsOf(nodes: TaskNodeData[]): StatusCounts {
  // Every status is present at zero: the tab strip renders all four, and an
  // absent key would read as a missing count rather than none.
  const counts: StatusCounts = { done: 0, wip: 0, todo: 0, blocked: 0 }
  for (const node of nodes) counts[node.status] += 1
  return counts
}

/** Re-tally the active app's entry in the tab strip. The other apps cannot
 *  have changed -- a mutation only ever touches one board. */
export function withCounts(apps: AppSummary[], graph: Graph): AppSummary[] {
  const counts = countsOf(graph.nodes)
  return apps.map((app) => (app.id === graph.app.id ? { ...app, counts } : app))
}

/** Build the row a create will produce, without inserting it. Split from
 *  `insertNode` so the caller holds the temp id -- it needs it to select the
 *  new feature -- while the function it hands to the patcher stays pure. */
export function draftNode(
  graph: Graph,
  fields: { title: string; detail?: string | null; status: Status },
): TaskNodeData {
  const stamp = now()
  return {
    id: tempId(),
    app_id: graph.app.id,
    title: fields.title,
    detail: fields.detail ?? null,
    status: fields.status,
    // Matches `create_node`: highest sort_order on the app, plus one. Layout
    // order depends on this, so a wrong guess would move the node on reconcile.
    sort_order: Math.max(0, ...graph.nodes.map((n) => n.sort_order)) + 1,
    created_at: stamp,
    updated_at: stamp,
  }
}

export function insertNode(graph: Graph, node: TaskNodeData): Graph {
  return {
    ...graph,
    nodes: [...graph.nodes, node],
    last_updated: node.updated_at,
  }
}

export function patchNode(
  graph: Graph,
  id: number,
  changes: { title?: string; detail?: string | null; status?: Status },
): Graph {
  const stamp = now()
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === id ? { ...node, ...changes, updated_at: stamp } : node,
    ),
    last_updated: stamp,
  }
}

export function removeNode(graph: Graph, id: number): Graph {
  const nodes = graph.nodes.filter((node) => node.id !== id)
  return {
    ...graph,
    nodes,
    // The database cascades these. Children are deliberately not reparented;
    // they become roots of the layout.
    edges: graph.edges.filter(
      (edge) => edge.source_id !== id && edge.target_id !== id,
    ),
    last_updated: lastUpdated(nodes),
  }
}

export function insertEdge(
  graph: Graph,
  source_id: number,
  target_id: number,
): Graph {
  const edge: GraphEdge = {
    id: tempId(),
    app_id: graph.app.id,
    source_id,
    target_id,
  }
  return { ...graph, edges: [...graph.edges, edge] }
}

export function removeEdge(graph: Graph, id: number): Graph {
  return { ...graph, edges: graph.edges.filter((edge) => edge.id !== id) }
}

function lastUpdated(nodes: TaskNodeData[]): string | null {
  return nodes.reduce<string | null>(
    (latest, node) =>
      latest === null || node.updated_at > latest ? node.updated_at : latest,
    null,
  )
}
