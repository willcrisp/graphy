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

/** How far apart the tree is drawn. A reader's choice, not the board's: it is
 *  never stored on the server and never leaves this browser, because it says
 *  nothing about the plan -- only about the screen it is being read on. A
 *  laptop wants the whole board at once, a wall display wants room to breathe.
 *
 *  Ordered loosest-last so the toggle can render it in this order and a future
 *  step slots in without the option row having to be re-sorted by hand. */
export const SPACINGS = ['tight', 'normal', 'wide'] as const
export type Spacing = (typeof SPACINGS)[number]

export const DEFAULT_SPACING: Spacing = 'normal'

/** dagre's gaps: `ranksep` between rows, `nodesep` between siblings within one.
 *
 *  Both are scaled together so the drawing keeps its proportions -- pulling the
 *  rows in without the columns would make a wide board read as a stack of
 *  unrelated rows. `normal` is the pair the board was designed at; the other two
 *  are that pair scaled, so retuning the default retunes all three.
 *
 *  `tight` does not go below the edge arrowhead plus its curve (about 40px of
 *  rank gap), or the marker collides with the node it points at. */
const RANKSEP = 110
const NODESEP = 64
const SCALE: Record<Spacing, number> = { tight: 0.55, normal: 1, wide: 1.7 }

export function separationOf(spacing: Spacing): { ranksep: number; nodesep: number } {
  const scale = SCALE[spacing] ?? SCALE[DEFAULT_SPACING]
  return { ranksep: Math.round(RANKSEP * scale), nodesep: Math.round(NODESEP * scale) }
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
 *
 * `spacing` only widens or narrows the gaps between nodes -- it never changes
 * which node sits above which, so a board keeps its shape as the reader opens
 * it out.
 */
export function layoutGraph(
  nodes: TaskNodeData[],
  edges: GraphEdge[],
  spacing: Spacing = DEFAULT_SPACING,
): Map<number, Positioned> {
  const { ranksep, nodesep } = separationOf(spacing)
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: 'TB', ranksep, nodesep, marginx: 48, marginy: 48 })
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
