/** The drawn node: a glyph-and-label pill, styled entirely in app.css. React
 *  Flow calls this per node with whatever `data` `Graph.tsx` attached; it
 *  renders, it does not decide layout or handle clicks itself. */

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../canvas'
import type { Direction } from '../direction'
import { STATUS_GLYPH, STATUS_LABEL } from '../types'

export interface TaskNodeProps extends Record<string, unknown> {
  task: CanvasNode
  selected: boolean
  editable: boolean
  /** Dagre rank, used to stagger the entry animation along the layout axis. */
  rank: number
  /** Which way the graph builds, which is what decides where the handles sit
   *  (see below). Handed down from `Graph.tsx` rather than read from the
   *  `<html>` attribute, so the handles and the layout can only ever come from
   *  the same value. */
  direction: Direction
}

/** The word in the annotation slot where a task shows its status. A root and a
 *  parent project have none -- they say what they are instead. */
const KIND_LABEL = { root: 'Board', parent: 'Parent project' } as const

/** Where an edge meets a node: it enters from the rank before and leaves
 *  toward the rank after, so both follow the direction the graph builds.
 *  Handle placement is the one part of the drawing CSS cannot do -- React Flow
 *  anchors edge paths to the handles themselves. */
const HANDLE_SIDES = {
  down: { in: Position.Top, out: Position.Bottom },
  across: { in: Position.Left, out: Position.Right },
} as const

export default function TaskNode({ data }: NodeProps) {
  const { task, editable, rank, direction } = data as unknown as TaskNodeProps
  const isTask = task.kind === 'task'
  const sides = HANDLE_SIDES[direction]

  return (
    <div
      className={`task${isTask ? ` task--${task.status}` : ` task--${task.kind}`}`}
      style={{ '--stagger': `${Math.min(rank, 8) * 26}ms` } as React.CSSProperties}
    >
      <Handle
        type="target"
        position={sides.in}
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
        position={sides.out}
        isConnectable={editable && isTask}
        className="task__handle task__handle--out"
      />
    </div>
  )
}
