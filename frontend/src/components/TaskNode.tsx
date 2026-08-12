/** The drawn node: a glyph-and-label pill, styled entirely in app.css. React
 *  Flow calls this per node with whatever `data` `Graph.tsx` attached; it
 *  renders, it does not decide layout or handle clicks itself. */

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../canvas'
import { STATUS_GLYPH, STATUS_LABEL } from '../types'

export interface TaskNodeProps extends Record<string, unknown> {
  task: CanvasNode
  selected: boolean
  editable: boolean
  /** Dagre rank, used to stagger the entry animation along the layout axis. */
  rank: number
}

/** The word in the annotation slot where a task shows its status. A root and a
 *  parent project have none -- they say what they are instead. */
const KIND_LABEL = { root: 'Board', parent: 'Parent project' } as const

export default function TaskNode({ data }: NodeProps) {
  const { task, editable, rank } = data as unknown as TaskNodeProps
  const isTask = task.kind === 'task'

  return (
    <div
      className={`task${isTask ? ` task--${task.status}` : ` task--${task.kind}`}`}
      style={{ '--stagger': `${Math.min(rank, 8) * 26}ms` } as React.CSSProperties}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={editable && isTask}
        className="task__handle task__handle--in"
      />
      <div className="task__body">
        <p className="task__status mono">
          {task.kind === 'task' ? (
            <>
              <span className="task__glyph" aria-hidden="true">
                {STATUS_GLYPH[task.status]}
              </span>
              {STATUS_LABEL[task.status]}
            </>
          ) : (
            KIND_LABEL[task.kind]
          )}
        </p>
        <p className="task__title">{task.title}</p>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={editable && isTask}
        className="task__handle task__handle--out"
      />
    </div>
  )
}
