import { useEffect, useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import TaskNode from './TaskNode'
import type { CanvasGraph } from '../canvas'
import { layoutGraph, type Spacing } from '../layout'

/** The React Flow canvas: turns a `CanvasGraph` (see `canvas.ts`) plus a
 *  computed `layoutGraph` position into React Flow nodes/edges, and forwards
 *  its pointer events (click, connect, context menu) up to `App.tsx` as plain
 *  ids -- it holds no mutation logic of its own.
 *
 *  It does not know whether it is drawing one board or the overview of all of
 *  them: `canvas.ts` flattens both into the same shape first. */

const nodeTypes = { task: TaskNode }
const fitViewOptions = { padding: 0.2 }

/** Marker arrowheads live in an SVG <defs> outside the cascade React Flow's
 *  className props reach, so these are literals rather than var() references.
 *  They match the canvas's --rule-strong and --st-wip (tokens.css). */
const MARKER_COLOR = '#2c3f36'
const WIP_MARKER_COLOR = '#a78bfa'

/** Curvature for the bezier edges. Cheap default is 0.25; this is
 *  slightly higher so siblings that fan out sideways read as a deliberate
 *  swoop rather than a stiff diagonal, while nodes stacked directly below
 *  their parent still draw as a near-straight line. */
const EDGE_CURVATURE = 0.32

interface Props {
  graph: CanvasGraph
  /** How far apart to lay the tree out. A reader's preference held in
   *  `App.tsx`; nothing here interprets it beyond handing it to `layoutGraph`. */
  spacing: Spacing
  editMode: boolean
  selectedId: number | null
  onSelect: (id: number | null) => void
  onConnect: (source: number, target: number) => void
  onAddFirst: () => void
  /** Right-click targets. Coordinates are viewport (client) pixels; the menu
   *  renders at the shell level so it is never clipped by the canvas. */
  onNodeMenu: (id: number, x: number, y: number) => void
  onEdgeMenu: (id: number, x: number, y: number) => void
  onPaneMenu: (x: number, y: number) => void
}

export default function Graph({
  graph,
  spacing,
  editMode,
  selectedId,
  onSelect,
  onConnect,
  onAddFirst,
  onNodeMenu,
  onEdgeMenu,
  onPaneMenu,
}: Props) {
  const { fitView } = useReactFlow()

  const { nodes, edges } = useMemo(() => {
    // Layout and drawing take the same edge list, computed joins included --
    // see `layoutGraph`'s note on why it no longer derives its own.
    const drawn = [...graph.edges, ...graph.structural]
    const positions = layoutGraph(graph.nodes, drawn, spacing)
    const byId = new Map(graph.nodes.map((task) => [task.id, task]))
    const flowNodes: Node[] = graph.nodes.flatMap((task) => {
      const position = positions.get(task.id)
      if (!position) return []
      return [
        {
          id: String(task.id),
          type: 'task',
          position: { x: position.x, y: position.y },
          width: position.width,
          height: position.height,
          selected: task.id === selectedId,
          data: { task, editable: editMode, rank: position.rank },
          ariaLabel:
            task.kind === 'task'
              ? `${task.title}, ${task.status}`
              : `${task.title}, ${task.kind === 'parent' ? 'parent project' : 'board'}`,
        },
      ]
    })

    // Every connection draws as a flowing curve. An edge whose target is in
    // progress gets React Flow's
    // marching-ants animation, coloured to match the wip status -- movement
    // reads as "work flowing into this task" -- everything else is a plain
    // solid line, so the animation reads as a signal rather than decoration.
    const flowEdges: Edge[] = graph.edges.map((edge) => {
      const wip = byId.get(edge.target_id)?.status === 'wip'
      return {
        id: String(edge.id),
        source: String(edge.source_id),
        target: String(edge.target_id),
        type: 'default',
        pathOptions: { curvature: EDGE_CURVATURE },
        focusable: true,
        animated: wip,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 12,
          height: 12,
          color: wip ? WIP_MARKER_COLOR : MARKER_COLOR,
        },
      } as Edge
    })

    // The structural joins -- a root to its top-level tasks, a parent project
    // to the boards under it -- are computed, not stored (see `canvas.ts`).
    // Drawn quieter than a real dependency and inert: no context menu, no
    // selection, nothing to delete, because there is no row to delete.
    const rootEdges: Edge[] = graph.structural.map((edge) => ({
      id: String(edge.id),
      source: String(edge.source_id),
      target: String(edge.target_id),
      type: 'default',
      pathOptions: { curvature: EDGE_CURVATURE },
      className: 'react-flow__edge--root',
      focusable: false,
      selectable: false,
      deletable: false,
      animated: false,
    }))

    return { nodes: flowNodes, edges: [...rootEdges, ...flowEdges] }
  }, [graph, spacing, editMode, selectedId])

  // Re-frame whenever the page changes. The key is the page, not the node
  // count, so adding a node does not yank the viewport out from under the user.
  //
  // Spacing is deliberately *not* in this list. Re-fitting after a spacing
  // change would rescale the drawing to the same box every time, so pulling the
  // tree in would shrink the gaps and grow the zoom in the same breath and the
  // control would read as a zoom that never quite zooms. Left alone, the nodes
  // keep their size and simply move: tighten and more of the board arrives in
  // view, open it out and it spreads. The fit button is right there for after.
  useEffect(() => {
    const timer = window.setTimeout(() => fitView(fitViewOptions), 0)
    return () => window.clearTimeout(timer)
  }, [graph.key, fitView])

  if (graph.empty) {
    return (
      <div className="empty">
        <p className="empty__mark mono" aria-hidden="true">
          — no sheet content —
        </p>
        <p className="empty__text">
          {editMode
            ? 'Nothing planned here yet. Add the first task.'
            : 'Nothing planned here yet.'}
        </p>
        {editMode ? (
          <button type="button" className="button button--primary" onClick={onAddFirst}>
            Add the first task
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={editMode}
      elementsSelectable
      edgesFocusable
      fitView
      fitViewOptions={fitViewOptions}
      minZoom={0.2}
      maxZoom={1.6}
      proOptions={{ hideAttribution: false }}
      onNodeClick={(_event, node) => onSelect(Number(node.id))}
      onPaneClick={() => onSelect(null)}
      onNodeContextMenu={(event, node) => {
        event.preventDefault()
        onNodeMenu(Number(node.id), event.clientX, event.clientY)
      }}
      onEdgeContextMenu={(event, edge) => {
        event.preventDefault()
        onEdgeMenu(Number(edge.id), event.clientX, event.clientY)
      }}
      onPaneContextMenu={(event) => {
        // Touch devices fire this with a TouchEvent, which has no clientX.
        if (!('clientX' in event)) return
        event.preventDefault()
        onPaneMenu(event.clientX, event.clientY)
      }}
      onConnect={(connection: Connection) => {
        if (connection.source && connection.target) {
          onConnect(Number(connection.source), Number(connection.target))
        }
      }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={28}
        size={1}
        color="var(--grid)"
      />
      {/* Zoom in/out/fit only -- no minimap, no interactivity lock. */}
      <Controls showZoom showFitView showInteractive={false} position="bottom-left" />
    </ReactFlow>
  )
}
