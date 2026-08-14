import { usePersistedChoice } from './persistedChoice'

/** Which way the graph builds: `down` ranks dependants above their
 *  dependencies (dagre `TB`), `across` turns that a quarter turn so it reads
 *  left to right (`LR`). It is the same layout either way -- only the axis
 *  dagre ranks on changes, and with it where a node's handles sit. */
export type Direction = 'down' | 'across'

export const DIRECTION_KEY = 'blueprint.direction'

/**
 * Kept pure -- no DOM -- for the same reason `resolveTheme` is: the one rule
 * that decides which way the graph builds lives in a single testable place.
 * There is no system preference to fall back to here, so anything unrecognised
 * is `down`, the drawing this app has always had.
 */
export function resolveDirection(stored: string | null): Direction {
  return stored === 'across' ? 'across' : 'down'
}

/**
 * The direction is a second, independent axis on `<html>`, alongside
 * `data-theme`. Layout itself is passed the direction as an argument -- the
 * attribute exists only so CSS can settle a node in from the direction the
 * graph builds (`app.css`'s `task-settle`).
 *
 * Unlike the theme there is no pre-paint script for it: nothing is painted in
 * either direction until React has laid the canvas out, so there is no flash
 * to head off.
 */
export function applyDirection(direction: Direction) {
  document.documentElement.dataset.graphDir = direction
}

export function useDirection(): [Direction, (direction: Direction) => void] {
  const [direction, choose] = usePersistedChoice<Direction>(
    DIRECTION_KEY,
    () => resolveDirection(window.localStorage.getItem(DIRECTION_KEY)),
    applyDirection,
  )
  return [direction, choose]
}
