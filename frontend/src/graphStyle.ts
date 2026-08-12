import { usePersistedChoice } from './persistedChoice'

/**
 * Independent of `Theme` (light/dark). This axis controls how the graph
 * itself is drawn -- layout direction, node spacing, node treatment and edge
 * style -- not colour outside the canvas. Either graph style can be combined
 * with either theme.
 *
 * `layout.ts` reads it to choose dagre's direction and node dimensions;
 * `tokens.css` and `app.css` read the `data-graph-style` attribute it sets
 * to reskin the canvas. Nothing outside `.canvas` changes.
 */
export type GraphStyle = 'blueprint' | 'neptune'

/** Mirrors THEME_KEY's naming in theme.ts, kept in the same namespace. */
export const GRAPH_STYLE_KEY = 'blueprint.graphStyle'

/** Kept pure -- no DOM -- so it can be tested like resolveTheme(). There is no
 *  system preference to fall back to here, so anything unrecognised is just
 *  the default. */
export function resolveGraphStyle(stored: string | null): GraphStyle {
  return stored === 'neptune' ? 'neptune' : 'blueprint'
}

/** The stylesheet and layout.ts both key off this attribute. */
export function applyGraphStyle(style: GraphStyle) {
  document.documentElement.dataset.graphStyle = style
}

export function useGraphStyle(): [GraphStyle, (style: GraphStyle) => void] {
  const [style, choose] = usePersistedChoice<GraphStyle>(
    GRAPH_STYLE_KEY,
    () => resolveGraphStyle(window.localStorage.getItem(GRAPH_STYLE_KEY)),
    applyGraphStyle,
  )
  return [style, choose]
}
