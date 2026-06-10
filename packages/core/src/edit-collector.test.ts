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

  it('removeFormatted collapses the line when the span owns it', () => {
    // `  b\n` is wholly occupied by the removed span → the whole line goes, no blank left behind.
    const src = 'a\n  b\nc'
    const c = new EditCollector(src)
    c.removeFormatted(src.indexOf('b'), src.indexOf('b') + 1)
    expect(c.toString()).toBe('a\nc')
  })

  it('removeFormatted collapses a multi-line span that owns its lines', () => {
    const src = 'a\n  x(\n    1,\n  ),\nc'
    const c = new EditCollector(src)
    c.removeFormatted(src.indexOf('x('), src.indexOf('),') + 2) // the `x(\n…),` element + comma
    expect(c.toString()).toBe('a\nc')
  })

  it('removeFormatted leaves an inline hole untouched (delete only the span)', () => {
    const src = '[1, two, 3]'
    const c = new EditCollector(src)
    c.removeFormatted(src.indexOf('two'), src.indexOf('3')) // `two, ` — an inline span, no line collapse
    expect(c.toString()).toBe('[1, 3]')
  })

  it('removeFormatted keeps the line when content trails the span', () => {
    const src = '  drop more\n'
    const c = new EditCollector(src)
    c.removeFormatted(2, 6) // `drop`, but ` more` trails on the same line
    expect(c.toString()).toBe('   more\n')
  })

  it('removeFormatted still drops the content after a prior edit took the leading indent', () => {
    // A prior delete claimed `[0, 5)` — the wrapper plus `b`'s leading indent. removeFormatted of `b`
    // would overlap that indent; the content claim abuts the prior delete and must still land.
    const src = 'xy\n  b\nc'
    const c = new EditCollector(src)
    c.remove(0, 5) // mimic unwrap/dropDirective: removes up to (and including) `b`'s indent
    c.removeFormatted(5, 6) // remove `b`; its line collapses, so `b\n` goes too
    expect(c.toString()).toBe('c')
  })

  it('removeUpToLine collapses the leading lines but keeps the node line', () => {
    // Drop the directive line and the comment stacked under it; `const`'s own line is untouched.
    const src = '//# x\n// y\nconst a'
    const c = new EditCollector(src)
    c.removeUpToLine(0, src.indexOf('const'))
    expect(c.toString()).toBe('const a')
  })

  it('removeUpToLine falls back to a verbatim delete for an inline directive', () => {
    const src = '/* x */ const a'
    const c = new EditCollector(src)
    c.removeUpToLine(0, src.indexOf('const'))
    expect(c.toString()).toBe('const a')
  })

  it('reports the indentation of the line containing an index', () => {
    const src = 'function f() {\n    return 1\n}'
    const c = new EditCollector(src)
    expect(c.indentAt(src.indexOf('return'))).toBe('    ')
  })

  it('reports an empty indent at the start of the file', () => {
    expect(new EditCollector('foo').indentAt(0)).toBe('')
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
