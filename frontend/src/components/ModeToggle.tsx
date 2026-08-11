interface Props {
  editMode: boolean
  onChange: (editMode: boolean) => void
}

/**
 * Purely client-side. It only controls whether editing chrome is shown, so an
 * admin can browse the board without dragging something by accident. Rendered
 * only when authenticated and not globally read-only.
 */
export default function ModeToggle({ editMode, onChange }: Props) {
  return (
    <div className="modetoggle" role="group" aria-label="Board mode">
      {(['view', 'edit'] as const).map((mode) => {
        const on = (mode === 'edit') === editMode
        return (
          <button
            key={mode}
            type="button"
            className={`modetoggle__option mono${on ? ' modetoggle__option--on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(mode === 'edit')}
          >
            {mode}
          </button>
        )
      })}
    </div>
  )
}
