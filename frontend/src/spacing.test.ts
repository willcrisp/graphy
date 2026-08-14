import { describe, expect, it } from 'vitest'
import { resolveSpacing } from './spacing'

describe('resolveSpacing', () => {
  it('takes an explicit stored choice', () => {
    expect(resolveSpacing('tight')).toBe('tight')
    expect(resolveSpacing('normal')).toBe('normal')
    expect(resolveSpacing('wide')).toBe('wide')
  })

  it('falls back to the default for anything unrecognised', () => {
    expect(resolveSpacing(null)).toBe('normal')
    expect(resolveSpacing('')).toBe('normal')
    expect(resolveSpacing('Wide')).toBe('normal')
    expect(resolveSpacing('roomy')).toBe('normal')
  })
})
