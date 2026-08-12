import dagre from '@dagrejs/dagre'
import type { TaskNodeData, GraphEdge } from './types'

/** Node dimensions are fixed and known before layout. Measuring the DOM would
 *  make layout asynchronous and visibly janky on app switch, so both are
 *  derived from the title instead.
 *
 *  A node is a single glyph-plus-label pill with no detail shown inline
 *  (app.css hides it), so height is constant and width just has to hug the
 *  label -- there is no wrapping to account for.
 *
 *  There is deliberately no upper bound on the width: a label is never
 *  truncated, so the box grows to whatever the title needs. A long title makes
 *  a wide node, which is the intended trade. */
export const NODE_HEIGHT = 28
/** Montserrat 600 at 13px, uppercased and tracked 0.08em, measured across the
 *  seeded titles: 8.9px per character at the narrowest, 10.5px at the widest.
 *  The widest is the right constant to carry -- overshooting only leaves slack
 *  around a title that app.css centres anyway (and keeps the glyph's gap
 *  exact regardless), whereas undershooting clips a label that had room.
 *  Re-measure if the label's face, size or tracking changes. */
const CHAR_WIDTH = 10.5
/** Twice the glyph slot plus its gap (13 + 8): once for the glyph itself, once
 *  for the right padding app.css adds to cancel it so the title centres on the
 *  handle axis. Both halves live in `--glyph-slot` / `--s2` there. */
const PADDING = 42
const MIN_WIDTH = 84

export function nodeWidth(title: string): number {
  const raw = PADDING + title.length * CHAR_WIDTH
  return Math.max(MIN_WIDTH, Math.round(raw))
}

export interface Positioned {
  id: number
  x: number
  y: number
  width: number
  height: number
  /** Dagre rank (layout row). Drives the staggered entry animation. */
  rank: number
}

/**
 * Run dagre over the graph and return absolute top-left positions.
 *
 * `edges` must be *every* edge that gets drawn, including the computed ones
 * (`canvas.ts`'s `rootEdgesOf` / `parentEdgesOf`). Layout and drawing have to
 * agree about which connections exist, so both take the same list rather than
 * each deriving its own.
 *
 * Nodes are fed in `app_id`, then `sort_order`, then `id` order, and edges in
 * `id` order, so a given graph always lays out identically -- stability across
 * reloads is a requirement, and dagre's output depends on insertion order.
 * `app_id` leads because the overview draws every board at once: without it,
 * six boards' `sort_order`s interleave and dagre shuffles the clusters
 * together. On a single board every `app_id` is equal, so it changes nothing.
 */
export function layoutGraph(
  nodes: TaskNodeData[],
  edges: GraphEdge[],
): Map<number, Positioned> {
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: 'TB', ranksep: 110, nodesep: 64, marginx: 48, marginy: 48 })
  graph.setDefaultEdgeLabel(() => ({}))

  const ordered = [...nodes].sort(
    (a, b) => a.app_id - b.app_id || a.sort_order - b.sort_order || a.id - b.id,
  )
  for (const node of ordered) {
    graph.setNode(String(node.id), { width: nodeWidth(node.title), height: NODE_HEIGHT })
  }

  const present = new Set(ordered.map((node) => node.id))
  for (const edge of [...edges].sort((a, b) => a.id - b.id)) {
    if (present.has(edge.source_id) && present.has(edge.target_id)) {
      graph.setEdge(String(edge.source_id), String(edge.target_id))
    }
  }

  dagre.layout(graph)

  // Dagre reports centres; React Flow positions by top-left corner.
  const raw = ordered.map((node) => {
    const laid = graph.node(String(node.id)) as {
      x: number
      y: number
      width: number
      height: number
    }
    return {
      id: node.id,
      x: laid.x - laid.width / 2,
      y: laid.y - laid.height / 2,
      width: laid.width,
      height: laid.height,
    }
  })

  // Rank = layout row, i.e. position along the axis dagre ranks on -- y, since
  // the graph runs top-to-bottom. Derived from the coordinate rather than read
  // out of dagre's internals, which are not part of its public API.
  const axis = (node: (typeof raw)[number]) => node.y
  const rows = [...new Set(raw.map((node) => Math.round(axis(node))))].sort(
    (a, b) => a - b,
  )
  const rankOf = new Map(rows.map((value, index) => [value, index]))

  return new Map(
    raw.map((node) => [
      node.id,
      { ...node, rank: rankOf.get(Math.round(axis(node))) ?? 0 },
    ]),
  )
}
