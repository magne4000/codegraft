import { describe, it, expect } from 'vitest'
import { defineCodemod } from './codemod.js'

// Indentation-aware insertion (the `format` option). Off by default, so the verbatim behaviour
// stays byte-identical; on, inserted/replaced code adopts the file's indent unit and EOL.
describe('defineCodemod — format option', () => {
  it('appends a sibling statement at the block indentation', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('statement_block').first().append('c()')
    }).forTarget('tsx')
    expect(t.transform('function f() {\n  a()\n  b()\n}', {})).toBe('function f() {\n  a()\n  b()\n  c()\n}')
  })

  it('prepends a sibling statement at the block indentation', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('statement_block').first().prepend('a()')
    }).forTarget('tsx')
    expect(t.transform('function f() {\n  b()\n}', {})).toBe('function f() {\n  a()\n  b()\n}')
  })

  it('re-indents a multi-line replacement to the anchor', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('call_expression', { function: 'gen' }).replaceWith('function g() {\n  return 1\n}')
    }).forTarget('tsx')
    expect(t.transform('function f() {\n  gen()\n}', {})).toBe('function f() {\n  function g() {\n    return 1\n  }\n}')
  })

  it('fills an empty block, one level in and closing on its own line', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('statement_block').first().append('return 1')
    }).forTarget('tsx')
    expect(t.transform('function f() {}', {})).toBe('function f() {\n  return 1\n}')
  })

  it('keeps the displaced node indented after insertBefore with a trailing newline', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('expression_statement', { text: 'b()' }).insertBefore('x()\n')
    }).forTarget('tsx')
    expect(t.transform('function f() {\n  a()\n  b()\n}', {})).toBe('function f() {\n  a()\n  x()\n  b()\n}')
  })

  it('indents an added leading comment and keeps the node indented', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('expression_statement', { text: 'a()' }).addLeadingComment('// note')
    }).forTarget('tsx')
    expect(t.transform('function f() {\n  a()\n}', {})).toBe('function f() {\n  // note\n  a()\n}')
  })

  it('detects a four-space unit and uses it to fill an empty nested block', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('statement_block').at(1).append('return 1')
    }).forTarget('tsx')
    expect(t.transform('function outer() {\n    if (x) {}\n}', {})).toBe(
      'function outer() {\n    if (x) {\n        return 1\n    }\n}',
    )
  })

  it('preserves tabs and CRLF line endings', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('statement_block').first().append('c()')
    }).forTarget('tsx')
    expect(t.transform('function f() {\r\n\ta()\r\n\tb()\r\n}', {})).toBe('function f() {\r\n\ta()\r\n\tb()\r\n\tc()\r\n}')
  })

  it('uses the detected EOL for ensureImport', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.ensureImport("import b from 'b'")
    }).forTarget('tsx')
    expect(t.transform('import a from "a"\r\nx()', {})).toBe('import a from "a"\r\nimport b from \'b\'\r\nx()')
  })

  it('leaves comma-separated containers inline even with format on', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('array').first().append('3')
    }).forTarget('tsx')
    expect(t.transform('const a = [1, 2]', {})).toBe('const a = [1, 2, 3]')
  })

  it('is off by default — an appended statement still lands at column 0', async () => {
    const t = await defineCodemod((root) => {
      root.find('statement_block').first().append('c()')
    }).forTarget('tsx')
    expect(t.transform('function f() {\n  a()\n  b()\n}', {})).toBe('function f() {\n  a()\n  b()\nc()\n}')
  })
})
