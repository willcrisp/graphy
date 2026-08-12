import { describe, expect, it } from 'vitest'
import { resolveGraphStyle } from './graphStyle'

describe('resolveGraphStyle', () => {
  it('defaults to blueprint when nothing is stored', () => {
    expect(resolveGraphStyle(null)).toBe('blueprint')
  })

  it('honours an explicit neptune choice', () => {
    expect(resolveGraphStyle('neptune')).toBe('neptune')
  })

  it('falls back to blueprint for unrecognised storage', () => {
    expect(resolveGraphStyle('')).toBe('blueprint')
    expect(resolveGraphStyle('Neptune')).toBe('blueprint')
    expect(resolveGraphStyle('dark')).toBe('blueprint')
  })
})
