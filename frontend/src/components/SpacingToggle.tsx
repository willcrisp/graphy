import ToggleGroup from './ToggleGroup'
import { SPACINGS, type Spacing } from '../layout'

interface Props {
  spacing: Spacing
  onChange: (spacing: Spacing) => void
}

const OPTIONS = SPACINGS.map((value) => ({ value, label: value }))

/**
 * How far apart the tree is drawn. Chrome, not editing -- it changes nothing on
 * the server and is rendered for everyone, signed in or not, on both pages.
 */
export default function SpacingToggle({ spacing, onChange }: Props) {
  return (
    <ToggleGroup
      ariaLabel="Node spacing"
      value={spacing}
      options={OPTIONS}
      onChange={onChange}
    />
  )
}
