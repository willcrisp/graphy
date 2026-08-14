import { describe, expect, it } from 'vitest'
import { resolveDirection } from './direction'

describe('resolveDirection', () => {
  it('builds downward when nothing is stored', () => {
    expect(resolveDirection(null)).toBe('down')
  })

  it('honours a stored choice', () => {
    expect(resolveDirection('across')).toBe('across')
    expect(resolveDirection('down')).toBe('down')
  })

  it('falls back to down for unrecognised storage', () => {
    expect(resolveDirection('')).toBe('down')
    expect(resolveDirection('Across')).toBe('down')
    expect(resolveDirection('LR')).toBe('down')
  })
})
