import { useEffect, useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import FeatureNode from './FeatureNode'
import { NODE_WIDTH, layoutGraph } from '../layout'
import type { Graph as GraphData } from '../types'

const nodeTypes = { feature: FeatureNode }
const fitViewOptions = { padding: 0.2 }

interface Props {
  graph: GraphData
  editMode: boolean
  selectedId: number | null
  onSelect: (id: number | null) => void
  onConnect: (source: number, target: number) => void
  onAddFirst: () => void
}

export default function Graph({
  graph,
  editMode,
  selectedId,
  onSelect,
  onConnect,
  onAddFirst,
}: Props) {
  const { fitView } = useReactFlow()

  const { nodes, edges } = useMemo(() => {
    const positions = layoutGraph(graph.nodes, graph.edges)
    const flowNodes: Node[] = graph.nodes.flatMap((feature) => {
      const position = positions.get(feature.id)
      if (!position) return []
      return [
        {
          id: String(feature.id),
          type: 'feature',
          position: { x: position.x, y: position.y },
          width: NODE_WIDTH,
          height: position.height,
          selected: feature.id === selectedId,
          data: { feature, editable: editMode, rank: position.rank },
          ariaLabel: `${feature.title}, ${feature.status}`,
        },
      ]
    })

    const flowEdges: Edge[] = graph.edges.map((edge) => ({
      id: String(edge.id),
      source: String(edge.source_id),
      target: String(edge.target_id),
      type: 'smoothstep',
      focusable: true,
    }))

    return { nodes: flowNodes, edges: flowEdges }
  }, [graph, editMode, selectedId])

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
            ? 'Nothing planned here yet. Add the first feature.'
            : 'Nothing planned here yet.'}
        </p>
        {editMode ? (
          <button type="button" className="button button--primary" onClick={onAddFirst}>
            Add the first feature
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
      onConnect={(connection: Connection) => {
        if (connection.source && connection.target) {
          onConnect(Number(connection.source), Number(connection.target))
        }
      }}
    >
      <Background variant={BackgroundVariant.Lines} gap={16} size={1} color="var(--grid)" />
      {/* Zoom in/out/fit only -- no minimap, no interactivity lock. */}
      <Controls showZoom showFitView showInteractive={false} position="bottom-left" />
    </ReactFlow>
  )
}
