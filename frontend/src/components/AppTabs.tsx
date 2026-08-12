/** The tab strip across the top: one tab per app, preceded by the overview
 *  tab that draws all of them on one canvas. A `role="tablist"` with full
 *  roving keyboard navigation (arrows/Home/End, plus the keyboard route to a
 *  tab's context menu) -- see `onKeyDown` below. */

import { useEffect } from 'react'
import { totalOf, type AppSummary } from '../types'

/** The overview tab's key. Not a possible app key (`_slug` in
 *  services/graph.py only ever emits `[a-z0-9-]`), so it can stand in for one
 *  everywhere the strip needs a single identifier. */
export const OVERVIEW_TAB = '*all*'

interface Props {
  apps: AppSummary[]
  /** null when the overview tab is the selected one. */
  activeKey: string | null
  editMode: boolean
  onSelect: (key: string) => void
  onSelectOverview: () => void
  onMenu: (key: string, x: number, y: number) => void
  onAdd: () => void
}

export default function AppTabs({
  apps,
  activeKey,
  editMode,
  onSelect,
  onSelectOverview,
  onMenu,
  onAdd,
}: Props) {
  const current = activeKey ?? OVERVIEW_TAB
  // Roving navigation runs over the overview tab and the apps together, so
  // Left from the first board lands on All rather than wrapping past it.
  const keys = [OVERVIEW_TAB, ...apps.map((app) => app.key)]

  // The strip scrolls horizontally on narrow screens, so a tab reached by
  // keyboard or by URL can be off-screen. Bring it into view.
  useEffect(() => {
    document
      .getElementById(`tab-${current}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])

  function open(key: string) {
    if (key === OVERVIEW_TAB) onSelectOverview()
    else onSelect(key)
  }

  /** Roving arrow-key navigation, as expected of a tablist. */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Shift+F10 and the menu key are the keyboard route to a context menu, so
    // renaming a tab never requires a mouse. Anchored to the tab, not a pointer.
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const tab = (event.target as HTMLElement).closest('.tab')
      if (!(tab instanceof HTMLElement) || !tab.dataset.key) return
      // The overview has no app-level actions of its own -- there is nothing
      // to rename or delete -- so it has no menu.
      if (tab.dataset.key === OVERVIEW_TAB) return
      event.preventDefault()
      const box = tab.getBoundingClientRect()
      onMenu(tab.dataset.key, box.left, box.bottom)
      return
    }

    const delta =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const jump =
      event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : null

    if (!delta && jump === null) return
    event.preventDefault()

    const index = keys.indexOf(current)
    const next = jump ?? (index + delta + keys.length) % keys.length
    const target = keys[next]
    if (target) {
      open(target)
      document.getElementById(`tab-${target}`)?.focus()
    }
  }

  const total = apps.reduce((sum, app) => sum + totalOf(app.counts), 0)
  const overviewActive = activeKey === null

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Applications" onKeyDown={onKeyDown}>
        <button
          id={`tab-${OVERVIEW_TAB}`}
          type="button"
          role="tab"
          data-key={OVERVIEW_TAB}
          aria-selected={overviewActive}
          aria-controls="canvas"
          tabIndex={overviewActive ? 0 : -1}
          className={`tab tab--all${overviewActive ? ' tab--active' : ''}`}
          onClick={onSelectOverview}
        >
          <span className="tab__mark" aria-hidden="true" />
          <span className="tab__name">All</span>
          <span className="tab__count mono">
            {total}
            <span className="visually-hidden"> tasks across every board</span>
          </span>
        </button>
        {apps.map((app) => {
          const active = app.key === current
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
                {totalOf(app.counts)}
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
