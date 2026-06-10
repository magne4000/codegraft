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

  it('collapses the line of an own-line element removed under format', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('array').first().children().at(1).remove({ separator: true })
    }).forTarget('tsx')
    // No blank line where `two(),` was — the line goes entirely, as Prettier would have collapsed it.
    expect(t.transform('const a = [\n  1,\n  two(),\n  3,\n];', {})).toBe('const a = [\n  1,\n  3,\n];')
  })

  it('collapses the line of an emptied own-line call argument under format', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('arguments').first().children().at(0).remove({ separator: true })
    }).forTarget('tsx')
    expect(t.transform('cfg(\n  arg\n);', {})).toBe('cfg(\n);')
  })

  it('leaves an inline element hole untouched (does not eat siblings) under format', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('array').first().children().at(1).remove({ separator: true })
    }).forTarget('tsx')
    // The span is deleted in place; the residual space is the downstream formatter's job — the point
    // is that the inline sibling `3` survives (whole-line collapse must not fire here).
    expect(t.transform('const a = [1, two(), 3];', {})).toBe('const a = [1,  3];')
  })

  it('without format, a removed own-line element leaves its line blank (verbatim contract)', async () => {
    const t = await defineCodemod((root) => {
      root.find('array').first().children().at(1).remove({ separator: true })
    }).forTarget('tsx')
    expect(t.transform('const a = [\n  1,\n  two(),\n  3,\n];', {})).toBe('const a = [\n  1,\n  \n  3,\n];')
  })

  it('is off by default — an appended statement still lands at column 0', async () => {
    const t = await defineCodemod((root) => {
      root.find('statement_block').first().append('c()')
    }).forTarget('tsx')
    expect(t.transform('function f() {\n  a()\n  b()\n}', {})).toBe('function f() {\n  a()\n  b()\nc()\n}')
  })
})
