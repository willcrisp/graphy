/** The two-or-more-way button group behind ModeToggle (and any future
 *  `chrome, not editing` switch of this shape): a row of `aria-pressed`
 *  buttons where exactly one is ever "on". A caller differs only in its
 *  option list and labels, so that's all this takes as props -- the markup,
 *  the `mono` styling hook, and the roving `on` state live here. */

interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
  ariaLabel: string
}

export default function ToggleGroup<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: Props<T>) {
  return (
    <div className="modetoggle" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            className={`modetoggle__option mono${on ? ' modetoggle__option--on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
