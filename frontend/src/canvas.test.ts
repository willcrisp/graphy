import { describe, expect, it } from 'vitest'

import {
  buildBoard,
  buildOverview,
  isMilestoneNodeId,
  isParentNodeId,
  milestoneIdOf,
  milestoneNodeId,
  parentEdgesOf,
  parentIdOf,
  parentNodeId,
  rootEdgesOf,
} from './canvas'
import type {
  AppSummary,
  Graph,
  GraphEdge,
  Milestone,
  Overview,
  ParentProject,
  TaskNodeData,
} from './types'

let nextId = 1

function node(title: string, overrides: Partial<TaskNodeData> = {}): TaskNodeData {
  const id = nextId++
  return {
    id,
    app_id: 1,
    title,
    detail: null,
    status: 'todo',
    external_ref: null,
    milestone_id: null,
    is_root: false,
    sort_order: id,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const edge = (source: TaskNodeData, target: TaskNodeData): GraphEdge => ({
  id: nextId++,
  app_id: source.app_id,
  source_id: source.id,
  target_id: target.id,
})

const app = (id: number, key: string, parent_id: number | null = null): AppSummary => ({
  id,
  key,
  name: key.toUpperCase(),
  accent: '#1F5F8B',
  parent_id,
  sort_order: id,
  counts: { done: 0, wip: 0, todo: 0, blocked: 0 },
})

const parent = (id: number, name: string): ParentProject => ({
  id,
  name,
  detail: 'A description.',
  sort_order: id,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})

describe('parent node ids', () => {
  it('map into the node id space without colliding with anything real', () => {
    const id = parentNodeId(3)
    expect(id).toBeLessThan(0)
    expect(parentIdOf(id)).toBe(3)
    expect(isParentNodeId(id)).toBe(true)
    // Real rowids are positive; optimistic temp ids count down from -1.
    expect(isParentNodeId(7)).toBe(false)
    expect(isParentNodeId(-1)).toBe(false)
  })
})

describe('rootEdgesOf', () => {
  it('connects the root to every node with no incoming edge', () => {
    const root = node('App', { is_root: true })
    const [a, b, c] = [node('A'), node('B'), node('C')]
    const virtual = rootEdgesOf([root, a, b, c], [edge(a, b)])

    expect(virtual.map((e) => e.target_id).sort()).toEqual([a.id, c.id].sort())
    expect(virtual.every((e) => e.source_id === root.id)).toBe(true)
  })

  it('returns nothing when there is no root node', () => {
    expect(rootEdgesOf([node('A'), node('B')], [])).toEqual([])
  })

  it('hangs each board off its own root, not the first one it finds', () => {
    const rootA = node('A', { app_id: 1, is_root: true })
    const rootB = node('B', { app_id: 2, is_root: true })
    const taskA = node('a1', { app_id: 1 })
    const taskB = node('b1', { app_id: 2 })

    const virtual = rootEdgesOf([rootA, rootB, taskA, taskB], [])
    const sourceOf = (target: number) =>
      virtual.find((e) => e.target_id === target)!.source_id

    expect(sourceOf(taskA.id)).toBe(rootA.id)
    expect(sourceOf(taskB.id)).toBe(rootB.id)
  })
})

describe('parentEdgesOf', () => {
  it('joins several boards to the one parent project they share', () => {
    const rootA = node('A', { app_id: 1, is_root: true })
    const rootB = node('B', { app_id: 2, is_root: true })
    const rootC = node('C', { app_id: 3, is_root: true })
    const apps = [app(1, 'a', 7), app(2, 'b', 7), app(3, 'c')]

    const joins = parentEdgesOf(apps, [rootA, rootB, rootC])

    expect(joins).toHaveLength(2)
    expect(joins.every((e) => e.source_id === parentNodeId(7))).toBe(true)
    expect(joins.map((e) => e.target_id).sort()).toEqual([rootA.id, rootB.id].sort())
    // A board with no parent is left as a top-level cluster of its own.
    expect(joins.some((e) => e.target_id === rootC.id)).toBe(false)
  })

  it('skips a board whose root is missing from the node set', () => {
    expect(parentEdgesOf([app(1, 'a', 7)], [])).toEqual([])
  })
})

describe('buildBoard', () => {
  it('labels the root and the tasks, and computes the joins between them', () => {
    const root = node('Alpha', { is_root: true })
    const task = node('Ingest')
    const graph: Graph = {
      app: { id: 1, key: 'alpha', name: 'Alpha', accent: '#1F5F8B', parent_id: null, sort_order: 1 },
      nodes: [root, task],
      edges: [],
      milestones: [],
      last_updated: null,
    }

    const canvas = buildBoard(graph)

    expect(canvas.key).toBe('alpha')
    expect(canvas.nodes.map((n) => n.kind)).toEqual(['root', 'task'])
    // A board page already carries its accent on `.canvas`, so nodes don't.
    expect(canvas.nodes.every((n) => n.accent === null)).toBe(true)
    expect(canvas.structural).toHaveLength(1)
    expect(canvas.empty).toBe(false)
  })

  it('is empty when the root is the only node', () => {
    const root = node('Alpha', { is_root: true })
    const canvas = buildBoard({
      app: { id: 1, key: 'alpha', name: 'Alpha', accent: '#1F5F8B', parent_id: null, sort_order: 1 },
      nodes: [root],
      edges: [],
      milestones: [],
      last_updated: null,
    })
    expect(canvas.empty).toBe(true)
  })
})

describe('buildOverview', () => {
  const rootA = node('Alpha', { app_id: 1, is_root: true })
  const rootB = node('Beta', { app_id: 2, is_root: true })
  const taskA = node('Ingest', { app_id: 1 })

  const overview: Overview = {
    parents: [parent(7, 'Platform')],
    apps: [app(1, 'alpha', 7), app(2, 'beta', 7)],
    nodes: [rootA, taskA, rootB],
    edges: [],
    last_updated: '2026-01-01T00:00:00Z',
  }

  it('adds a node per parent project and joins both boards to it', () => {
    const canvas = buildOverview(overview)

    const parentNodes = canvas.nodes.filter((n) => n.kind === 'parent')
    expect(parentNodes.map((n) => n.title)).toEqual(['Platform'])
    expect(parentNodes[0].detail).toBe('A description.')

    const joins = canvas.structural.filter((e) => e.source_id === parentNodeId(7))
    expect(joins.map((e) => e.target_id).sort()).toEqual([rootA.id, rootB.id].sort())
  })

  it('carries each board’s accent on its nodes, since the canvas cannot', () => {
    const canvas = buildOverview(overview)
    const drawn = canvas.nodes.filter((n) => n.kind !== 'parent')
    expect(drawn.every((n) => n.accent === '#1F5F8B')).toBe(true)
    expect(drawn.find((n) => n.id === taskA.id)!.appName).toBe('ALPHA')
  })

  it('is never empty: a board with no tasks still contributes its root', () => {
    expect(buildOverview({ ...overview, nodes: [rootA, rootB] }).empty).toBe(false)
  })

  it('sorts parent projects ahead of every board', () => {
    // `app_id: 0` is what puts them first once `layoutGraph` sorts by it.
    const canvas = buildOverview(overview)
    expect(canvas.nodes[0].kind).toBe('parent')
    expect(canvas.nodes[0].app_id).toBe(0)
  })
})

describe('milestones', () => {
  const line = (id: number, position: number, due_on: string | null = null): Milestone => ({
    id,
    app_id: 1,
    label: `M${id}`,
    due_on,
    position,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })

  const boardOf = (nodes: TaskNodeData[], milestones: Milestone[], edges: GraphEdge[] = []) =>
    buildBoard(
      {
        app: { id: 1, key: 'alpha', name: 'Alpha', accent: '#1F5F8B', parent_id: null, sort_order: 1 },
        nodes,
        edges,
        milestones,
        last_updated: null,
      },
      '2026-06-15',
    )

  it('maps a milestone into the node id space and back', () => {
    expect(milestoneIdOf(milestoneNodeId(42))).toBe(42)
    expect(isMilestoneNodeId(milestoneNodeId(42))).toBe(true)
    // Each synthetic kind gets its own decade, so the ranges cannot overlap.
    expect(isMilestoneNodeId(parentNodeId(42))).toBe(false)
    expect(isParentNodeId(milestoneNodeId(42))).toBe(false)
    expect(isMilestoneNodeId(7)).toBe(false)
  })

  it('holds a dated task above its own line and below the one before it', () => {
    const root = node('Alpha', { is_root: true })
    const first = node('First', { milestone_id: 1 })
    const second = node('Second', { milestone_id: 2 })
    const q1 = line(1, 0)
    const q2 = line(2, 1)

    const { ordering } = boardOf([root, first, second], [q1, q2])
    const has = (source: number, target: number) =>
      ordering.some((e) => e.source_id === source && e.target_id === target)

    expect(has(root.id, milestoneNodeId(1))).toBe(true) // rules below the sheet name
    expect(has(milestoneNodeId(1), milestoneNodeId(2))).toBe(true) // rules in order
    expect(has(first.id, milestoneNodeId(1))).toBe(true) // above its own line
    expect(has(second.id, milestoneNodeId(2))).toBe(true)
    expect(has(milestoneNodeId(1), second.id)).toBe(true) // below the one before
    // The first line has nothing before it, so nothing pushes its tasks down.
    expect(ordering.some((e) => e.target_id === first.id)).toBe(false)
  })

  it('leaves an undated task unconstrained', () => {
    const root = node('Alpha', { is_root: true })
    const floating = node('Floating')
    const { ordering } = boardOf([root, floating], [line(1, 0)])

    expect(
      ordering.some((e) => e.source_id === floating.id || e.target_id === floating.id),
    ).toBe(false)
  })

  it('emits nothing at all on a board with no calendar', () => {
    const board = boardOf([node('Alpha', { is_root: true }), node('Task')], [])
    expect(board.ordering).toEqual([])
    expect(board.nodes.every((n) => n.kind !== 'milestone')).toBe(true)
  })

  it('tallies the work due by each line', () => {
    const nodes = [
      node('Alpha', { is_root: true }),
      node('A', { milestone_id: 1, status: 'done' }),
      node('B', { milestone_id: 1, status: 'blocked' }),
      node('C', { milestone_id: 2, status: 'todo' }),
      node('D'),
    ]
    const board = boardOf(nodes, [line(1, 0), line(2, 1)])
    const first = board.nodes.find((n) => n.id === milestoneNodeId(1))!

    expect(first.kind).toBe('milestone')
    expect(first.mark!.counts).toEqual({ done: 1, wip: 0, todo: 0, blocked: 1 })
  })

  it('calls a passed date overdue only while work under it is unfinished', () => {
    const root = node('Alpha', { is_root: true })
    const open = node('Open', { milestone_id: 1, status: 'wip' })
    const shipped = node('Shipped', { milestone_id: 2, status: 'done' })

    const board = boardOf(
      [root, open, shipped],
      [line(1, 0, '2026-03-31'), line(2, 1, '2026-04-30')],
    )
    const markOf = (id: number) => board.nodes.find((n) => n.id === milestoneNodeId(id))!.mark!

    expect(markOf(1).overdue).toBe(true)
    // Past its date, but everything due by it is done: a milestone that was met.
    expect(markOf(2).overdue).toBe(false)
  })

  it('is never overdue without a date, however late the work', () => {
    const board = boardOf(
      [node('Alpha', { is_root: true }), node('Open', { milestone_id: 1, status: 'todo' })],
      [line(1, 0, null)],
    )
    expect(board.nodes.find((n) => n.id === milestoneNodeId(1))!.mark!.overdue).toBe(false)
  })

  it('draws no rules on the overview', () => {
    // A rule is a line across *a sheet*, and this page is six sheets at once.
    const overview: Overview = {
      parents: [],
      apps: [app(1, 'alpha')],
      nodes: [node('Alpha', { is_root: true })],
      edges: [],
      last_updated: null,
    }
    const canvas = buildOverview(overview)
    expect(canvas.ordering).toEqual([])
    expect(canvas.nodes.every((n) => n.kind !== 'milestone')).toBe(true)
  })
})
