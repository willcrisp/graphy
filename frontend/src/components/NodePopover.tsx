/** The view-mode answer to the side panel: a click doesn't open
 *  `DetailPanel` (see "reserve the side bar for admin mode" in App.tsx) -- it
 *  opens this read-only card anchored to the clicked node. Positioning is
 *  measured off the node's own DOM element (found via React Flow's
 *  `data-id`) rather than the click coordinates, so it stays correctly
 *  anchored regardless of how the selection was made (click, context menu,
 *  a Connections link in another popover). */

import { useLayoutEffect, useRef, useState } from 'react'
import type { CanvasNode } from '../canvas'
import { STATUS_GLYPH, STATUS_LABEL } from '../types'

interface Props {
  task: CanvasNode
  onClose: () => void
}

/** What stands in for the status line on the two node kinds that have none. */
const KIND_BLURB = {
  root: 'The app itself, at the top of the board.',
  parent: 'A parent project. The boards under it hang off this node.',
} as const

const MARGIN = 12
const GAP = 10

export default function NodePopover({ task, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const anchor = document.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${task.id}"]`,
    )
    const box = ref.current?.getBoundingClientRect()
    const anchorBox = anchor?.getBoundingClientRect()
    if (!box || !anchorBox) return
    const x = Math.max(
      MARGIN,
      Math.min(
        anchorBox.left + anchorBox.width / 2 - box.width / 2,
        window.innerWidth - box.width - MARGIN,
      ),
    )
    // Prefer sitting below the node; flip above if there's no room under it.
    const below = anchorBox.bottom + GAP
    const y =
      below + box.height + MARGIN <= window.innerHeight
        ? below
        : Math.max(MARGIN, anchorBox.top - GAP - box.height)
    setPlaced({ x, y })
  }, [task.id])

  useLayoutEffect(() => {
    // The anchor moves under pan/zoom without a re-render here, so a stale
    // popover would drift from its node -- same "dismiss rather than chase
    // it" rule ContextMenu applies to scroll/resize.
    const dismiss = () => onClose()
    const canvas = document.getElementById('canvas')
    canvas?.addEventListener('wheel', dismiss, { passive: true })
    window.addEventListener('resize', dismiss)
    return () => {
      canvas?.removeEventListener('wheel', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [onClose])

  return (
    <div className="popover-layer" onPointerDown={onClose}>
      <div
        ref={ref}
        className={
          task.kind === 'task'
            ? `node-popover node-popover--${task.status}`
            : `node-popover node-popover--${task.kind}`
        }
        role="dialog"
        aria-label={task.title}
        style={placed ? { left: placed.x, top: placed.y } : { visibility: 'hidden' }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <h2 className="node-popover__title">{task.title}</h2>
        {task.kind === 'task' ? (
          <>
            <p className="node-popover__detail">{task.detail || 'No detail recorded.'}</p>
            <span className="node-popover__status" aria-hidden="true">
              <span className="node-popover__glyph">{STATUS_GLYPH[task.status]}</span>
              {STATUS_LABEL[task.status]}
            </span>
          </>
        ) : (
          <p className="node-popover__detail">{task.detail || KIND_BLURB[task.kind]}</p>
        )}
      </div>
    </div>
  )
}
