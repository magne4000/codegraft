import { describe, it, expect } from 'vitest'
import { EditCollector } from './edit-collector.js'
import { Formatter } from './formatter.js'

const setup = (src: string, eol = '\n') => {
  const collector = new EditCollector(src)
  return { collector, f: new Formatter(collector, src, eol) }
}

// append/prepend operate on parsed container nodes, so they're exercised at the codemod level
// (codemod/format.test.ts); here we cover the offset-based rendering helpers.
describe('Formatter — rendering', () => {
  it('indentAt reports the indentation of the line containing an index', () => {
    const src = 'function f() {\n    return 1\n}'
    const { f } = setup(src)
    expect(f.indentAt(src.indexOf('return'))).toBe('    ')
  })

  it('indentAt reports an empty indent at the start of the file', () => {
    expect(setup('foo').f.indentAt(0)).toBe('')
  })

  it('reindent re-indents continuation lines to the anchor (single-line text unchanged)', () => {
    const src = 'function f() {\n  gen()\n}'
    const { f } = setup(src)
    expect(f.reindent('x()', src.indexOf('gen'))).toBe('x()')
    expect(f.reindent('function g() {\n  return 1\n}', src.indexOf('gen'))).toBe('function g() {\n    return 1\n  }')
  })
})
