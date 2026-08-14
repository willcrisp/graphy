import ToggleGroup from './ToggleGroup'
import type { Direction } from '../direction'

interface Props {
  direction: Direction
  onChange: (direction: Direction) => void
}

const OPTIONS = [
  { value: 'down', label: '↓ down' },
  { value: 'across', label: '→ across' },
] as const

/**
 * Which way the graph builds. Chrome, not editing -- it changes nothing on the
 * server (positions are never stored, see `layout.ts`) and is rendered for
 * everyone, signed in or not.
 */
export default function DirectionToggle({ direction, onChange }: Props) {
  return (
    <ToggleGroup
      ariaLabel="Graph direction"
      value={direction}
      options={OPTIONS}
      onChange={onChange}
    />
  )
}
