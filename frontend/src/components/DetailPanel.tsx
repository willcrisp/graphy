/** The side panel for the selected task: a read-only summary in View mode,
 *  editable fields (saving on blur) in Edit mode, plus its incoming/outgoing
 *  connections. Local field state is a draft that only reaches the server
 *  through `onSave` -- see the effect below that re-seeds it whenever the
 *  selected task changes. */

import { useEffect, useRef, useState } from 'react'
import {
  STATUSES,
  STATUS_GLYPH,
  STATUS_LABEL,
  type TaskNodeData,
  type Status,
} from '../types'

export type SaveState = 'idle' | 'saving' | 'saved'

interface Props {
  task: TaskNodeData
  editable: boolean
  saveState: SaveState
  error: string | null
  incoming: TaskNodeData[]
  outgoing: TaskNodeData[]
  onSave: (changes: { title?: string; detail?: string | null; status?: Status }) => void
  onDelete: () => void
  onDisconnect: (otherId: number, direction: 'in' | 'out') => void
  onClose: () => void
  onSelectTask: (id: number) => void
}

export default function DetailPanel({
  task,
  editable,
  saveState,
  error,
  incoming,
  outgoing,
  onSave,
  onDelete,
  onDisconnect,
  onClose,
  onSelectTask,
}: Props) {
  const [title, setTitle] = useState(task.title)
  const [detail, setDetail] = useState(task.detail ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const panel = useRef<HTMLElement>(null)

  // Re-seed the fields when a different task is selected, and drop any
  // half-finished delete confirmation with it.
  useEffect(() => {
    setTitle(task.title)
    setDetail(task.detail ?? '')
    setConfirmingDelete(false)
  }, [task.id, task.title, task.detail])

  const dirty = title.trim() !== task.title || detail.trim() !== (task.detail ?? '')

  function save() {
    if (!dirty || !title.trim()) return
    onSave({ title: title.trim(), detail: detail.trim() || null })
  }

  return (
    <aside
      ref={panel}
      className="panel"
      aria-label={`Task: ${task.title}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <header className="panel__head">
        <span className="panel__id mono">
          Task {String(task.id).padStart(3, '0')}
          {/* Set only by an importer (e.g. a Jira sync), never by this panel. */}
          {task.external_ref ? ` · ${task.external_ref}` : ''}
        </span>
        <button type="button" className="panel__close" onClick={onClose}>
          <span aria-hidden="true">×</span>
          <span className="visually-hidden">Close panel</span>
        </button>
      </header>

      <div className="panel__scroll">
        {task.is_root ? (
          <>
            <p className="panel__status mono">Root</p>
            <h2 className="panel__title">{task.title}</h2>
            <p className="panel__detail panel__detail--empty">
              The app itself, standing at the top of the board. Renamed by
              renaming the app; it has no status or connections of its own.
            </p>
          </>
        ) : editable ? (
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
                      task.status === status ? ' statuspick__option--on' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name={`status-${task.id}`}
                      value={status}
                      checked={task.status === status}
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
            <p className={`panel__status mono panel__status--${task.status}`}>
              <span aria-hidden="true">{STATUS_GLYPH[task.status]}</span>
              {STATUS_LABEL[task.status]}
            </p>
            <h2 className="panel__title">{task.title}</h2>
            {task.detail ? (
              <p className="panel__detail">{task.detail}</p>
            ) : (
              <p className="panel__detail panel__detail--empty">No detail recorded.</p>
            )}
          </>
        )}

        <Connections
          heading="Depends on"
          tasks={incoming}
          editable={editable}
          onSelect={onSelectTask}
          onRemove={(id) => onDisconnect(id, 'in')}
        />
        <Connections
          heading="Leads to"
          tasks={outgoing}
          editable={editable}
          onSelect={onSelectTask}
          onRemove={(id) => onDisconnect(id, 'out')}
        />

        {error ? (
          <p className="panel__error" role="alert">
            {error}
          </p>
        ) : null}

        {editable && !task.is_root ? (
          <div className="panel__danger">
            {confirmingDelete ? (
              <>
                <p className="panel__confirm">
                  Delete “{task.title}”? Its connections go with it. Tasks that
                  depended on it stay, unconnected.
                </p>
                <div className="panel__confirmrow">
                  <button type="button" className="button button--danger" onClick={onDelete}>
                    Delete task
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
                Delete task…
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
  tasks,
  editable,
  onSelect,
  onRemove,
}: {
  heading: string
  tasks: TaskNodeData[]
  editable: boolean
  onSelect: (id: number) => void
  onRemove: (id: number) => void
}) {
  if (!tasks.length) return null
  return (
    <section className="links">
      <h3 className="links__head mono">{heading}</h3>
      <ul className="links__list">
        {tasks.map((task) => (
          <li key={task.id} className="links__item">
            <button
              type="button"
              className={`links__link links__link--${task.status}`}
              onClick={() => onSelect(task.id)}
            >
              <span aria-hidden="true">{STATUS_GLYPH[task.status]}</span>
              {task.title}
            </button>
            {editable ? (
              <button
                type="button"
                className="links__cut"
                onClick={() => onRemove(task.id)}
                title={`Disconnect ${task.title}`}
              >
                <span aria-hidden="true">×</span>
                <span className="visually-hidden">Disconnect {task.title}</span>
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
