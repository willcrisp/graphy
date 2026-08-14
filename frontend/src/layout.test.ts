import { describe, expect, it } from 'vitest'
import { NODE_HEIGHT, layoutGraph, nodeWidth } from './layout'
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
    milestone_id: null,
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

describe('spanning nodes', () => {
  it('stretches a rule across the drawing and overhangs it both sides', () => {
    const [a, b, rule] = [node('A'), node('B'), node('Q1')]
    const positions = layoutGraph(
      [a, b, rule],
      [edge(a, b), edge(a, rule)],
      new Set([rule.id]),
    )

    const left = Math.min(positions.get(a.id)!.x, positions.get(b.id)!.x)
    const right = Math.max(
      positions.get(a.id)!.x + positions.get(a.id)!.width,
      positions.get(b.id)!.x + positions.get(b.id)!.width,
    )
    const laid = positions.get(rule.id)!

    expect(laid.x).toBeLessThan(left)
    expect(laid.x + laid.width).toBeGreaterThan(right)
  })

  it('does not let a rule widen the drawing it measures', () => {
    // Bounds are taken from the real nodes only. Including the rule's own box
    // would make it grow a little further on every layout pass.
    const [a, rule] = [node('A'), node('Q1')]
    const spans = new Set([rule.id])
    const once = layoutGraph([a, rule], [edge(a, rule)], spans)
    const twice = layoutGraph([a, rule], [edge(a, rule)], spans)

    expect(twice.get(rule.id)!.width).toBe(once.get(rule.id)!.width)
    expect(twice.get(a.id)!.x).toBe(once.get(a.id)!.x)
  })

  it('ranks a task above the rule it points at and below the one before it', () => {
    // The whole point of the ordering edges: layout, not decoration.
    const [root, q1, q2, first, second] = [
      node('Root'),
      node('Q1'),
      node('Q2'),
      node('First'),
      node('Second'),
    ]
    const positions = layoutGraph(
      [root, q1, q2, first, second],
      [
        edge(root, q1),
        edge(q1, q2),
        edge(first, q1),
        edge(second, q2),
        edge(q1, second),
      ],
      new Set([q1.id, q2.id]),
    )

    expect(positions.get(first.id)!.y).toBeLessThan(positions.get(q1.id)!.y)
    expect(positions.get(second.id)!.y).toBeGreaterThan(positions.get(q1.id)!.y)
    expect(positions.get(second.id)!.y).toBeLessThan(positions.get(q2.id)!.y)
  })

  it('leaves a rule alone when there is nothing else to span', () => {
    const rule = node('Q1')
    const positions = layoutGraph([rule], [], new Set([rule.id]))
    expect(Number.isFinite(positions.get(rule.id)!.width)).toBe(true)
  })
})
