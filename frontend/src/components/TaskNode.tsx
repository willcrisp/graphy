/** The drawn task card (or, under Neptune, glyph-and-label pill -- the rest
 *  of that reskin is CSS-only, see `[data-graph-style='neptune']` in
 *  app.css). React Flow calls this per node with whatever `data` `Graph.tsx`
 *  attached; it renders, it does not decide layout or handle clicks itself. */

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { GraphStyle } from '../graphStyle'
import { STATUS_GLYPH, STATUS_LABEL, type TaskNodeData } from '../types'

export interface TaskNodeProps extends Record<string, unknown> {
  task: TaskNodeData
  selected: boolean
  editable: boolean
  /** Dagre rank, used to stagger the entry animation along the layout axis. */
  rank: number
  /** Everything else about the two graph styles is CSS-only (see app.css),
   *  but handle placement genuinely has to change: React Flow uses it to
   *  anchor edge paths, and a vertical graph needs top/bottom anchors where
   *  the horizontal one needs left/right. */
  style: GraphStyle
}

export default function TaskNode({ data }: NodeProps) {
  const { task, editable, rank, style } = data as unknown as TaskNodeProps
  const vertical = style === 'neptune'

  return (
    <div
      className={`task task--${task.status}`}
      style={{ '--stagger': `${Math.min(rank, 8) * 26}ms` } as React.CSSProperties}
    >
      <span className="task__rail" aria-hidden="true" />
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
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
        position={vertical ? Position.Bottom : Position.Right}
        isConnectable={editable}
        className="task__handle task__handle--out"
      />
    </div>
  )
}
