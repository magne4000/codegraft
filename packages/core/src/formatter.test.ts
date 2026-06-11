import { describe, it, expect } from 'vitest'
import { EditCollector } from './edit-collector.js'
import { Formatter } from './formatter.js'
import type { FormatStyle } from './format.js'

const STYLE: FormatStyle = { indentUnit: '  ', eol: '\n' }
const setup = (src: string, style: FormatStyle = STYLE) => {
  const collector = new EditCollector(src)
  return { collector, f: new Formatter(collector, src, style) }
}

describe('Formatter — removal collapse', () => {
  it('removeNode collapses the line when the span owns it', () => {
    // `  b\n` is wholly occupied by the removed span → the whole line goes, no blank left behind.
    const src = 'a\n  b\nc'
    const { collector, f } = setup(src)
    f.removeNode(src.indexOf('b'), src.indexOf('b') + 1)
    expect(collector.toString()).toBe('a\nc')
  })

  it('removeNode collapses a multi-line span that owns its lines', () => {
    const src = 'a\n  x(\n    1,\n  ),\nc'
    const { collector, f } = setup(src)
    f.removeNode(src.indexOf('x('), src.indexOf('),') + 2) // the `x(\n…),` element + comma
    expect(collector.toString()).toBe('a\nc')
  })

  it('removeNode leaves an inline hole clean (no line collapse, no double space)', () => {
    const src = '[1, two, 3]'
    const { collector, f } = setup(src)
    f.removeNode(src.indexOf('two'), src.indexOf('two') + 4) // `two,` — the following space is cleaned
    expect(collector.toString()).toBe('[1, 3]')
  })

  it('removeNode clears one separating space, not a list-edge space', () => {
    // Both sides spaced → one space goes. At a list edge (next char is `]`, not a space) nothing extra.
    const mid = setup('[1, two, 3]')
    mid.f.removeNode(4, 8) // `two,` mid-list → `[1, 3]`
    expect(mid.collector.toString()).toBe('[1, 3]')
    const edge = setup('[two, 3]')
    edge.f.removeNode(1, 5) // `two,` at the start, preceded by `[` → leading space untouched
    expect(edge.collector.toString()).toBe('[ 3]')
  })

  it('removeNode keeps the line when content trails the span, clearing one separating space', () => {
    const src = '  drop more\n'
    const { collector, f } = setup(src)
    f.removeNode(2, 6) // `drop`, but ` more` trails on the same line — the line is not collapsed
    expect(collector.toString()).toBe('  more\n')
  })

  it('removeNode still drops the content after a prior edit took the leading indent', () => {
    // A prior delete claimed `[0, 5)` — the wrapper plus `b`'s leading indent. removeNode of `b`
    // would overlap that indent; the content delete abuts the prior one and must still land.
    const src = 'xy\n  b\nc'
    const { collector, f } = setup(src)
    collector.remove(0, 5) // mimic unwrap/dropDirective: removes up to (and including) `b`'s indent
    f.removeNode(5, 6) // remove `b`; its line collapses, so `b\n` goes too
    expect(collector.toString()).toBe('c')
  })

  it('removeLeadingTo collapses the leading lines but keeps the node line', () => {
    // Drop the directive line and the comment stacked under it; `const`'s own line is untouched.
    const src = '//# x\n// y\nconst a'
    const { collector, f } = setup(src)
    f.removeLeadingTo(0, src.indexOf('const'))
    expect(collector.toString()).toBe('const a')
  })

  it('removeLeadingTo falls back to a plain delete for an inline directive', () => {
    const src = '/* x */ const a'
    const { collector, f } = setup(src)
    f.removeLeadingTo(0, src.indexOf('const'))
    expect(collector.toString()).toBe('const a')
  })
})

describe('Formatter — rendering', () => {
  it('indentAt reports the indentation of the line containing an index', () => {
    const src = 'function f() {\n    return 1\n}'
    const { f } = setup(src)
    expect(f.indentAt(src.indexOf('return'))).toBe('    ')
  })

  it('indentAt reports an empty indent at the start of the file', () => {
    expect(setup('foo').f.indentAt(0)).toBe('')
  })

  it('line renders a fresh line at the anchor indent and detected EOL', () => {
    const src = 'function f() {\r\n\ta()\r\n}'
    const { f } = setup(src, { indentUnit: '\t', eol: '\r\n' })
    expect(f.line('b()', src.indexOf('a()'))).toBe('\r\n\tb()')
  })

  it('reindent re-indents continuation lines to the anchor (single-line text unchanged)', () => {
    const src = 'function f() {\n  gen()\n}'
    const { f } = setup(src)
    expect(f.reindent('x()', src.indexOf('gen'))).toBe('x()')
    expect(f.reindent('function g() {\n  return 1\n}', src.indexOf('gen'))).toBe('function g() {\n    return 1\n  }')
  })
})
