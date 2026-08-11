import type { Theme } from '../theme'

interface Props {
  theme: Theme
  onChange: (theme: Theme) => void
}

/**
 * The glyph shows the theme you would switch *to*, so it always agrees with the
 * label. Rendered for everyone, signed in or not -- it is chrome, not editing.
 */
export default function ThemeToggle({ theme, onChange }: Props) {
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  const label = `Switch to ${next} theme`

  return (
    <button
      type="button"
      className="themetoggle"
      aria-label={label}
      title={label}
      onClick={() => onChange(next)}
    >
      {next === 'dark' ? <Moon /> : <Sun />}
    </button>
  )
}

function Moon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" />
    </svg>
  )
}

function Sun() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.2v1.4M8 13.4v1.4M1.2 8h1.4M13.4 8h1.4M3.2 3.2l1 1M11.8 11.8l1 1M12.8 3.2l-1 1M4.2 11.8l-1 1" />
    </svg>
  )
}
