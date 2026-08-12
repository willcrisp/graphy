import dagre from '@dagrejs/dagre'
import type { TaskNodeData, GraphEdge } from './types'

/** Node dimensions are fixed and known before layout. Measuring the DOM would
 *  make layout asynchronous and visibly janky on app switch, so height is
 *  derived from the content instead. */
export const NODE_WIDTH = 260
const HEIGHT_BASE = 62 // status line + one title line
const HEIGHT_TITLE_LINE = 21 // each additional wrapped title line
const HEIGHT_DETAIL = 38 // two clamped lines of detail plus its gap
const TITLE_CHARS_PER_LINE = 26

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
 */
export function layoutGraph(
  nodes: TaskNodeData[],
  edges: GraphEdge[],
): Map<number, Positioned> {
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: 'LR', ranksep: 90, nodesep: 28, marginx: 24, marginy: 24 })
  graph.setDefaultEdgeLabel(() => ({}))

  const ordered = [...nodes].sort(
    (a, b) => a.sort_order - b.sort_order || a.id - b.id,
  )
  for (const node of ordered) {
    graph.setNode(String(node.id), { width: NODE_WIDTH, height: nodeHeight(node) })
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

  // Rank = layout column. Derived from x rather than read out of dagre's
  // internals, which are not part of its public API.
  const columns = [...new Set(raw.map((node) => Math.round(node.x)))].sort(
    (a, b) => a - b,
  )
  const rankOf = new Map(columns.map((x, index) => [x, index]))

  return new Map(
    raw.map((node) => [
      node.id,
      { ...node, rank: rankOf.get(Math.round(node.x)) ?? 0 },
    ]),
  )
}
