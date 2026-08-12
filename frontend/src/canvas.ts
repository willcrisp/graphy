/** What the canvas draws, derived from what the server sent.
 *
 *  Two pages feed the same React Flow canvas: one board (`/a/{key}`) and the
 *  overview of every board at once (`/all`). Rather than teaching `Graph.tsx`
 *  about both shapes, each is flattened here into one `CanvasGraph` and the
 *  canvas only ever sees that.
 *
 *  Everything in this module is pure and separately tested, for the same
 *  reason `optimistic.ts` is: it encodes rules that have to match the server's
 *  (which node is a root, which board hangs off which parent), and a
 *  divergence shows up as a drawing that quietly disagrees with the data.
 */

import type {
  AppSummary,
  Graph,
  GraphEdge,
  Overview,
  ParentProject,
  TaskNodeData,
} from './types'

/** What a drawn node stands for.
 *
 *  - `task`  -- a row in `node`. Has a status, can be edited and connected.
 *  - `root`  -- also a row in `node` (`is_root`), standing for the app itself.
 *  - `parent` -- a row in `parent`, which is *not* a node at all. It exists
 *    only on the overview, where it is what several boards join to. */
export type NodeKind = 'task' | 'root' | 'parent'

export interface CanvasNode extends TaskNodeData {
  kind: NodeKind
  /** The accent of the board this node belongs to, or null when the canvas
   *  already carries one (a board page sets `--accent` on `.canvas`). The
   *  overview mixes boards, so there it travels per node instead. */
  accent: string | null
  /** Which board this node belongs to, for the overview's grouping cues.
   *  Null on a parent, which belongs to all of them and none of them. */
  appName: string | null
}

export interface CanvasGraph {
  /** Identity of what is being drawn. `Graph.tsx` re-frames the viewport when
   *  this changes, so it must be the page, not the contents -- adding a task
   *  should not yank the viewport around. */
  key: string
  nodes: CanvasNode[]
  /** Stored edges: selectable, right-clickable, deletable. */
  edges: GraphEdge[]
  /** Computed joins, drawn quieter and inert -- no menu, no selection, nothing
   *  to delete, because there is no row behind them to delete. */
  structural: GraphEdge[]
  /** Whether to offer the "nothing here yet" state instead of the canvas. */
  empty: boolean
}

/* --- synthetic ids ---------------------------------------------------------
 *
 * Nodes and edges that exist only on the client carry ids far below anything
 * the server or `optimistic.tempId()` can produce (real ids are SQLite rowids
 * and always positive; temp ids count down from -1). Each kind gets its own
 * decade so an id says what it is, and so two kinds can never collide.
 */

const ROOT_EDGE_BASE = -1_000_000_000
const PARENT_NODE_BASE = -2_000_000_000
const PARENT_EDGE_BASE = -3_000_000_000

/** The canvas id of a parent project. Parent projects live in their own table
 *  and share no id space with nodes, so they have to be mapped into one. */
export const parentNodeId = (parentId: number): number => PARENT_NODE_BASE - parentId

/** Recover the parent project's real id from its canvas id. */
export const parentIdOf = (nodeId: number): number => PARENT_NODE_BASE - nodeId

export const isParentNodeId = (nodeId: number): boolean => nodeId <= PARENT_NODE_BASE

/** The root node has no stored edges (`services/graph.py` refuses to wire it
 *  by hand). Instead every node with no incoming edge is one of its top-level
 *  tasks, computed fresh on each render rather than stored.
 *
 *  Grouped by app, because the overview draws several boards at once and a
 *  task must hang off *its own* board's root. */
export function rootEdgesOf(
  nodes: Pick<TaskNodeData, 'id' | 'app_id' | 'is_root'>[],
  edges: GraphEdge[],
): GraphEdge[] {
  const rootOfApp = new Map<number, number>()
  for (const node of nodes) if (node.is_root) rootOfApp.set(node.app_id, node.id)
  const hasParent = new Set(edges.map((edge) => edge.target_id))

  return nodes.flatMap((node) => {
    if (node.is_root || hasParent.has(node.id)) return []
    const root = rootOfApp.get(node.app_id)
    if (root === undefined) return []
    return [
      { id: ROOT_EDGE_BASE - node.id, app_id: node.app_id, source_id: root, target_id: node.id },
    ]
  })
}

/** The joins the overview exists to draw: each board that has a parent project
 *  hangs off it, and several boards hanging off the same one is the point.
 *  A board with `parent_id: null` is left as a top-level cluster. */
export function parentEdgesOf(
  apps: AppSummary[],
  nodes: Pick<TaskNodeData, 'id' | 'app_id' | 'is_root'>[],
): GraphEdge[] {
  const rootOfApp = new Map<number, number>()
  for (const node of nodes) if (node.is_root) rootOfApp.set(node.app_id, node.id)

  return apps.flatMap((app) => {
    const root = rootOfApp.get(app.id)
    if (app.parent_id === null || root === undefined) return []
    return [
      {
        id: PARENT_EDGE_BASE - app.id,
        app_id: app.id,
        source_id: parentNodeId(app.parent_id),
        target_id: root,
      },
    ]
  })
}

/** A parent project as the canvas sees it. Status is filler and never drawn --
 *  a parent project has none, which is the whole reason it is its own table
 *  rather than another node. */
function parentNode(parent: ParentProject): CanvasNode {
  return {
    id: parentNodeId(parent.id),
    // Not any board's: `app_id: 0` sorts it ahead of every real app in
    // `layoutGraph`, which is where it belongs -- above all of them.
    app_id: 0,
    title: parent.name,
    detail: parent.detail,
    status: 'todo',
    external_ref: null,
    is_root: false,
    sort_order: parent.sort_order,
    created_at: parent.created_at,
    updated_at: parent.updated_at,
    kind: 'parent',
    accent: null,
    appName: null,
  }
}

/** One board. The canvas already carries that board's accent, so nodes do not
 *  need to. */
export function buildBoard(graph: Graph): CanvasGraph {
  const nodes: CanvasNode[] = graph.nodes.map((node) => ({
    ...node,
    kind: node.is_root ? 'root' : 'task',
    accent: null,
    appName: graph.app.name,
  }))
  return {
    key: graph.app.key,
    nodes,
    edges: graph.edges,
    structural: rootEdgesOf(graph.nodes, graph.edges),
    // The root always exists, so "empty" means no real tasks under it rather
    // than literally no nodes.
    empty: !nodes.some((node) => node.kind === 'task'),
  }
}

/** Every board at once, joined by their parent projects. */
export function buildOverview(overview: Overview): CanvasGraph {
  const appById = new Map(overview.apps.map((app) => [app.id, app]))
  const nodes: CanvasNode[] = [
    ...overview.parents.map(parentNode),
    ...overview.nodes.map((node) => ({
      ...node,
      kind: (node.is_root ? 'root' : 'task') as NodeKind,
      accent: appById.get(node.app_id)?.accent ?? null,
      appName: appById.get(node.app_id)?.name ?? null,
    })),
  ]
  return {
    key: 'overview',
    nodes,
    edges: overview.edges,
    structural: [
      ...rootEdgesOf(overview.nodes, overview.edges),
      ...parentEdgesOf(overview.apps, overview.nodes),
    ],
    // Never empty: a board with no tasks still contributes its root, and that
    // row of roots plus whatever joins them is exactly what this page is for.
    empty: false,
  }
}
