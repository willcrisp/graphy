import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * The localStorage-backed "pick one, remember it" wiring shared by `useTheme`
 * and `useGraphStyle`: seed state once from a caller-supplied resolver, apply
 * it as a side effect whenever it changes, and persist an explicit choice
 * back to storage under `key`.
 *
 * What's deliberately *not* shared: each caller keeps its own resolver (the
 * fallback rule differs -- theme falls back to the OS preference, graph
 * style has no such thing to fall back to) and its own `apply` function (the
 * attribute each writes to `<html>` is a distinct axis -- see CLAUDE.md's
 * "Graph style is a second, independent attribute"). Only the mechanics are
 * common.
 *
 * The raw setter is returned alongside the persisting `choose` because
 * `useTheme` needs to track the OS preference without writing it to storage
 * -- following the system is not the same as choosing against it.
 */
export function usePersistedChoice<T extends string>(
  key: string,
  resolve: () => T,
  apply: (value: T) => void,
): [T, (value: T) => void, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(resolve)

  useEffect(() => {
    apply(value)
  }, [apply, value])

  const choose = useCallback(
    (next: T) => {
      window.localStorage.setItem(key, next)
      setValue(next)
    },
    [key],
  )

  return [value, choose, setValue]
}
