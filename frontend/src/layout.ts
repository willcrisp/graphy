import dagre from '@dagrejs/dagre'
import type { GraphStyle } from './graphStyle'
import type { TaskNodeData, GraphEdge } from './types'

/** Node dimensions are fixed and known before layout. Measuring the DOM would
 *  make layout asynchronous and visibly janky on app switch, so height is
 *  derived from the content instead. */
export const NODE_WIDTH = 260
const HEIGHT_BASE = 62 // status line + one title line
const HEIGHT_TITLE_LINE = 21 // each additional wrapped title line
const HEIGHT_DETAIL = 38 // two clamped lines of detail plus its gap
const TITLE_CHARS_PER_LINE = 26

/** Neptune nodes are a single glyph-plus-label pill with no detail shown
 *  inline (app.css hides it), so height is constant and width just has to
 *  hug the label -- there is no wrapping to account for. */
export const NEPTUNE_NODE_HEIGHT = 28
const NEPTUNE_CHAR_WIDTH = 6.5
const NEPTUNE_PADDING = 36
const NEPTUNE_MIN_WIDTH = 84
const NEPTUNE_MAX_WIDTH = 220

export function neptuneNodeWidth(title: string): number {
  const raw = NEPTUNE_PADDING + title.length * NEPTUNE_CHAR_WIDTH
  return Math.min(NEPTUNE_MAX_WIDTH, Math.max(NEPTUNE_MIN_WIDTH, Math.round(raw)))
}

export interface Positioned {
  id: number
  x: number
  y: number
  width: number
  height: number
  /** Dagre rank (layout column). Drives the left-to-right stagger on entry. */
  rank: number
}

export function nodeHeight(node: Pick<TaskNodeData, 'title' | 'detail'>): number {
  const titleLines = Math.max(1, Math.ceil(node.title.length / TITLE_CHARS_PER_LINE))
  return (
    HEIGHT_BASE +
    (titleLines - 1) * HEIGHT_TITLE_LINE +
    (node.detail ? HEIGHT_DETAIL : 0)
  )
}

/**
 * Run dagre over the graph and return absolute top-left positions.
 *
 * Nodes are fed in `sort_order` then `id` order, and edges in `id` order, so a
 * given graph always lays out identically -- stability across reloads is a
 * requirement, and dagre's output depends on insertion order.
 *
 * `style` only changes the numbers fed to dagre (direction, spacing, node
 * dimensions) -- it never touches what gets drawn. That happens in app.css,
 * gated on the same `data-graph-style` attribute this value comes from.
 */
export function layoutGraph(
  nodes: TaskNodeData[],
  edges: GraphEdge[],
  style: GraphStyle = 'blueprint',
): Map<number, Positioned> {
  const vertical = style === 'neptune'
  const graph = new dagre.graphlib.Graph()
  graph.setGraph(
    vertical
      ? { rankdir: 'TB', ranksep: 110, nodesep: 64, marginx: 48, marginy: 48 }
      : { rankdir: 'LR', ranksep: 90, nodesep: 28, marginx: 24, marginy: 24 },
  )
  graph.setDefaultEdgeLabel(() => ({}))

  const ordered = [...nodes].sort(
    (a, b) => a.sort_order - b.sort_order || a.id - b.id,
  )
  for (const node of ordered) {
    const dims = vertical
      ? { width: neptuneNodeWidth(node.title), height: NEPTUNE_NODE_HEIGHT }
      : { width: NODE_WIDTH, height: nodeHeight(node) }
    graph.setNode(String(node.id), dims)
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

  // Rank = layout column, i.e. position along whichever axis dagre ranks on --
  // x for a left-to-right graph, y for a top-to-bottom one. Derived from the
  // coordinate rather than read out of dagre's internals, which are not part
  // of its public API.
  const axis = (node: (typeof raw)[number]) => (vertical ? node.y : node.x)
  const columns = [...new Set(raw.map((node) => Math.round(axis(node))))].sort(
    (a, b) => a - b,
  )
  const rankOf = new Map(columns.map((value, index) => [value, index]))

  return new Map(
    raw.map((node) => [
      node.id,
      { ...node, rank: rankOf.get(Math.round(axis(node))) ?? 0 },
    ]),
  )
}
