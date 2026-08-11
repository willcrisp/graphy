import { describe, expect, it } from 'vitest'
import { resolveTheme } from './theme'

describe('resolveTheme', () => {
  it('follows the system preference when nothing is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark')
    expect(resolveTheme(null, false)).toBe('light')
  })

  it('lets an explicit choice override the system preference', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('falls back to the system preference for unrecognised storage', () => {
    expect(resolveTheme('', true)).toBe('dark')
    expect(resolveTheme('Dark', false)).toBe('light')
    expect(resolveTheme('blueprint', false)).toBe('light')
  })
})
