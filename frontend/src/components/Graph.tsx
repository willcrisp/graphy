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
import { layoutGraph } from '../layout'
import type { GraphStyle } from '../graphStyle'
import type { Graph as GraphData } from '../types'

/** The React Flow canvas: turns `graph` (server shape) plus a computed
 *  `layoutGraph` position into React Flow nodes/edges, and forwards its
 *  pointer events (click, connect, context menu) up to `App.tsx` as plain
 *  ids -- it holds no mutation logic of its own. */

const nodeTypes = { task: TaskNode }
const fitViewOptions = { padding: 0.2 }

/** Marker arrowheads live in an SVG <defs> outside the cascade React Flow's
 *  className props reach, so these are literals rather than var() references.
 *  They match the neptune canvas's --rule-strong and --st-wip (tokens.css). */
const NEPTUNE_MARKER_COLOR = '#2c3f36'
const NEPTUNE_WIP_MARKER_COLOR = '#a78bfa'

/** Curvature for neptune's bezier edges. Cheap default is 0.25; this is
 *  slightly higher so siblings that fan out sideways read as a deliberate
 *  swoop rather than a stiff diagonal, while nodes stacked directly below
 *  their parent still draw as a near-straight line. */
const NEPTUNE_CURVATURE = 0.32

interface Props {
  graph: GraphData
  graphStyle: GraphStyle
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
  graphStyle,
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
  const neptune = graphStyle === 'neptune'

  const { nodes, edges } = useMemo(() => {
    const positions = layoutGraph(graph.nodes, graph.edges, graphStyle)
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
          data: { task, editable: editMode, rank: position.rank, style: graphStyle },
          ariaLabel: `${task.title}, ${task.status}`,
        },
      ]
    })

    // Neptune draws every connection as a flowing curve rather than blueprint's
    // right-angle steps. An edge whose target is in progress gets React Flow's
    // marching-ants animation, coloured to match the wip status -- movement
    // reads as "work flowing into this task" -- everything else is a plain
    // solid line, so the animation reads as a signal rather than decoration.
    const flowEdges: Edge[] = graph.edges.map((edge) => {
      const wip = neptune && byId.get(edge.target_id)?.status === 'wip'
      return {
        id: String(edge.id),
        source: String(edge.source_id),
        target: String(edge.target_id),
        type: neptune ? 'default' : 'smoothstep',
        pathOptions: neptune ? { curvature: NEPTUNE_CURVATURE } : undefined,
        focusable: true,
        animated: wip,
        markerEnd: neptune
          ? {
              type: MarkerType.ArrowClosed,
              width: 12,
              height: 12,
              color: wip ? NEPTUNE_WIP_MARKER_COLOR : NEPTUNE_MARKER_COLOR,
            }
          : undefined,
      } as Edge
    })

    return { nodes: flowNodes, edges: flowEdges }
  }, [graph, editMode, selectedId, graphStyle, neptune])

  // Re-frame whenever the app changes. The key is the app, not the node count,
  // so adding a node does not yank the viewport out from under the user.
  useEffect(() => {
    const timer = window.setTimeout(() => fitView(fitViewOptions), 0)
    return () => window.clearTimeout(timer)
  }, [graph.app.key, fitView])

  if (!graph.nodes.length) {
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
        variant={neptune ? BackgroundVariant.Dots : BackgroundVariant.Lines}
        gap={neptune ? 28 : 16}
        size={1}
        color="var(--grid)"
      />
      {/* Zoom in/out/fit only -- no minimap, no interactivity lock. */}
      <Controls showZoom showFitView showInteractive={false} position="bottom-left" />
    </ReactFlow>
  )
}
