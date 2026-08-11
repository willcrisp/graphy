import { useEffect, useRef, useState } from 'react'
import {
  STATUSES,
  STATUS_GLYPH,
  STATUS_LABEL,
  type FeatureNodeData,
  type Status,
} from '../types'

export type SaveState = 'idle' | 'saving' | 'saved'

interface Props {
  feature: FeatureNodeData
  editable: boolean
  saveState: SaveState
  error: string | null
  incoming: FeatureNodeData[]
  outgoing: FeatureNodeData[]
  onSave: (changes: { title?: string; detail?: string | null; status?: Status }) => void
  onDelete: () => void
  onDisconnect: (otherId: number, direction: 'in' | 'out') => void
  onClose: () => void
  onSelectFeature: (id: number) => void
}

export default function DetailPanel({
  feature,
  editable,
  saveState,
  error,
  incoming,
  outgoing,
  onSave,
  onDelete,
  onDisconnect,
  onClose,
  onSelectFeature,
}: Props) {
  const [title, setTitle] = useState(feature.title)
  const [detail, setDetail] = useState(feature.detail ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const panel = useRef<HTMLElement>(null)

  // Re-seed the fields when a different feature is selected, and drop any
  // half-finished delete confirmation with it.
  useEffect(() => {
    setTitle(feature.title)
    setDetail(feature.detail ?? '')
    setConfirmingDelete(false)
  }, [feature.id, feature.title, feature.detail])

  const dirty = title.trim() !== feature.title || detail.trim() !== (feature.detail ?? '')

  function save() {
    if (!dirty || !title.trim()) return
    onSave({ title: title.trim(), detail: detail.trim() || null })
  }

  return (
    <aside
      ref={panel}
      className="panel"
      aria-label={`Feature: ${feature.title}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <header className="panel__head">
        <span className="panel__id mono">Feature {String(feature.id).padStart(3, '0')}</span>
        <button type="button" className="panel__close" onClick={onClose}>
          <span aria-hidden="true">×</span>
          <span className="visually-hidden">Close panel</span>
        </button>
      </header>

      <div className="panel__scroll">
        {editable ? (
          <>
            <label className="field">
              <span className="field__label mono">Title</span>
              <input
                className="field__input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={save}
                maxLength={200}
              />
            </label>

            <fieldset className="field field--status">
              <legend className="field__label mono">Status</legend>
              <div className="statuspick">
                {STATUSES.map((status) => (
                  <label
                    key={status}
                    className={`statuspick__option statuspick__option--${status}${
                      feature.status === status ? ' statuspick__option--on' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name={`status-${feature.id}`}
                      value={status}
                      checked={feature.status === status}
                      onChange={() => onSave({ status })}
                      className="visually-hidden"
                    />
                    <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
                    <span className="mono">{STATUS_LABEL[status]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="field">
              <span className="field__label mono">Detail</span>
              <textarea
                className="field__input field__input--area"
                value={detail}
                rows={5}
                maxLength={2000}
                onChange={(event) => setDetail(event.target.value)}
                onBlur={save}
                placeholder="One short paragraph."
              />
            </label>

            <div className="panel__saverow">
              <button
                type="button"
                className="button button--primary"
                onClick={save}
                disabled={!dirty || !title.trim()}
              >
                Save
              </button>
              <span className="panel__savestate mono" role="status">
                {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : dirty ? 'Unsaved' : ''}
              </span>
            </div>
          </>
        ) : (
          <>
            <p className={`panel__status mono panel__status--${feature.status}`}>
              <span aria-hidden="true">{STATUS_GLYPH[feature.status]}</span>
              {STATUS_LABEL[feature.status]}
            </p>
            <h2 className="panel__title">{feature.title}</h2>
            {feature.detail ? (
              <p className="panel__detail">{feature.detail}</p>
            ) : (
              <p className="panel__detail panel__detail--empty">No detail recorded.</p>
            )}
          </>
        )}

        <Connections
          heading="Depends on"
          features={incoming}
          editable={editable}
          onSelect={onSelectFeature}
          onRemove={(id) => onDisconnect(id, 'in')}
        />
        <Connections
          heading="Leads to"
          features={outgoing}
          editable={editable}
          onSelect={onSelectFeature}
          onRemove={(id) => onDisconnect(id, 'out')}
        />

        {error ? (
          <p className="panel__error" role="alert">
            {error}
          </p>
        ) : null}

        {editable ? (
          <div className="panel__danger">
            {confirmingDelete ? (
              <>
                <p className="panel__confirm">
                  Delete “{feature.title}”? Its connections go with it. Features that
                  depended on it stay, unconnected.
                </p>
                <div className="panel__confirmrow">
                  <button type="button" className="button button--danger" onClick={onDelete}>
                    Delete feature
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Keep it
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete feature…
              </button>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function Connections({
  heading,
  features,
  editable,
  onSelect,
  onRemove,
}: {
  heading: string
  features: FeatureNodeData[]
  editable: boolean
  onSelect: (id: number) => void
  onRemove: (id: number) => void
}) {
  if (!features.length) return null
  return (
    <section className="links">
      <h3 className="links__head mono">{heading}</h3>
      <ul className="links__list">
        {features.map((feature) => (
          <li key={feature.id} className="links__item">
            <button
              type="button"
              className={`links__link links__link--${feature.status}`}
              onClick={() => onSelect(feature.id)}
            >
              <span aria-hidden="true">{STATUS_GLYPH[feature.status]}</span>
              {feature.title}
            </button>
            {editable ? (
              <button
                type="button"
                className="links__cut"
                onClick={() => onRemove(feature.id)}
                title={`Disconnect ${feature.title}`}
              >
                <span aria-hidden="true">×</span>
                <span className="visually-hidden">Disconnect {feature.title}</span>
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
