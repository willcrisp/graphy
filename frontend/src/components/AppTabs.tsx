import { useEffect } from 'react'
import type { AppSummary } from '../types'

interface Props {
  apps: AppSummary[]
  activeKey: string
  onSelect: (key: string) => void
}

export default function AppTabs({ apps, activeKey, onSelect }: Props) {
  // The strip scrolls horizontally on narrow screens, so a tab reached by
  // keyboard or by URL can be off-screen. Bring it into view.
  useEffect(() => {
    document
      .getElementById(`tab-${activeKey}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeKey])

  /** Roving arrow-key navigation, as expected of a tablist. */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
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
            aria-selected={active}
            aria-controls="canvas"
            tabIndex={active ? 0 : -1}
            className={`tab${active ? ' tab--active' : ''}`}
            style={{ '--tab-accent': app.accent } as React.CSSProperties}
            onClick={() => onSelect(app.key)}
          >
            <span className="tab__mark" aria-hidden="true" />
            <span className="tab__name">{app.name}</span>
            <span className="tab__count mono">
              {total}
              <span className="visually-hidden"> features</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
