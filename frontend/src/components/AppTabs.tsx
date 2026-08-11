import { useEffect } from 'react'
import type { AppSummary } from '../types'

interface Props {
  apps: AppSummary[]
  activeKey: string
  editMode: boolean
  onSelect: (key: string) => void
  onMenu: (key: string, x: number, y: number) => void
  onAdd: () => void
}

export default function AppTabs({
  apps,
  activeKey,
  editMode,
  onSelect,
  onMenu,
  onAdd,
}: Props) {
  // The strip scrolls horizontally on narrow screens, so a tab reached by
  // keyboard or by URL can be off-screen. Bring it into view.
  useEffect(() => {
    document
      .getElementById(`tab-${activeKey}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeKey])

  /** Roving arrow-key navigation, as expected of a tablist. */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Shift+F10 and the menu key are the keyboard route to a context menu, so
    // renaming a tab never requires a mouse. Anchored to the tab, not a pointer.
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const tab = (event.target as HTMLElement).closest('.tab')
      if (!(tab instanceof HTMLElement) || !tab.dataset.key) return
      event.preventDefault()
      const box = tab.getBoundingClientRect()
      onMenu(tab.dataset.key, box.left, box.bottom)
      return
    }

    const delta =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const jump =
      event.key === 'Home' ? 0 : event.key === 'End' ? apps.length - 1 : null

    if (!delta && jump === null) return
    event.preventDefault()

    const current = apps.findIndex((app) => app.key === activeKey)
    const next =
      jump ?? (current + delta + apps.length) % apps.length
    const target = apps[next]
    if (target) {
      onSelect(target.key)
      document.getElementById(`tab-${target.key}`)?.focus()
    }
  }

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Applications" onKeyDown={onKeyDown}>
        {apps.map((app) => {
          const total =
            app.counts.done + app.counts.wip + app.counts.todo + app.counts.blocked
          const active = app.key === activeKey
          return (
            <button
              key={app.key}
              id={`tab-${app.key}`}
              type="button"
              role="tab"
              data-key={app.key}
              aria-selected={active}
              aria-controls="canvas"
              tabIndex={active ? 0 : -1}
              className={`tab${active ? ' tab--active' : ''}`}
              style={{ '--tab-accent': app.accent } as React.CSSProperties}
              onClick={() => onSelect(app.key)}
              onContextMenu={(event) => {
                event.preventDefault()
                onMenu(app.key, event.clientX, event.clientY)
              }}
            >
              <span className="tab__mark" aria-hidden="true" />
              <span className="tab__name">{app.name}</span>
              <span className="tab__count mono">
                {total}
                <span className="visually-hidden"> tasks</span>
              </span>
            </button>
          )
        })}
      </div>
      {editMode ? (
        <button type="button" className="tab tab--add mono" onClick={onAdd}>
          <span aria-hidden="true">+</span> New app
        </button>
      ) : null}
    </>
  )
}
