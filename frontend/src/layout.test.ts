import { describe, expect, it } from 'vitest'
import { NODE_WIDTH, layoutGraph, neptuneNodeWidth, nodeHeight } from './layout'
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
    sort_order: id,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function edge(source: TaskNodeData, target: TaskNodeData, id = nextId++): GraphEdge {
  return { id, app_id: 1, source_id: source.id, target_id: target.id }
}

describe('nodeHeight', () => {
  it('is taller when a detail paragraph is present', () => {
    const short = node('Ingest')
    expect(nodeHeight({ ...short, detail: 'Some detail.' })).toBeGreaterThan(
      nodeHeight(short),
    )
  })

  it('grows with a title that must wrap', () => {
    expect(nodeHeight(node('A very long task title that certainly wraps over lines'))).
      toBeGreaterThan(nodeHeight(node('Short')))
  })
})

describe('layoutGraph ordering', () => {
  it('places a dependency to the left of its dependant', () => {
    const a = node('A')
    const b = node('B')
    const positions = layoutGraph([a, b], [edge(a, b)])
    expect(positions.get(a.id)!.x).toBeLessThan(positions.get(b.id)!.x)
  })

  it('assigns increasing ranks along a chain', () => {
    const [a, b, c] = [node('A'), node('B'), node('C')]
    const positions = layoutGraph([a, b, c], [edge(a, b), edge(b, c)])
    expect(positions.get(a.id)!.rank).toBe(0)
    expect(positions.get(b.id)!.rank).toBe(1)
    expect(positions.get(c.id)!.rank).toBe(2)
  })

  it('puts siblings in the same rank but separated vertically', () => {
    const [root, left, right] = [node('root'), node('left'), node('right')]
    const positions = layoutGraph([root, left, right], [edge(root, left), edge(root, right)])
    const l = positions.get(left.id)!
    const r = positions.get(right.id)!
    expect(l.rank).toBe(r.rank)
    expect(Math.abs(l.y - r.y)).toBeGreaterThanOrEqual(28)
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
    for (const n of nodes) expect(positions.get(n.id)!.width).toBe(NODE_WIDTH)
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

describe('layoutGraph neptune style', () => {
  it('defaults to the blueprint style when none is given', () => {
    const [a, b] = [node('A'), node('B')]
    const withoutStyle = layoutGraph([a, b], [edge(a, b)])
    const withBlueprint = layoutGraph([a, b], [edge(a, b)], 'blueprint')
    expect(withoutStyle).toEqual(withBlueprint)
  })

  it('stacks a dependency below its dependant instead of to its right', () => {
    const a = node('A')
    const b = node('B')
    const positions = layoutGraph([a, b], [edge(a, b)], 'neptune')
    expect(positions.get(a.id)!.y).toBeLessThan(positions.get(b.id)!.y)
  })

  it('ranks along y rather than x', () => {
    const [a, b, c] = [node('A'), node('B'), node('C')]
    const positions = layoutGraph([a, b, c], [edge(a, b), edge(b, c)], 'neptune')
    expect(positions.get(a.id)!.rank).toBe(0)
    expect(positions.get(b.id)!.rank).toBe(1)
    expect(positions.get(c.id)!.rank).toBe(2)
  })

  it('sizes nodes to the label instead of a fixed card width', () => {
    const positions = layoutGraph(
      [node('AB'), node('A rather longer title than that one')],
      [],
      'neptune',
    )
    const [short, long] = [...positions.values()].sort((a, b) => a.width - b.width)
    expect(short.width).toBeLessThan(long.width)
    expect(short.width).not.toBe(NODE_WIDTH)
  })
})

describe('neptuneNodeWidth', () => {
  it('grows with the label and stays within its clamp', () => {
    expect(neptuneNodeWidth('AB')).toBeLessThan(neptuneNodeWidth('A much longer task title'))
    expect(neptuneNodeWidth('')).toBeGreaterThanOrEqual(84)
    expect(neptuneNodeWidth('X'.repeat(200))).toBeLessThanOrEqual(220)
  })
})
