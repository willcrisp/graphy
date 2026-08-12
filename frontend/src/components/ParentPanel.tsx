/** The side panel for a selected parent project.
 *
 *  Its own component rather than a branch inside `DetailPanel`, because almost
 *  nothing about a task applies: a parent project has no status, no
 *  dependencies, and no board of its own. What it has instead is the list of
 *  boards hanging off it, which is the only place in the UI that list exists.
 *
 *  It reuses `DetailPanel`'s classes -- same chrome, same fields, same danger
 *  zone -- so the two read as one panel with two contents.
 */

import { useEffect, useState } from 'react'
import type { SaveState } from './DetailPanel'
import { totalOf, type AppSummary, type ParentProject } from '../types'

interface Props {
  parent: ParentProject
  /** The boards attached to this parent project. */
  apps: AppSummary[]
  editable: boolean
  saveState: SaveState
  error: string | null
  onSave: (changes: { name?: string; detail?: string | null }) => void
  onDelete: () => void
  onDetach: (key: string) => void
  onOpenApp: (key: string) => void
  onClose: () => void
}

export default function ParentPanel({
  parent,
  apps,
  editable,
  saveState,
  error,
  onSave,
  onDelete,
  onDetach,
  onOpenApp,
  onClose,
}: Props) {
  const [name, setName] = useState(parent.name)
  const [detail, setDetail] = useState(parent.detail ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Re-seed when the server's copy changes under us -- a rename lands as a
  // whole new overview, not a patch to the field being typed into.
  useEffect(() => {
    setName(parent.name)
    setDetail(parent.detail ?? '')
    setConfirmingDelete(false)
  }, [parent.id, parent.name, parent.detail])

  const dirty = name.trim() !== parent.name || detail.trim() !== (parent.detail ?? '')

  function save() {
    if (!dirty || !name.trim()) return
    onSave({ name: name.trim(), detail: detail.trim() || null })
  }

  return (
    <aside
      className="panel"
      aria-label={`Parent project: ${parent.name}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <header className="panel__head">
        <span className="panel__id mono">
          Parent project {String(parent.id).padStart(3, '0')}
        </span>
        <button type="button" className="panel__close" onClick={onClose}>
          <span aria-hidden="true">×</span>
          <span className="visually-hidden">Close panel</span>
        </button>
      </header>

      <div className="panel__scroll">
        {editable ? (
          <>
            <label className="field">
              <span className="field__label mono">Name</span>
              <input
                className="field__input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={save}
                maxLength={128}
              />
            </label>

            <label className="field">
              <span className="field__label mono">Description</span>
              <textarea
                className="field__input field__input--area"
                value={detail}
                rows={6}
                maxLength={2000}
                onChange={(event) => setDetail(event.target.value)}
                onBlur={save}
                placeholder="What these boards have in common."
              />
            </label>

            <div className="panel__saverow">
              <button
                type="button"
                className="button button--primary"
                onClick={save}
                disabled={!dirty || !name.trim()}
              >
                Save
              </button>
              <span className="panel__savestate mono" role="status">
                {saveState === 'saving'
                  ? 'Saving…'
                  : saveState === 'saved'
                    ? 'Saved'
                    : dirty
                      ? 'Unsaved'
                      : ''}
              </span>
            </div>
          </>
        ) : (
          <>
            <p className="panel__status mono">Parent project</p>
            <h2 className="panel__title">{parent.name}</h2>
            {parent.detail ? (
              <p className="panel__detail">{parent.detail}</p>
            ) : (
              <p className="panel__detail panel__detail--empty">No description recorded.</p>
            )}
          </>
        )}

        <section className="links">
          <h3 className="links__head mono">Boards</h3>
          {apps.length ? (
            <ul className="links__list">
              {apps.map((app) => (
                <li key={app.key} className="links__item">
                  <button
                    type="button"
                    className="links__link links__link--board"
                    style={{ '--tab-accent': app.accent } as React.CSSProperties}
                    onClick={() => onOpenApp(app.key)}
                  >
                    <span aria-hidden="true">▪</span>
                    {app.name}
                    <span className="links__meta mono">{totalOf(app.counts)}</span>
                  </button>
                  {editable ? (
                    <button
                      type="button"
                      className="links__cut"
                      onClick={() => onDetach(app.key)}
                      title={`Detach ${app.name}`}
                    >
                      <span aria-hidden="true">×</span>
                      <span className="visually-hidden">Detach {app.name}</span>
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="panel__detail panel__detail--empty">
              Nothing attached yet. Right-click a board’s tab and move it here.
            </p>
          )}
        </section>

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
                  Delete “{parent.name}”?{' '}
                  {apps.length
                    ? `Its ${apps.length} board${apps.length === 1 ? '' : 's'} stay, standalone — only the grouping goes.`
                    : 'Nothing is attached to it.'}
                </p>
                <div className="panel__confirmrow">
                  <button type="button" className="button button--danger" onClick={onDelete}>
                    Delete parent project
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
                Delete parent project…
              </button>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  )
}
