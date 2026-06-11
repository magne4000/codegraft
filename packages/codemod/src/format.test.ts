import { describe, it, expect } from 'vitest'
import type { Collection } from '@codegraft/core'
import { defineCodemod } from './codemod.js'

const apply = async (fn: (root: Collection<'tsx'>) => void, src: string, ctx: Record<string, unknown> = {}): Promise<string> => {
  const t = await defineCodemod(fn).forTarget('tsx')
  return t.transform(src, ctx)
}

// Codegraft renders edits only as far as *syntactic validity*: an inserted snippet is re-indented to
// its anchor line, and an appended/prepended element gets its container's separator. Everything else
// (exact indent, blank lines, brace padding, reflow) is a downstream formatter's job — so these assert
// valid-but-not-pretty output.
describe('transform — structural edits', () => {
  // —— inserted snippets are re-indented to their anchor ——

  it('re-indents a multi-line replacement to the anchor', async () => {
    const out = await apply(
      (root) => root.find('call_expression', { function: 'gen' }).replaceWith('function g() {\n  return 1\n}'),
      'function f() {\n  gen()\n}',
    )
    expect(out).toBe('function f() {\n  function g() {\n    return 1\n  }\n}')
  })

  it('keeps the displaced node indented after insertBefore with a trailing newline', async () => {
    const out = await apply(
      (root) => root.find('expression_statement', { text: 'b()' }).insertBefore('x()\n'),
      'function f() {\n  a()\n  b()\n}',
    )
    expect(out).toBe('function f() {\n  a()\n  x()\n  b()\n}')
  })

  it('indents an added leading comment and keeps the node indented', async () => {
    const out = await apply(
      (root) => root.find('expression_statement', { text: 'a()' }).addLeadingComment('// note'),
      'function f() {\n  a()\n}',
    )
    expect(out).toBe('function f() {\n  // note\n  a()\n}')
  })

  it('uses the detected EOL for ensureImport', async () => {
    const out = await apply((root) => root.ensureImport("import b from 'b'"), 'import a from "a"\r\nx()')
    expect(out).toBe('import a from "a"\r\nimport b from \'b\'\r\nx()')
  })

  // —— append / prepend: a valid separator, no reflow ——

  it('appends a statement to a block on its own line (indent left to the formatter)', async () => {
    const out = await apply((root) => root.find('statement_block').first().append('c()'), 'function f() {\n  a()\n  b()\n}')
    expect(out).toBe('function f() {\n  a()\n  b()\nc()\n}')
  })

  it('prepends a statement to a block', async () => {
    const out = await apply((root) => root.find('statement_block').first().prepend('a()'), 'function f() {\n  b()\n}')
    expect(out).toBe('function f() {\na()\n  b()\n}')
  })

  it('appends to an inline array', async () => {
    expect(await apply((root) => root.find('array').first().append('3'), 'const a = [1, 2]')).toBe('const a = [1, 2, 3]')
  })

  it('appends to a multi-line array (valid, not reflowed)', async () => {
    const out = await apply((root) => root.find('array').first().append('3'), 'const a = [\n  1,\n  2\n];')
    expect(out).toBe('const a = [\n  1,\n  2, 3\n];')
  })

  it('appends a key to a multi-line object', async () => {
    const out = await apply(
      (root) =>
        root.find('call_expression', { function: 'defineConfig' }).first().field('arguments').children().first().append('resolve: {}'),
      'export default defineConfig({\n  plugins: [vike()],\n  build: { sourcemap: false },\n});',
    )
    expect(out).toBe('export default defineConfig({\n  plugins: [vike()],\n  build: { sourcemap: false }, resolve: {},\n});')
  })

  it('appends an interface member with a `;` separator', async () => {
    expect(await apply((root) => root.find('interface_body').first().append('b: B'), 'interface C {\n  a: A;\n}')).toBe(
      'interface C {\n  a: A; b: B;\n}',
    )
  })

  it('appends an interface member to a `;`-less body (still separated, still valid)', async () => {
    expect(await apply((root) => root.find('interface_body').first().append('b: B'), 'interface C {\n  a: A\n}')).toBe(
      'interface C {\n  a: A; b: B\n}',
    )
  })

  it('prepends a key to a multi-line object', async () => {
    const out = await apply((root) => root.find('object').first().prepend('x: 0'), 'const a = {\n  a: 1,\n  b: 2,\n};')
    expect(out).toBe('const a = {\n  x: 0, a: 1,\n  b: 2,\n};')
  })

  it('fills an empty object / array / block with a sole element', async () => {
    expect(await apply((root) => root.find('object').first().append('a: 1'), 'const a = {}')).toBe('const a = {a: 1}')
    expect(await apply((root) => root.find('array').first().append('3'), 'const a = []')).toBe('const a = [3]')
    expect(await apply((root) => root.find('statement_block').first().append('return 1'), 'function f() {}')).toBe(
      'function f() {\nreturn 1}',
    )
  })

  it('append uses the source CRLF for the new line break', async () => {
    const out = await apply((root) => root.find('statement_block').first().append('c()'), 'function f() {\r\n\ta()\r\n\tb()\r\n}')
    expect(out).toBe('function f() {\r\n\ta()\r\n\tb()\r\nc()\r\n}')
  })

  // —— removal / unwrap: plain deletes; leftover whitespace is the formatter's job ——

  it('removes a list element and its separator, leaving no hole', async () => {
    const out = await apply(
      (root) => root.find('array').first().children().at(1).remove({ separator: true }),
      'const a = [\n  1,\n  two(),\n  3,\n];',
    )
    expect(out).toBe('const a = [\n  1,\n  \n  3,\n];')
  })

  it('removes a statement and its line with separator (no blank left)', async () => {
    const out = await apply((root) => root.find('debugger_statement').first().remove({ separator: true }), 'a()\ndebugger\nb()')
    expect(out).toBe('a()\nb()')
  })

  it('cleans the residual space of an inline element removed (does not eat siblings)', async () => {
    // The element + its comma go; `3` survives. (Spacing around the hole is the formatter's to tidy.)
    const out = await apply((root) => root.find('array').first().children().at(1).remove({ separator: true }), 'const a = [1, two(), 3];')
    expect(out).toBe('const a = [1,  3];')
  })

  it('removes a node inside an unwrapped block — the two deletes compose', async () => {
    const out = await apply((root) => {
      const ifst = root.find('if_statement').first()
      const stmts = ifst.field('consequence').children()
      ifst.unwrap(stmts)
      stmts.first().remove()
    }, 'if (a) {\n  drop();\n  keep();\n}')
    expect(out).toBe('\n  keep();')
  })

  it('collapses nested conditionals in one pass (unwrap then remove inside)', async () => {
    const collapse = defineCodemod<Record<string, boolean>>({ namespace: '$$' }, (root, ctx) => {
      root.find('if_statement').forEach((node) => {
        const cond = node.field('condition')
        if (!cond.text.includes('$$')) return
        if (cond.evaluate(ctx)) node.unwrap(node.field('consequence').children())
        else node.remove()
      })
    })
    const t = await collapse.forTarget('tsx')
    expect(t.transform('if ($$.a) {\n  if ($$.b) {\n    yes();\n  }\n}', { a: true, b: true })).toBe('yes();')
  })

  // —— directive / comment removal: plain deletes ——

  it('drops a leading directive comment, keeping the node', async () => {
    const out = await apply(
      (root) => root.find('array').first().children().at(1).dropDirective(/x/),
      'const a = [\n  1,\n  //# x\n  two(),\n  3,\n];',
    )
    expect(out).toBe('const a = [\n  1,\n  two(),\n  3,\n];')
  })

  it('drops a directive then removes its own-line element (both compose)', async () => {
    const out = await apply(
      (root) => {
        const el = root.find('array').first().children().at(1)
        el.dropDirective(/x/)
        el.remove({ separator: true })
      },
      'const a = [\n  1,\n  //# x\n  two(),\n  3,\n];',
    )
    expect(out).toBe('const a = [\n  1,\n  \n  3,\n];')
  })

  it('empties a leading comment via mapLeadingComment, keeping the node', async () => {
    const out = await apply(
      (root) => root.find('object').first().children().first().mapLeadingComment(() => ''),
      'const a = {\n  // x\n  k: 1,\n};',
    )
    expect(out).toBe('const a = {\n  \n  k: 1,\n};')
  })

  it('a non-empty mapLeadingComment rewrites in place', async () => {
    const out = await apply(
      (root) => root.find('object').first().children().first().mapLeadingComment((s) => s + '!'),
      'const a = {\n  // x\n  k: 1,\n};',
    )
    expect(out).toBe('const a = {\n  // x!\n  k: 1,\n};')
  })
})
