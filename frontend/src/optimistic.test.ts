import { describe, expect, it } from 'vitest'

import {
  countsOf,
  draftMilestone,
  draftNode,
  insertEdge,
  insertMilestone,
  insertNode,
  isTempId,
  patchMilestone,
  patchNode,
  removeEdge,
  removeMilestone,
  removeNode,
  withCounts,
} from './optimistic'
import type { AppSummary, Graph, GraphEdge, Milestone, TaskNodeData } from './types'

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
  milestone_id: null,
  is_root: false,
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

const milestone = (id: number, position: number, due_on: string | null = null): Milestone => ({
  id,
  app_id: 1,
  label: `M${id}`,
  due_on,
  position,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})

const graphOf = (
  nodes: TaskNodeData[],
  edges: GraphEdge[] = [],
  milestones: Milestone[] = [],
): Graph => ({
  app: {
    id: 1,
    key: 'alpha',
    name: 'Alpha',
    accent: '#1F5F8B',
    parent_id: null,
    sort_order: 1,
  },
  nodes,
  edges,
  milestones,
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
        parent_id: null,
        sort_order: 1,
        counts: { done: 0, wip: 0, todo: 9, blocked: 0 },
      },
      {
        id: 2,
        key: 'beta',
        name: 'Beta',
        accent: '#5B4B8A',
        parent_id: null,
        sort_order: 2,
        counts: { done: 4, wip: 0, todo: 0, blocked: 0 },
      },
    ]
    const updated = withCounts(apps, graphOf([node(1, { status: 'wip' })]))

    expect(updated[0].counts).toEqual({ done: 0, wip: 1, todo: 0, blocked: 0 })
    expect(updated[1].counts).toEqual({ done: 4, wip: 0, todo: 0, blocked: 0 })
  })
})

describe('milestones', () => {
  it('drafts an appended row, matching create_milestone', () => {
    const graph = graphOf([], [], [milestone(1, 0), milestone(2, 4)])
    const draft = draftMilestone(graph, { label: 'Q3', due_on: '2026-09-30' })

    expect(isTempId(draft.id)).toBe(true)
    expect(draft.app_id).toBe(1)
    // Appended, never sorted into place by date -- the server does the same.
    expect(draft.position).toBe(5)
  })

  it('renumbers the run from zero when a line moves', () => {
    const graph = graphOf([], [], [milestone(1, 0), milestone(2, 1), milestone(3, 2)])
    const moved = patchMilestone(graph, 3, { position: 0 })

    expect(moved.milestones.map((m) => [m.id, m.position])).toEqual([
      [3, 0],
      [1, 1],
      [2, 2],
    ])
  })

  it('leaves the order alone when only the label or date changes', () => {
    const graph = graphOf([], [], [milestone(1, 0), milestone(2, 1)])
    const renamed = patchMilestone(graph, 2, { label: 'Beta', due_on: null })

    expect(renamed.milestones.map((m) => m.position)).toEqual([0, 1])
    expect(renamed.milestones[1].label).toBe('Beta')
  })

  it('inserts without disturbing anything else', () => {
    const graph = graphOf([node(1)], [], [milestone(1, 0)])
    const added = insertMilestone(graph, milestone(2, 1))

    expect(added.milestones).toHaveLength(2)
    expect(added.nodes).toEqual(graph.nodes)
  })

  it('undates the work when a line goes, and keeps the work', () => {
    // Mirrors `delete_milestone`: SET NULL, not a cascade. Getting this wrong
    // shows up as tasks vanishing on the click and returning on reconcile.
    const graph = graphOf(
      [node(1, { milestone_id: 7 }), node(2, { milestone_id: 8 })],
      [],
      [milestone(7, 0), milestone(8, 1)],
    )
    const cut = removeMilestone(graph, 7)

    expect(cut.milestones.map((m) => m.id)).toEqual([8])
    expect(cut.nodes.map((n) => n.milestone_id)).toEqual([null, 8])
  })

  it('moves a task onto and off a line', () => {
    const graph = graphOf([node(1)], [], [milestone(5, 0)])
    expect(patchNode(graph, 1, { milestone_id: 5 }).nodes[0].milestone_id).toBe(5)
    expect(patchNode(graph, 1, { milestone_id: null }).nodes[0].milestone_id).toBe(null)
  })
})
