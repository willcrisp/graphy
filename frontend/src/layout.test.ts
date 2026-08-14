import { describe, expect, it } from 'vitest'
import { NODE_HEIGHT, SPACINGS, layoutGraph, nodeWidth, separationOf } from './layout'
import type { TaskNodeData, GraphEdge, Status } from './types'

let nextId = 1

function node(title: string, detail: string | null = null): TaskNodeData {
  const id = nextId++
  return {
    id,
    app_id: 1,
    title,
    detail,
    status: 'todo' as Status,
    external_ref: null,
    is_root: false,
    sort_order: id,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function edge(source: TaskNodeData, target: TaskNodeData, id = nextId++): GraphEdge {
  return { id, app_id: 1, source_id: source.id, target_id: target.id }
}

describe('nodeWidth', () => {
  it('grows with the label and never caps it', () => {
    expect(nodeWidth('AB')).toBeLessThan(nodeWidth('A much longer task title'))
    expect(nodeWidth('')).toBeGreaterThanOrEqual(84)
    // No upper clamp: a long title must get a box wide enough to show it all,
    // because nothing downstream truncates.
    expect(nodeWidth('X'.repeat(200))).toBeGreaterThan(200 * 10)
  })
})

describe('layoutGraph ordering', () => {
  it('stacks a dependency below its dependant', () => {
    const a = node('A')
    const b = node('B')
    const positions = layoutGraph([a, b], [edge(a, b)])
    expect(positions.get(a.id)!.y).toBeLessThan(positions.get(b.id)!.y)
  })

  it('assigns increasing ranks along a chain', () => {
    const [a, b, c] = [node('A'), node('B'), node('C')]
    const positions = layoutGraph([a, b, c], [edge(a, b), edge(b, c)])
    expect(positions.get(a.id)!.rank).toBe(0)
    expect(positions.get(b.id)!.rank).toBe(1)
    expect(positions.get(c.id)!.rank).toBe(2)
  })

  it('puts siblings in the same rank but separated horizontally', () => {
    const [root, left, right] = [node('root'), node('left'), node('right')]
    const positions = layoutGraph([root, left, right], [edge(root, left), edge(root, right)])
    const l = positions.get(left.id)!
    const r = positions.get(right.id)!
    expect(l.rank).toBe(r.rank)
    expect(Math.abs(l.x - r.x)).toBeGreaterThanOrEqual(28)
  })

  it('collapses a diamond so the join sits past both arms', () => {
    const [top, left, right, bottom] = [node('t'), node('l'), node('r'), node('b')]
    const positions = layoutGraph(
      [top, left, right, bottom],
      [edge(top, left), edge(top, right), edge(left, bottom), edge(right, bottom)],
    )
    const join = positions.get(bottom.id)!
    expect(join.rank).toBeGreaterThan(positions.get(left.id)!.rank)
    expect(join.rank).toBeGreaterThan(positions.get(right.id)!.rank)
    expect(positions.get(left.id)!.rank).toBe(positions.get(right.id)!.rank)
  })

  it('is stable: the same input lays out identically every time', () => {
    const [a, b, c, d] = [node('A'), node('B'), node('C'), node('D')]
    const nodes = [a, b, c, d]
    const edges = [edge(a, b), edge(a, c), edge(b, d), edge(c, d)]
    const first = layoutGraph(nodes, edges)
    const second = layoutGraph([...nodes].reverse(), [...edges].reverse())
    for (const id of nodes.map((n) => n.id)) {
      expect(second.get(id)).toEqual(first.get(id))
    }
  })

  it('lays out disconnected nodes without dropping any', () => {
    const nodes = [node('lonely'), node('also lonely'), node('third')]
    const positions = layoutGraph(nodes, [])
    expect(positions.size).toBe(3)
    for (const n of nodes) expect(positions.get(n.id)!.height).toBe(NODE_HEIGHT)
  })

  it('ignores edges pointing at nodes that are not in the set', () => {
    const a = node('A')
    const dangling: GraphEdge = { id: 99, app_id: 1, source_id: a.id, target_id: 4242 }
    expect(() => layoutGraph([a], [dangling])).not.toThrow()
    expect(layoutGraph([a], [dangling]).size).toBe(1)
  })

  it('returns an empty map for an empty app', () => {
    expect(layoutGraph([], []).size).toBe(0)
  })
})

describe('spacing', () => {
  it('widens both gaps together, in the order the options are offered', () => {
    const gaps = SPACINGS.map(separationOf)
    for (let i = 1; i < gaps.length; i += 1) {
      expect(gaps[i].ranksep).toBeGreaterThan(gaps[i - 1].ranksep)
      expect(gaps[i].nodesep).toBeGreaterThan(gaps[i - 1].nodesep)
    }
  })

  it('keeps the tightest rank gap clear of the arrowhead', () => {
    expect(separationOf('tight').ranksep).toBeGreaterThanOrEqual(40)
  })

  it('pushes ranks further apart as it opens out', () => {
    const [a, b] = [node('A'), node('B')]
    const nodes = [a, b]
    const edges = [edge(a, b)]
    const gapAt = (spacing: (typeof SPACINGS)[number]) => {
      const positions = layoutGraph(nodes, edges, spacing)
      return positions.get(b.id)!.y - positions.get(a.id)!.y
    }
    expect(gapAt('tight')).toBeLessThan(gapAt('normal'))
    expect(gapAt('normal')).toBeLessThan(gapAt('wide'))
  })

  it('separates siblings further as it opens out', () => {
    const [root, left, right] = [node('root'), node('left'), node('right')]
    const nodes = [root, left, right]
    const edges = [edge(root, left), edge(root, right)]
    const spreadAt = (spacing: (typeof SPACINGS)[number]) => {
      const positions = layoutGraph(nodes, edges, spacing)
      return Math.abs(positions.get(left.id)!.x - positions.get(right.id)!.x)
    }
    expect(spreadAt('tight')).toBeLessThan(spreadAt('wide'))
  })

  it('moves nodes without reordering them, and defaults to normal', () => {
    const [a, b, c] = [node('A'), node('B'), node('C')]
    const nodes = [a, b, c]
    const edges = [edge(a, b), edge(a, c)]
    const normal = layoutGraph(nodes, edges)
    expect(normal).toEqual(layoutGraph(nodes, edges, 'normal'))
    for (const spacing of SPACINGS) {
      const positions = layoutGraph(nodes, edges, spacing)
      for (const n of nodes) {
        expect(positions.get(n.id)!.rank).toBe(normal.get(n.id)!.rank)
        // Widths come from the label, never from the spacing.
        expect(positions.get(n.id)!.width).toBe(normal.get(n.id)!.width)
      }
    }
  })
})

describe('layoutGraph sizing', () => {
  it('sizes nodes to the label rather than to a fixed card width', () => {
    const positions = layoutGraph(
      [node('AB'), node('A rather longer title than that one')],
      [],
    )
    const [short, long] = [...positions.values()].sort((a, b) => a.width - b.width)
    expect(short.width).toBeLessThan(long.width)
  })
})
