import { Handle, Position, type NodeProps } from '@xyflow/react'
import { STATUS_GLYPH, STATUS_LABEL, type FeatureNodeData } from '../types'

export interface FeatureNodeProps extends Record<string, unknown> {
  feature: FeatureNodeData
  selected: boolean
  editable: boolean
  /** Dagre rank, used to stagger the entry animation left to right. */
  rank: number
}

export default function FeatureNode({ data }: NodeProps) {
  const { feature, editable, rank } = data as unknown as FeatureNodeProps

  return (
    <div
      className={`feature feature--${feature.status}`}
      style={{ '--stagger': `${Math.min(rank, 8) * 26}ms` } as React.CSSProperties}
    >
      <span className="feature__rail" aria-hidden="true" />
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={editable}
        className="feature__handle feature__handle--in"
      />
      <div className="feature__body">
        <p className="feature__status mono">
          <span className="feature__glyph" aria-hidden="true">
            {STATUS_GLYPH[feature.status]}
          </span>
          {STATUS_LABEL[feature.status]}
        </p>
        <p className="feature__title">{feature.title}</p>
        {feature.detail ? <p className="feature__detail">{feature.detail}</p> : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={editable}
        className="feature__handle feature__handle--out"
      />
    </div>
  )
}
