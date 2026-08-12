import { describe, expect, it } from 'vitest'

import {
  countsOf,
  draftNode,
  insertEdge,
  insertNode,
  isTempId,
  patchNode,
  removeEdge,
  removeNode,
  withCounts,
} from './optimistic'
import type { AppSummary, Graph, GraphEdge, TaskNodeData } from './types'

const node = (
  id: number,
  overrides: Partial<TaskNodeData> = {},
): TaskNodeData => ({
  id,
  app_id: 1,
  title: `Node ${id}`,
  detail: null,
  status: 'todo',
  external_ref: null,
  sort_order: id,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const edge = (id: number, source_id: number, target_id: number): GraphEdge => ({
  id,
  app_id: 1,
  source_id,
  target_id,
})

const graphOf = (nodes: TaskNodeData[], edges: GraphEdge[] = []): Graph => ({
  app: { id: 1, key: 'alpha', name: 'Alpha', accent: '#1F5F8B', sort_order: 1 },
  nodes,
  edges,
  last_updated: '2026-01-01T00:00:00Z',
})

describe('temp ids', () => {
  it('are negative and never repeat, so they cannot collide with rowids', () => {
    const graph = graphOf([node(1)])
    const first = draftNode(graph, { title: 'A', status: 'todo' }).id
    const second = draftNode(graph, { title: 'B', status: 'todo' }).id

    expect(isTempId(first)).toBe(true)
    expect(isTempId(second)).toBe(true)
    expect(first).not.toBe(second)
    expect(isTempId(1)).toBe(false)
  })
})

describe('draftNode / insertNode', () => {
  it('appends with the next sort_order, matching the service', () => {
    const before = graphOf([node(1), node(2)])
    const added = draftNode(before, { title: 'Third', status: 'wip' })
    const graph = insertNode(before, added)

    expect(graph.nodes).toHaveLength(3)
    expect(added.sort_order).toBe(3)
    expect(added.title).toBe('Third')
    expect(added.status).toBe('wip')
    expect(added.detail).toBeNull()
  })

  it('starts at 1 on an empty board', () => {
    expect(draftNode(graphOf([]), { title: 'First', status: 'todo' }).sort_order).toBe(1)
  })

  it('does not mutate the graph it was given', () => {
    const before = graphOf([node(1)])
    insertNode(before, draftNode(before, { title: 'X', status: 'todo' }))
    expect(before.nodes).toHaveLength(1)
  })

  it('inserting the same draft twice is idempotent, as StrictMode requires', () => {
    const before = graphOf([node(1)])
    const draft = draftNode(before, { title: 'X', status: 'todo' })
    expect(insertNode(before, draft)).toEqual(insertNode(before, draft))
  })
})

describe('patchNode', () => {
  it('applies only the supplied fields and touches only the named node', () => {
    const patched = patchNode(graphOf([node(1), node(2, { title: 'Keep' })]), 1, {
      status: 'done',
    })

    expect(patched.nodes[0].status).toBe('done')
    expect(patched.nodes[0].title).toBe('Node 1')
    expect(patched.nodes[1].title).toBe('Keep')
    expect(patched.nodes[1].status).toBe('todo')
  })

  it('advances last_updated so the title block moves with the edit', () => {
    const patched = patchNode(graphOf([node(1)]), 1, { title: 'Renamed' })
    expect(patched.last_updated).not.toBeNull()
    expect(patched.last_updated! > '2026-01-01T00:00:00Z').toBe(true)
  })
})

describe('removeNode', () => {
  it('cascades the edges on both sides, as the foreign keys do', () => {
    const graph = graphOf(
      [node(1), node(2), node(3)],
      [edge(10, 1, 2), edge(11, 2, 3), edge(12, 1, 3)],
    )
    const after = removeNode(graph, 2)

    expect(after.nodes.map((n) => n.id)).toEqual([1, 3])
    expect(after.edges.map((e) => e.id)).toEqual([12])
  })

  it('leaves children as roots rather than reparenting them', () => {
    // 1 -> 2 -> 3. Dropping 2 must not invent a 1 -> 3 edge.
    const after = removeNode(
      graphOf([node(1), node(2), node(3)], [edge(10, 1, 2), edge(11, 2, 3)]),
      2,
    )
    expect(after.edges).toEqual([])
  })

  it('recomputes last_updated from what survives', () => {
    const after = removeNode(
      graphOf([
        node(1, { updated_at: '2026-01-01T00:00:00Z' }),
        node(2, { updated_at: '2026-06-01T00:00:00Z' }),
      ]),
      2,
    )
    expect(after.last_updated).toBe('2026-01-01T00:00:00Z')
  })

  it('reports no last_updated once the board is empty', () => {
    expect(removeNode(graphOf([node(1)]), 1).last_updated).toBeNull()
  })
})

describe('edges', () => {
  it('adds and removes by id', () => {
    const graph = insertEdge(graphOf([node(1), node(2)]), 1, 2)
    const [added] = graph.edges
    expect(added.source_id).toBe(1)
    expect(added.target_id).toBe(2)
    expect(graph.edges).toHaveLength(1)

    expect(removeEdge(graph, added.id).edges).toEqual([])
  })
})

describe('counts', () => {
  it('tallies every status, including the absent ones', () => {
    expect(
      countsOf([node(1, { status: 'done' }), node(2, { status: 'done' }), node(3)]),
    ).toEqual({ done: 2, wip: 0, todo: 1, blocked: 0 })
  })

  it('re-tallies only the active app in the tab strip', () => {
    const apps: AppSummary[] = [
      {
        id: 1,
        key: 'alpha',
        name: 'Alpha',
        accent: '#1F5F8B',
        sort_order: 1,
        counts: { done: 0, wip: 0, todo: 9, blocked: 0 },
      },
      {
        id: 2,
        key: 'beta',
        name: 'Beta',
        accent: '#5B4B8A',
        sort_order: 2,
        counts: { done: 4, wip: 0, todo: 0, blocked: 0 },
      },
    ]
    const updated = withCounts(apps, graphOf([node(1, { status: 'wip' })]))

    expect(updated[0].counts).toEqual({ done: 0, wip: 1, todo: 0, blocked: 0 })
    expect(updated[1].counts).toEqual({ done: 4, wip: 0, todo: 0, blocked: 0 })
  })
})
