import { STATUSES, STATUS_LABEL, totalOf, type AppInfo, type AppSummary, type StatusCounts } from '../types'

interface Props {
  /** The board being drawn, or null on the overview -- which is every board
   *  at once and so is not any one of them. */
  app: AppInfo | null
  apps: AppSummary[]
  /** That board's counts, or null on the overview, where they are summed
   *  across `apps` instead. */
  counts: StatusCounts | null
  parentCount: number
  lastUpdated: string | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '--'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--'
  return date
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase()
}

/** Sum every board's tally into one. The overview's title block reports the
 *  whole estate, so it needs the four statuses added up across apps rather
 *  than any single board's. */
function sumCounts(apps: AppSummary[]): StatusCounts {
  const total: StatusCounts = { done: 0, wip: 0, todo: 0, blocked: 0 }
  for (const app of apps) for (const status of STATUSES) total[status] += app.counts[status]
  return total
}

/**
 * The title block from an engineering drawing: a bordered box of ruled cells,
 * anchored bottom-right. It is the one dense element on the canvas, and it
 * earns that by carrying the app identity, the tally, and the revision date.
 *
 * On the overview the same three rows say the same three things one level up:
 * every board rather than one, the summed tally, and how the sheet is divided
 * (boards and parent projects) in place of the sheet number.
 */
export default function TitleBlock({ app, apps, counts, parentCount, lastUpdated }: Props) {
  const tally = counts ?? sumCounts(apps)
  const total = totalOf(tally)
  const name = app?.name ?? 'All projects'

  return (
    <figure
      className={`titleblock${app ? '' : ' titleblock--overview'}`}
      style={app ? ({ '--accent': app.accent } as React.CSSProperties) : undefined}
    >
      <figcaption className="visually-hidden">
        {name}: {total} tasks. {STATUSES.map((s) => `${tally[s]} ${STATUS_LABEL[s]}`).join(', ')}.
        Last updated {formatDate(lastUpdated)}.
      </figcaption>

      <div className="titleblock__row titleblock__row--head">
        <div className="titleblock__cell titleblock__cell--name">
          <span className="titleblock__key mono">{app ? 'Application' : 'Overview'}</span>
          <span className="titleblock__value titleblock__value--display">{name}</span>
        </div>
        <div className="titleblock__cell titleblock__cell--total">
          <span className="titleblock__key mono">Tasks</span>
          <span className="titleblock__value mono titleblock__value--total">{total}</span>
        </div>
      </div>

      <div className="titleblock__row titleblock__row--tally" aria-hidden="true">
        {STATUSES.map((status) => (
          <div key={status} className={`titleblock__cell titleblock__tally titleblock__tally--${status}`}>
            <span className="titleblock__key mono">{status}</span>
            <span className="titleblock__value mono">
              {String(tally[status]).padStart(2, '0')}
            </span>
          </div>
        ))}
      </div>

      <div className="titleblock__row titleblock__row--foot">
        <div className="titleblock__cell titleblock__cell--rev">
          <span className="titleblock__key mono">Revised</span>
          <span className="titleblock__value mono">{formatDate(lastUpdated)}</span>
        </div>
        <div className="titleblock__cell titleblock__cell--sheet">
          <span className="titleblock__key mono">{app ? 'Sheet' : 'Sheets'}</span>
          <span className="titleblock__value mono">
            {app ? app.key : `${apps.length} / ${parentCount} parent`}
          </span>
        </div>
      </div>
    </figure>
  )
}
