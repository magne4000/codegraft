import { describe, it, expect } from 'vitest'
import { detectStyle, reindent, lineStartOf, indentOf, isHSpace, wholeLineRange } from './format.js'

describe('detectStyle', () => {
  it('detects a two-space indent', () => {
    expect(detectStyle('function f() {\n  if (x) {\n    a()\n  }\n}\n').indentUnit).toBe('  ')
  })

  it('detects a four-space indent', () => {
    expect(detectStyle('function f() {\n    if (x) {\n        a()\n    }\n}\n').indentUnit).toBe('    ')
  })

  it('detects tab indentation', () => {
    expect(detectStyle('function f() {\n\tif (x) {\n\t\ta()\n\t}\n}\n').indentUnit).toBe('\t')
  })

  it('defaults to two spaces with nothing to learn from', () => {
    expect(detectStyle('a\nb\nc\n').indentUnit).toBe('  ')
  })

  it('detects an LF line ending', () => {
    expect(detectStyle('a\nb').eol).toBe('\n')
  })

  it('detects a CRLF line ending', () => {
    expect(detectStyle('a\r\nb\r\nc').eol).toBe('\r\n')
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

  it('isHSpace recognises spaces and tabs, not newlines or out-of-range', () => {
    expect(isHSpace(' ')).toBe(true)
    expect(isHSpace('\t')).toBe(true)
    expect(isHSpace('\n')).toBe(false)
    expect(isHSpace(undefined)).toBe(false)
  })
})

describe('wholeLineRange', () => {
  it('spans the whole line a node occupies, through the trailing newline', () => {
    const src = 'a\n  drop\nc'
    const i = src.indexOf('drop')
    expect(wholeLineRange(src, i, i + 4)).toEqual([2, 9]) // `  drop\n`
  })

  it('absorbs blank lines above with collapseBlankBefore', () => {
    const src = 'a\n\n  drop\nc'
    const i = src.indexOf('drop')
    expect(wholeLineRange(src, i, i + 4, true)).toEqual([2, 10]) // the blank line + `  drop\n`
    expect(wholeLineRange(src, i, i + 4, false)).toEqual([3, 10]) // just `  drop\n`
  })

  it('runs to the end of source when the last line has no trailing newline', () => {
    const src = 'a\n  drop'
    const i = src.indexOf('drop')
    expect(wholeLineRange(src, i, i + 4)).toEqual([2, 8])
  })
})
