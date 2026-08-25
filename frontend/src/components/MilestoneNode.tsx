/** A milestone: a dated rule drawn across the sheet.
 *
 *  Laid out as a node so dagre gives it a rank alongside the tasks (see
 *  `layoutGraph`'s `spans`), then stretched to the drawing's width -- so this
 *  renders into a box that is already the right shape, exactly as `TaskNode`
 *  does. It carries no handles: nothing connects to a date.
 *
 *  Three things sit on the line, left to right: what it is, how the work due by
 *  it is going, and when it is. The tally in the middle is what makes the rule
 *  worth drawing -- "Q1 2026" states an intention, "Q1 2026, four done and one
 *  blocked" answers the question that intention was asked about. */

import type { NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../canvas'
import { STATUSES, STATUS_GLYPH, STATUS_LABEL, totalOf } from '../types'

export interface MilestoneNodeProps extends Record<string, unknown> {
  task: CanvasNode
  rank: number
}

/** `31 MAR 2026`. Parsed as UTC on purpose: `due_on` is a calendar day, and
 *  `new Date('2026-03-31')` is midnight UTC, which formats as the day before
 *  for any viewer west of Greenwich unless the timezone is pinned back. */
function formatDue(iso: string | null): string {
  if (!iso) return 'No date'
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'No date'
  return date
    .toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
    .toUpperCase()
}

export default function MilestoneNode({ data }: NodeProps) {
  const { task, rank } = data as unknown as MilestoneNodeProps
  const mark = task.mark
  if (!mark) return null

  const total = totalOf(mark.counts)
  // Only the statuses actually present are drawn. A line with nothing due by it
  // says so in words; one with work on it should not pad the row with zeroes.
  const present = STATUSES.filter((status) => mark.counts[status] > 0)

  return (
    <div
      className={`datum${mark.overdue ? ' datum--overdue' : ''}`}
      style={{ '--stagger': `${Math.min(rank, 8) * 26}ms` } as React.CSSProperties}
    >
      <span className="datum__label mono">{task.title}</span>
      <span className="datum__rule" aria-hidden="true" />
      <span className="datum__tally mono">
        {total === 0
          ? 'Nothing due'
          : present.map((status) => (
              <span key={status} className={`datum__count datum__count--${status}`}>
                <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
                <span className="visually-hidden">{STATUS_LABEL[status]} </span>
                {mark.counts[status]}
              </span>
            ))}
      </span>
      <span className="datum__due mono">
        {/* The word carries the slip, not the colour -- same rule as the
            status glyphs on a task. */}
        {mark.overdue ? 'Overdue · ' : ''}
        {formatDue(mark.due_on)}
      </span>
    </div>
  )
}
