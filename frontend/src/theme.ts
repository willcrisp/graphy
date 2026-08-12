import { useEffect } from 'react'
import { usePersistedChoice } from './persistedChoice'

export type Theme = 'light' | 'dark'

/** Mirrored by the pre-paint script inlined in `index.html`. Change both. */
export const THEME_KEY = 'blueprint.theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Kept pure -- no DOM -- so it can be tested, and so the one rule that decides
 * which theme wins lives in a single place: an explicit choice beats the system
 * preference, anything else follows the system.
 */
export function resolveTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored
  return prefersDark ? 'dark' : 'light'
}

/** The stylesheet keys off this attribute; nothing else switches the theme. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

/**
 * The attribute is already set before first paint by the inline script, so this
 * recomputes the same answer rather than introducing a second source of truth.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, choose, setTheme] = usePersistedChoice<Theme>(
    THEME_KEY,
    () => resolveTheme(window.localStorage.getItem(THEME_KEY), window.matchMedia(DARK_QUERY).matches),
    applyTheme,
  )

  // Track the OS for as long as the visitor has not chosen for themselves.
  // Goes through the raw setter, not `choose` -- following the system is not
  // an explicit choice and must not be written to storage.
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY)
    function onChange(event: MediaQueryListEvent) {
      if (window.localStorage.getItem(THEME_KEY)) return
      setTheme(event.matches ? 'dark' : 'light')
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [setTheme])

  return [theme, choose]
}
