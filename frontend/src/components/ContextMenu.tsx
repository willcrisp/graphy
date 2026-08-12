/** One context menu component for nodes, edges, tabs, and the empty canvas
 *  (see `nodeMenu`/`edgeMenu`/`tabMenu`/`paneMenu` in `App.tsx`): callers
 *  build a `MenuSpec` describing what to show, this owns positioning
 *  (flipped back into the viewport once its real size is known) and
 *  keyboard navigation. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  /** Drawn in the left gutter -- a status glyph, never colour alone. */
  mark?: string
  danger?: boolean
  disabled?: boolean
}

/** Items arrive grouped; each group after the first gets a rule above it. */
export interface MenuSpec {
  x: number
  y: number
  heading: string
  groups: MenuItem[][]
}

interface Props {
  menu: MenuSpec
  onClose: () => void
}

const MARGIN = 8

export default function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState({ x: menu.x, y: menu.y })

  const items = menu.groups.flat()

  // Flip back inside the viewport once the real size is known. Measured, not
  // guessed: label lengths vary with the task title in the heading.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const x = Math.max(MARGIN, Math.min(menu.x, window.innerWidth - box.width - MARGIN))
    const y = Math.max(MARGIN, Math.min(menu.y, window.innerHeight - box.height - MARGIN))
    setPlaced({ x, y })
  }, [menu])

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    first?.focus()
  }, [menu])

  useEffect(() => {
    // Any scroll or resize invalidates the anchor, so dismiss rather than chase it.
    const dismiss = () => onClose()
    window.addEventListener('resize', dismiss)
    window.addEventListener('wheel', dismiss, { passive: true })
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('wheel', dismiss)
    }
  }, [onClose])

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    )
    if (!buttons.length) return
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = (at + step + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <div
      className="menu-layer"
      onPointerDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div
        ref={ref}
        className="menu"
        role="menu"
        aria-label={menu.heading}
        style={{ left: placed.x, top: placed.y }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <p className="menu__heading mono">{menu.heading}</p>
        {menu.groups.map((group, index) => (
          <div className="menu__group" key={index}>
            {group.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  onClose()
                  item.onSelect()
                }}
              >
                <span className="menu__mark" aria-hidden="true">
                  {item.mark ?? ''}
                </span>
                {item.label}
              </button>
            ))}
          </div>
        ))}
        {items.length ? null : <p className="menu__empty">Nothing to do here.</p>}
      </div>
    </div>
  )
}
