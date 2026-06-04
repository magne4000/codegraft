import { describe, it, expect } from 'vitest'
import { EditCollector } from './edit-collector.js'

describe('EditCollector', () => {
  it('returns the source unchanged on an empty set', () => {
    expect(new EditCollector().apply('abc')).toBe('abc')
  })

  it('applies non-overlapping edits regardless of insertion order', () => {
    const c = new EditCollector()
    // inserted out of start order, to prove reverse-offset application
    c.add({ start: 6, end: 11, replacement: 'EARTH' })
    c.add({ start: 0, end: 5, replacement: 'HI' })
    expect(c.apply('hello world')).toBe('HI EARTH')
  })

  it('drops an overlapping edit silently (first-wins)', () => {
    const c = new EditCollector()
    c.add({ start: 0, end: 5, replacement: 'A' })
    c.add({ start: 3, end: 8, replacement: 'B' }) // overlaps [0,5) → dropped
    expect(c.apply('0123456789')).toBe('A56789')
  })

  it('keeps the first edit, not a later one that swallows it', () => {
    const c = new EditCollector()
    c.add({ start: 2, end: 4, replacement: 'X' })
    c.add({ start: 0, end: 10, replacement: 'WHOLE' }) // overlaps the first → dropped
    expect(c.apply('0123456789')).toBe('01X456789')
  })

  it('allows adjacent edits — a shared boundary is not an overlap', () => {
    const c = new EditCollector()
    c.add({ start: 0, end: 3, replacement: 'X' })
    c.add({ start: 3, end: 6, replacement: 'Y' })
    expect(c.apply('012345')).toBe('XY')
  })

  it('handles deletions (empty replacement)', () => {
    const c = new EditCollector()
    c.add({ start: 1, end: 4, replacement: '' })
    expect(c.apply('abcde')).toBe('ae')
  })

  it('applyToSpan returns just the transformed slice with in-range edits applied', () => {
    const c = new EditCollector()
    c.add({ start: 7, end: 10, replacement: 'X' }) // replaces "789" within span [5,15)
    // span [5,15) of "0123456789abcde" is "56789abcde"; "789" -> "X" gives "56Xabcde"
    expect(c.applyToSpan('0123456789abcde', 5, 15)).toBe('56Xabcde')
  })

  it('apply equals applyToSpan over the whole source', () => {
    const c = new EditCollector()
    c.add({ start: 1, end: 4, replacement: 'X' })
    expect(c.apply('abcde')).toBe(c.applyToSpan('abcde', 0, 'abcde'.length))
  })
})
