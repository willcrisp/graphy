import { describe, expect, it } from 'vitest'

import {
  buildBoard,
  buildOverview,
  isParentNodeId,
  parentEdgesOf,
  parentIdOf,
  parentNodeId,
  rootEdgesOf,
} from './canvas'
import type {
  AppSummary,
  Graph,
  GraphEdge,
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
