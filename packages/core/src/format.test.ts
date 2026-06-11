import { describe, it, expect } from 'vitest'
import { detectStyle, reindent, lineStartOf, indentOf } from './format.js'

describe('detectStyle', () => {
  it('detects an LF line ending', () => {
    expect(detectStyle('a\nb').eol).toBe('\n')
  })

  it('detects a CRLF line ending', () => {
    expect(detectStyle('a\r\nb\r\nc').eol).toBe('\r\n')
  })

  it('defaults to LF with no line break to learn from', () => {
    expect(detectStyle('abc').eol).toBe('\n')
  })
})

describe('reindent', () => {
  it('leaves a single-line snippet unchanged', () => {
    expect(reindent('foo()', '    ', '\n')).toBe('foo()')
  })

  it('prefixes continuation lines with the base indent, keeping internal indent', () => {
    expect(reindent('function f() {\n  return 1\n}', '    ', '\n')).toBe('function f() {\n      return 1\n    }')
  })

  it('re-anchors a hanging block by its own base, not the first line', () => {
    // A node's `.text` leaves line 0 flush while its continuation lines keep their source indent
    // (4 and 2). The base is the least-indented line (2); re-anchoring to baseIndent preserves the
    // block's own step (member one level past its brace) instead of stacking on the 4/2 already there.
    expect(reindent('interface B {\n    y: Y;\n  }', '    ', '\n')).toBe('interface B {\n      y: Y;\n    }')
  })

  it('does not indent blank lines', () => {
    expect(reindent('a\n\nb', '  ', '\n')).toBe('a\n\n  b')
  })

  it('normalises line endings to eol', () => {
    expect(reindent('a\nb', '', '\r\n')).toBe('a\r\nb')
  })
})

describe('line queries', () => {
  it('lineStartOf finds the start of the line containing an index', () => {
    const src = 'ab\n  cd\nef'
    expect(lineStartOf(src, 0)).toBe(0)
    expect(lineStartOf(src, src.indexOf('cd'))).toBe(3) // after the first '\n'
  })

  it('indentOf reports the leading whitespace of the line', () => {
    expect(indentOf('a\n    b', 'a\n    b'.indexOf('b'))).toBe('    ')
    expect(indentOf('foo', 0)).toBe('')
  })
})
