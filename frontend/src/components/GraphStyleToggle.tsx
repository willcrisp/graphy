import type { GraphStyle } from '../graphStyle'
import ToggleGroup from './ToggleGroup'

interface Props {
  graphStyle: GraphStyle
  onChange: (style: GraphStyle) => void
}

const OPTIONS = [
  { value: 'blueprint', label: 'Blueprint' },
  { value: 'neptune', label: 'Neptune' },
] as const

/**
 * Independent of the light/dark theme toggle: this only changes how the
 * graph is drawn -- layout direction, spacing, node and edge treatment. See
 * graphStyle.ts. Rendered for everyone, same as ThemeToggle -- it is chrome,
 * not editing.
 */
export default function GraphStyleToggle({ graphStyle, onChange }: Props) {
  return (
    <ToggleGroup ariaLabel="Graph style" value={graphStyle} options={OPTIONS} onChange={onChange} />
  )
}
