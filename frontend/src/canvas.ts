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
  Milestone,
  Overview,
  ParentProject,
  StatusCounts,
  TaskNodeData,
} from './types'

/** What a drawn node stands for.
 *
 *  - `task`  -- a row in `node`. Has a status, can be edited and connected.
 *  - `root`  -- also a row in `node` (`is_root`), standing for the app itself.
 *  - `parent` -- a row in `parent`, which is *not* a node at all. It exists
 *    only on the overview, where it is what several boards join to.
 *  - `milestone` -- a row in `milestone`, also not a node. Drawn as a rule
 *    across the whole sheet rather than a pill, and only ever on a board. */
export type NodeKind = 'task' | 'root' | 'parent' | 'milestone'

/** What a milestone's rule annotates, computed here rather than stored.
 *
 *  The tally is the point of drawing one at all: a line that only says "Q1"
 *  states an intention, a line that says "Q1 — 4 done, 2 in progress, 1
 *  blocked" answers the question the intention was asked about. */
export interface MilestoneMark {
  /** `YYYY-MM-DD`, or null for an undated line. */
  due_on: string | null
  /** Every task due by this line, by status. */
  counts: StatusCounts
  /** Its date has passed and something due by it is still unfinished. The one
   *  place the drawing raises its voice: a date nobody is going to make must
   *  not look the same as one that is on track. */
  overdue: boolean
}

export interface CanvasNode extends TaskNodeData {
  kind: NodeKind
  /** The accent of the board this node belongs to, or null when the canvas
   *  already carries one (a board page sets `--accent` on `.canvas`). The
   *  overview mixes boards, so there it travels per node instead. */
  accent: string | null
  /** Which board this node belongs to, for the overview's grouping cues.
   *  Null on a parent, which belongs to all of them and none of them. */
  appName: string | null
  /** Set on `kind: 'milestone'`, null on every other kind. */
  mark: MilestoneMark | null
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
  /** Constraints, not connections: handed to dagre and **never drawn**. This
   *  is what makes a milestone a rule rather than a caption -- a task due by
   *  Q1 cannot be laid out below the Q1 line, because there is an edge saying
   *  so. See `orderingEdgesOf`. */
  ordering: GraphEdge[]
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
const MILESTONE_NODE_BASE = -4_000_000_000
const MILESTONE_EDGE_BASE = -5_000_000_000

/** Each `is*NodeId` test is a bounded range, not just "below the base": with
 *  more than one synthetic node kind, an open-ended test would claim every
 *  decade under it as well. */
const inDecade = (id: number, base: number): boolean =>
  id <= base && id > base - 1_000_000_000

/** The canvas id of a parent project. Parent projects live in their own table
 *  and share no id space with nodes, so they have to be mapped into one. */
export const parentNodeId = (parentId: number): number => PARENT_NODE_BASE - parentId

/** Recover the parent project's real id from its canvas id. */
export const parentIdOf = (nodeId: number): number => PARENT_NODE_BASE - nodeId

export const isParentNodeId = (nodeId: number): boolean =>
  inDecade(nodeId, PARENT_NODE_BASE)

/** The canvas id of a milestone -- the same trick as `parentNodeId`, one
 *  decade further down. Milestones are their own table too. */
export const milestoneNodeId = (milestoneId: number): number =>
  MILESTONE_NODE_BASE - milestoneId

export const milestoneIdOf = (nodeId: number): number => MILESTONE_NODE_BASE - nodeId

export const isMilestoneNodeId = (nodeId: number): boolean =>
  inDecade(nodeId, MILESTONE_NODE_BASE)

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

/* --- milestones ------------------------------------------------------------
 *
 * A milestone is drawn as a rule across the sheet, but it is laid out as a
 * node: dagre gives it a rank like everything else, and `layout.ts` stretches
 * it to the drawing's width afterwards. That is the whole trick -- the line's
 * position is computed by the same pass that positions the tasks, so the two
 * cannot disagree about which side of it anything is on.
 */

/** The board's milestones in `position` order, with ties broken on id so the
 *  sequence is total even while the server is renumbering a reorder. */
const inOrder = (milestones: Milestone[]): Milestone[] =>
  [...milestones].sort((a, b) => a.position - b.position || a.id - b.id)

/** The invisible edges that hold a task on its own side of a rule.
 *
 * For milestones `m0 … mk` in order, and a task due by `mi`:
 *
 *   - `task -> mi`        the task ranks above its own line
 *   - `m(i-1) -> task`    and below the one before it
 *   - `mi -> m(i+1)`      the lines themselves stay in order
 *   - `root -> m0`        and all of them below the sheet's own name
 *
 * A task with `milestone_id: null` gets none of these and floats wherever its
 * dependencies put it. That is deliberate: it means adding a first milestone
 * to a board full of undated work changes nothing until the work is dated, so
 * the feature can be adopted a task at a time rather than all at once.
 *
 * These are constraints, not connections -- `Graph.tsx` passes them to
 * `layoutGraph` and to nothing else. Drawing them would be drawing the same
 * fact twice, once as a line and once as an arrow.
 */
export function orderingEdgesOf(
  nodes: Pick<TaskNodeData, 'id' | 'app_id' | 'is_root' | 'milestone_id'>[],
  milestones: Milestone[],
): GraphEdge[] {
  const ordered = inOrder(milestones)
  if (!ordered.length) return []

  const appId = ordered[0].app_id
  const rankOf = new Map(ordered.map((milestone, index) => [milestone.id, index]))
  const edges: GraphEdge[] = []
  let nextId = MILESTONE_EDGE_BASE

  const join = (source: number, target: number) =>
    edges.push({ id: nextId--, app_id: appId, source_id: source, target_id: target })

  const root = nodes.find((node) => node.is_root && node.app_id === appId)
  if (root) join(root.id, milestoneNodeId(ordered[0].id))
  for (let index = 1; index < ordered.length; index += 1) {
    join(milestoneNodeId(ordered[index - 1].id), milestoneNodeId(ordered[index].id))
  }

  for (const node of nodes) {
    if (node.milestone_id === null || node.is_root) continue
    const rank = rankOf.get(node.milestone_id)
    if (rank === undefined) continue
    join(node.id, milestoneNodeId(node.milestone_id))
    if (rank > 0) join(milestoneNodeId(ordered[rank - 1].id), node.id)
  }
  return edges
}

/** Tally the work due by one line, and decide whether it has slipped.
 *
 *  "Overdue" is deliberately strict about *unfinished*, not about *late*: a
 *  milestone whose date has passed with everything above it done is a
 *  milestone that was met, and it should read as calm. */
function markOf(milestone: Milestone, nodes: TaskNodeData[], today: string): MilestoneMark {
  const counts: StatusCounts = { done: 0, wip: 0, todo: 0, blocked: 0 }
  for (const node of nodes) {
    if (!node.is_root && node.milestone_id === milestone.id) counts[node.status] += 1
  }
  const unfinished = counts.wip + counts.todo + counts.blocked
  return {
    due_on: milestone.due_on,
    counts,
    // String comparison is exact for ISO dates and needs no Date parsing, which
    // would drag the viewer's timezone into a question about a calendar day.
    overdue: milestone.due_on !== null && milestone.due_on < today && unfinished > 0,
  }
}

/** A milestone as the canvas sees it. Most of `TaskNodeData` is filler here for
 *  the same reason it is on a parent project -- a rule has no status, no detail
 *  and no connections -- and `MilestoneNode.tsx` reads only `title` and `mark`. */
function milestoneNode(
  milestone: Milestone,
  nodes: TaskNodeData[],
  today: string,
): CanvasNode {
  return {
    id: milestoneNodeId(milestone.id),
    app_id: milestone.app_id,
    title: milestone.label,
    detail: null,
    status: 'todo',
    external_ref: null,
    milestone_id: null,
    is_root: false,
    sort_order: milestone.position,
    created_at: milestone.created_at,
    updated_at: milestone.updated_at,
    kind: 'milestone',
    accent: null,
    appName: null,
    mark: markOf(milestone, nodes, today),
  }
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
    milestone_id: null,
    is_root: false,
    sort_order: parent.sort_order,
    created_at: parent.created_at,
    updated_at: parent.updated_at,
    kind: 'parent',
    accent: null,
    appName: null,
    mark: null,
  }
}

/** One board. The canvas already carries that board's accent, so nodes do not
 *  need to.
 *
 *  `today` is passed rather than read from the clock so the whole module stays
 *  pure and testable; `App.tsx` supplies the real one. */
export function buildBoard(graph: Graph, today = new Date().toISOString().slice(0, 10)): CanvasGraph {
  const nodes: CanvasNode[] = [
    ...graph.milestones.map((milestone) => milestoneNode(milestone, graph.nodes, today)),
    ...graph.nodes.map((node) => ({
      ...node,
      kind: (node.is_root ? 'root' : 'task') as NodeKind,
      accent: null,
      appName: graph.app.name,
      mark: null,
    })),
  ]
  return {
    key: graph.app.key,
    nodes,
    edges: graph.edges,
    structural: rootEdgesOf(graph.nodes, graph.edges),
    ordering: orderingEdgesOf(graph.nodes, graph.milestones),
    // The root always exists, so "empty" means no real tasks under it rather
    // than literally no nodes. A board with milestones and no work is still
    // empty -- a calendar with nothing on it has nothing to show.
    empty: !nodes.some((node) => node.kind === 'task'),
  }
}

/** Every board at once, joined by their parent projects.
 *
 *  Deliberately no milestones. A rule is a line across *a sheet*, and this page
 *  draws six sheets side by side -- one board's Q1 stretched over all of them
 *  would cut through five other calendars it says nothing about. Boards keep
 *  their own dates; the overview is only ever about the structure between
 *  them. */
export function buildOverview(overview: Overview): CanvasGraph {
  const appById = new Map(overview.apps.map((app) => [app.id, app]))
  const nodes: CanvasNode[] = [
    ...overview.parents.map(parentNode),
    ...overview.nodes.map((node) => ({
      ...node,
      kind: (node.is_root ? 'root' : 'task') as NodeKind,
      accent: appById.get(node.app_id)?.accent ?? null,
      appName: appById.get(node.app_id)?.name ?? null,
      mark: null,
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
    ordering: [],
    // Never empty: a board with no tasks still contributes its root, and that
    // row of roots plus whatever joins them is exactly what this page is for.
    empty: false,
  }
}
