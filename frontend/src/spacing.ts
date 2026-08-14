import { usePersistedChoice } from './persistedChoice'
import { DEFAULT_SPACING, SPACINGS, type Spacing } from './layout'

/** The reader's "how far apart" choice, remembered per browser. The vocabulary
 *  and the gaps it stands for live in `layout.ts` (`separationOf`); this is only
 *  the storage half, kept here for the same reason `theme.ts` is separate from
 *  `tokens.css` -- one module decides what the value means, another remembers
 *  which one is picked. */

export const SPACING_KEY = 'blueprint.spacing'

/**
 * Kept pure -- no DOM -- so it can be tested, and so the fallback lives in one
 * place. There is nothing to follow here the way the theme follows the OS: an
 * unrecognised or absent value is simply the default.
 */
export function resolveSpacing(stored: string | null): Spacing {
  return SPACINGS.includes(stored as Spacing) ? (stored as Spacing) : DEFAULT_SPACING
}

/**
 * Unlike the theme, this writes nothing to the DOM -- spacing is an argument to
 * `layoutGraph`, not an attribute the stylesheet keys off, so `usePersistedChoice`
 * is used without an `apply`.
 */
export function useSpacing(): [Spacing, (spacing: Spacing) => void] {
  const [spacing, choose] = usePersistedChoice<Spacing>(SPACING_KEY, () =>
    resolveSpacing(window.localStorage.getItem(SPACING_KEY)),
  )
  return [spacing, choose]
}
