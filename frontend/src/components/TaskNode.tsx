import { Handle, Position, type NodeProps } from '@xyflow/react'
import { STATUS_GLYPH, STATUS_LABEL, type TaskNodeData } from '../types'

export interface TaskNodeProps extends Record<string, unknown> {
  task: TaskNodeData
  selected: boolean
  editable: boolean
  /** Dagre rank, used to stagger the entry animation left to right. */
  rank: number
}

export default function TaskNode({ data }: NodeProps) {
  const { task, editable, rank } = data as unknown as TaskNodeProps

  return (
    <div
      className={`task task--${task.status}`}
      style={{ '--stagger': `${Math.min(rank, 8) * 26}ms` } as React.CSSProperties}
    >
      <span className="task__rail" aria-hidden="true" />
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={editable}
        className="task__handle task__handle--in"
      />
      <div className="task__body">
        <p className="task__status mono">
          <span className="task__glyph" aria-hidden="true">
            {STATUS_GLYPH[task.status]}
          </span>
          {STATUS_LABEL[task.status]}
        </p>
        <p className="task__title">{task.title}</p>
        {task.detail ? <p className="task__detail">{task.detail}</p> : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={editable}
        className="task__handle task__handle--out"
      />
    </div>
  )
}
