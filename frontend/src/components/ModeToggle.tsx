import ToggleGroup from './ToggleGroup'

interface Props {
  editMode: boolean
  onChange: (editMode: boolean) => void
}

const OPTIONS = [
  { value: 'view', label: 'view' },
  { value: 'edit', label: 'edit' },
] as const

/**
 * Purely client-side. It only controls whether editing chrome is shown, so an
 * admin can browse the board without dragging something by accident. Rendered
 * only when authenticated and not globally read-only.
 */
export default function ModeToggle({ editMode, onChange }: Props) {
  return (
    <ToggleGroup
      ariaLabel="Board mode"
      value={editMode ? 'edit' : 'view'}
      options={OPTIONS}
      onChange={(mode) => onChange(mode === 'edit')}
    />
  )
}
