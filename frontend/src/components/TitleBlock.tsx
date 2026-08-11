import { STATUSES, STATUS_LABEL, type AppInfo, type StatusCounts } from '../types'

interface Props {
  app: AppInfo
  counts: StatusCounts
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

/**
 * The title block from an engineering drawing: a bordered box of ruled cells,
 * anchored bottom-right. It is the one dense element on the canvas, and it
 * earns that by carrying the app identity, the tally, and the revision date.
 */
export default function TitleBlock({ app, counts, lastUpdated }: Props) {
  const total = STATUSES.reduce((sum, status) => sum + counts[status], 0)

  return (
    <figure
      className="titleblock"
      style={{ '--accent': app.accent } as React.CSSProperties}
    >
      <figcaption className="visually-hidden">
        {app.name}: {total} features. {STATUSES.map((s) => `${counts[s]} ${STATUS_LABEL[s]}`).join(', ')}.
        Last updated {formatDate(lastUpdated)}.
      </figcaption>

      <div className="titleblock__row titleblock__row--head">
        <div className="titleblock__cell titleblock__cell--name">
          <span className="titleblock__key mono">Application</span>
          <span className="titleblock__value titleblock__value--display">{app.name}</span>
        </div>
        <div className="titleblock__cell titleblock__cell--total">
          <span className="titleblock__key mono">Features</span>
          <span className="titleblock__value mono titleblock__value--total">{total}</span>
        </div>
      </div>

      <div className="titleblock__row titleblock__row--tally" aria-hidden="true">
        {STATUSES.map((status) => (
          <div key={status} className={`titleblock__cell titleblock__tally titleblock__tally--${status}`}>
            <span className="titleblock__key mono">{status}</span>
            <span className="titleblock__value mono">
              {String(counts[status]).padStart(2, '0')}
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
          <span className="titleblock__key mono">Sheet</span>
          <span className="titleblock__value mono">{app.key}</span>
        </div>
      </div>
    </figure>
  )
}
