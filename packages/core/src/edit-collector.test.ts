import { describe, it, expect } from 'vitest'
import { EditCollector } from './edit-collector.js'

describe('EditCollector', () => {
  it('returns the source unchanged with no edits', () => {
    expect(new EditCollector('abc').toString()).toBe('abc')
  })

  it('applies non-overlapping overwrites regardless of order', () => {
    const c = new EditCollector('hello world')
    c.overwrite(6, 11, 'EARTH')
    c.overwrite(0, 5, 'HI')
    expect(c.toString()).toBe('HI EARTH')
  })

  it('removes a range', () => {
    const c = new EditCollector('abcde')
    c.remove(1, 4)
    expect(c.toString()).toBe('ae')
  })

  it('drops an overlapping edit silently (first-wins)', () => {
    const c = new EditCollector('0123456789')
    c.overwrite(0, 5, 'A')
    c.overwrite(3, 8, 'B') // overlaps [0,5) → dropped
    expect(c.toString()).toBe('A56789')
  })

  it('keeps the first edit, not a later one that swallows it', () => {
    const c = new EditCollector('0123456789')
    c.overwrite(2, 4, 'X')
    c.overwrite(0, 10, 'WHOLE') // overlaps the first → dropped
    expect(c.toString()).toBe('01X456789')
  })

  it('allows adjacent edits — a shared boundary is not an overlap', () => {
    const c = new EditCollector('012345')
    c.overwrite(0, 3, 'X')
    c.overwrite(3, 6, 'Y')
    expect(c.toString()).toBe('XY')
  })

  it('narrow-delete: removing the wrapper leaves the kept span in place', () => {
    // `if (x) { body } ` → keep `body` by deleting the surrounding wrapper
    const c = new EditCollector('if (x) { body }')
    c.remove(0, 9) // "if (x) { "
    c.remove(13, 15) // " }"
    expect(c.toString()).toBe('body')
  })

  it('generates a v3 source map', () => {
    const c = new EditCollector('const x = 1')
    c.overwrite(0, 11, 'REPLACED')
    const map = c.generateMap('file.ts')
    expect(map.version).toBe(3)
    expect(map.sources).toContain('file.ts')
    expect(typeof map.toString()).toBe('string')
  })
})
