import { describe, it, expect } from 'vitest'
import type { Collection } from '@codegraft/core'
import { defineCodemod } from './codemod.js'

// The codemod body is format-agnostic; `apply` builds a tsx transformer for it and runs it. Every
// transform renders layout-aware — inserts adopt the file's indent unit / EOL and a removed node's
// line collapses — so these assert the formatted output.
const apply = async (fn: (root: Collection<'tsx'>) => void, src: string, ctx: Record<string, unknown> = {}): Promise<string> => {
  const t = await defineCodemod(fn).forTarget('tsx')
  return t.transform(src, ctx)
}

// Indentation-aware insertion + line-collapse — applied on every transform, keyed off the source's
// detected indent unit / EOL.
describe('transform — formatting', () => {
  it('appends a sibling statement at the block indentation', async () => {
    const out = await apply((root) => root.find('statement_block').first().append('c()'), 'function f() {\n  a()\n  b()\n}')
    expect(out).toBe('function f() {\n  a()\n  b()\n  c()\n}')
  })

  it('prepends a sibling statement at the block indentation', async () => {
    const out = await apply((root) => root.find('statement_block').first().prepend('a()'), 'function f() {\n  b()\n}')
    expect(out).toBe('function f() {\n  a()\n  b()\n}')
  })

  it('re-indents a multi-line replacement to the anchor', async () => {
    const out = await apply(
      (root) => root.find('call_expression', { function: 'gen' }).replaceWith('function g() {\n  return 1\n}'),
      'function f() {\n  gen()\n}',
    )
    expect(out).toBe('function f() {\n  function g() {\n    return 1\n  }\n}')
  })

  it('re-anchors an appended multi-line block to the container, not stacking its source indent', async () => {
    // mergeDts relocates a whole `interface` by appending its `.text` — a block whose first line is
    // flush but whose body keeps its source indent. It must match its new sibling (member and closing
    // brace aligned), not land a level too deep from the indent already on its continuation lines.
    const out = await apply(
      (root) => root.find('statement_block').first().append('interface B {\n    y: Y;\n  }'),
      'namespace V {\n  interface A {\n    x: X;\n  }\n}',
    )
    expect(out).toBe('namespace V {\n  interface A {\n    x: X;\n  }\n  interface B {\n    y: Y;\n  }\n}')
  })

  it('fills an empty block, one level in and closing on its own line', async () => {
    const out = await apply((root) => root.find('statement_block').first().append('return 1'), 'function f() {}')
    expect(out).toBe('function f() {\n  return 1\n}')
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

  it('detects a four-space unit and uses it to fill an empty nested block', async () => {
    const out = await apply((root) => root.find('statement_block').at(1).append('return 1'), 'function outer() {\n    if (x) {}\n}')
    expect(out).toBe('function outer() {\n    if (x) {\n        return 1\n    }\n}')
  })

  it('preserves tabs and CRLF line endings', async () => {
    const out = await apply((root) => root.find('statement_block').first().append('c()'), 'function f() {\r\n\ta()\r\n\tb()\r\n}')
    expect(out).toBe('function f() {\r\n\ta()\r\n\tb()\r\n\tc()\r\n}')
  })

  it('uses the detected EOL for ensureImport', async () => {
    const out = await apply((root) => root.ensureImport("import b from 'b'"), 'import a from "a"\r\nx()')
    expect(out).toBe('import a from "a"\r\nimport b from \'b\'\r\nx()')
  })

  it('leaves comma-separated containers inline even with format on', async () => {
    expect(await apply((root) => root.find('array').first().append('3'), 'const a = [1, 2]')).toBe('const a = [1, 2, 3]')
  })

  it('appends to a multi-line object on its own line, keeping the trailing-comma style', async () => {
    // The object is laid out one-key-per-line with trailing commas — the new key joins that layout
    // (its own line, indented, trailing comma) instead of being glued inline after the last key.
    const out = await apply(
      (root) =>
        root.find('call_expression', { function: 'defineConfig' }).first().field('arguments').children().first().append('resolve: { alias: {} }'),
      'export default defineConfig({\n  plugins: [vike()],\n  build: { sourcemap: false },\n});',
    )
    expect(out).toBe(
      'export default defineConfig({\n  plugins: [vike()],\n  build: { sourcemap: false },\n  resolve: { alias: {} },\n});',
    )
  })

  it('appends to a multi-line array without a trailing comma, adding only the separating comma', async () => {
    // No trailing comma in the source → the new element gets none either; just the comma that
    // separates it from the previous one. (Host trailing-comma style preserved.)
    const out = await apply((root) => root.find('array').first().append('3'), 'const a = [\n  1,\n  2\n];')
    expect(out).toBe('const a = [\n  1,\n  2,\n  3\n];')
  })

  it('appends an interface member with a `;` separator, not a comma, keeping the layout', async () => {
    // Interface/type members are `;`-separated, never comma-joined. A multi-line body that already
    // terminates members with `;` gets the new member on its own line, likewise `;`-terminated.
    const out = await apply((root) => root.find('interface_body').first().append('b: B'), 'interface C {\n  a: A;\n}')
    expect(out).toBe('interface C {\n  a: A;\n  b: B;\n}')
  })

  it('appends an interface member to a `;`-less multi-line body, relying on the newline (no `;` added)', async () => {
    // The body separates members by newline alone — the `;` is optional, so the new member matches
    // (own line, no terminator) rather than introducing a `;` the host doesn't use. The real `.d.ts`
    // merge shape (Vike.PageContext member union).
    const out = await apply(
      (root) => root.find('interface_body').first().append('session?: Session'),
      'interface PageContext {\n  user?: User\n}',
    )
    expect(out).toBe('interface PageContext {\n  user?: User\n  session?: Session\n}')
  })

  it('folds several interface members in one pass, each on its own `;`-terminated line', async () => {
    // Multiple appends to the same body compose (each lands after the previous), the way mergeDts
    // unions a duplicate interface's members into the canonical one.
    const out = await apply(
      (root) => {
        const body = root.find('interface_body').first()
        body.append('b: B')
        body.append('c: C')
      },
      'interface C {\n  a: A;\n}',
    )
    expect(out).toBe('interface C {\n  a: A;\n  b: B;\n  c: C;\n}')
  })

  it('appends an `object_type` member with a `;` separator', async () => {
    const out = await apply((root) => root.find('object_type').first().append('c: C'), 'type T = {\n  a: A;\n  b: B;\n};')
    expect(out).toBe('type T = {\n  a: A;\n  b: B;\n  c: C;\n};')
  })

  it('keeps an inline interface body on one line, `;`-separated (not comma-joined)', async () => {
    // An inline body stays inline — the fix is the separator (`;`, not `,`); reflowing an existing
    // inline body to multi-line is beyond an additive append.
    const out = await apply((root) => root.find('interface_body').first().append('b: B'), 'interface C { a: A; }')
    expect(out).toBe('interface C { a: A; b: B; }')
  })

  it('prepends to a multi-line object on its own line (mirror of append)', async () => {
    const out = await apply((root) => root.find('object').first().prepend('x: 0'), 'const a = {\n  a: 1,\n  b: 2,\n};')
    expect(out).toBe('const a = {\n  x: 0,\n  a: 1,\n  b: 2,\n};')
  })

  it('prepends an interface member with a `;` separator, matching the body style', async () => {
    const prepZ = (root: Collection<'tsx'>) => root.find('interface_body').first().prepend('z: Z')
    expect(await apply(prepZ, 'interface C {\n  a: A;\n}')).toBe('interface C {\n  z: Z;\n  a: A;\n}')
    // a `;`-less body keeps that style — the newline separates, no `;` is introduced.
    expect(await apply(prepZ, 'interface C {\n  a: A\n}')).toBe('interface C {\n  z: Z\n  a: A\n}')
  })

  it('prepends inline before the first element, keeping brace padding (`;`, not `,`)', async () => {
    expect(await apply((root) => root.find('array').first().prepend('0'), 'const a = [1, 2]')).toBe('const a = [0, 1, 2]')
    expect(await apply((root) => root.find('object').first().prepend('x: 0'), 'const a = { a: 1 }')).toBe(
      'const a = { x: 0, a: 1 }',
    )
    expect(await apply((root) => root.find('interface_body').first().prepend('z: Z'), 'interface C { a: A; }')).toBe(
      'interface C { z: Z; a: A; }',
    )
  })

  it('pads an empty brace container when filling its first element under format', async () => {
    expect(await apply((root) => root.find('object').first().append('a: 1'), 'const a = {}')).toBe('const a = { a: 1 }')
    expect(await apply((root) => root.find('interface_body').first().append('a: A'), 'interface C {}')).toBe(
      'interface C { a: A }',
    )
    // arrays / arg-lists are not padded
    expect(await apply((root) => root.find('array').first().append('3'), 'const a = []')).toBe('const a = [3]')
  })

  it('collapses the line of an own-line element removed under format', async () => {
    // No blank line where `two(),` was — the line goes entirely, as Prettier would have collapsed it.
    const out = await apply(
      (root) => root.find('array').first().children().at(1).remove({ separator: true }),
      'const a = [\n  1,\n  two(),\n  3,\n];',
    )
    expect(out).toBe('const a = [\n  1,\n  3,\n];')
  })

  it('collapses the line of an emptied own-line call argument under format', async () => {
    const out = await apply((root) => root.find('arguments').first().children().at(0).remove({ separator: true }), 'cfg(\n  arg\n);')
    expect(out).toBe('cfg(\n);')
  })

  it('collapses a blank line that preceded a removed last element (no dangling blank before `}`)', async () => {
    // `b` is the last key and a blank line separated it from `a`; removing it would leave that blank
    // dangling before `}`. It collapses, the way Prettier strips a blank line before a closing brace.
    const out = await apply(
      (root) => root.find('pair').filter((p) => p.field('key').text === 'b').remove({ separator: true }),
      'const config = {\n  a: 1,\n\n  b: 2,\n};',
    )
    expect(out).toBe('const config = {\n  a: 1,\n};')
  })

  it('keeps a blank line that becomes an interior separator after removing a middle element', async () => {
    // The blank separated `a` from `b`; removing `b` (a survivor, `c`, follows) leaves the blank as
    // an `a`/`c` separator — Prettier preserves a single interior blank line, so it must not collapse.
    const out = await apply(
      (root) => root.find('pair').filter((p) => p.field('key').text === 'b').remove({ separator: true }),
      'const config = {\n  a: 1,\n\n  b: 2,\n  c: 3,\n};',
    )
    expect(out).toBe('const config = {\n  a: 1,\n\n  c: 3,\n};')
  })

  it('collapses the blank line before the first of several trailing elements removed together', async () => {
    // Removing the last keys in one pass (Bati gating off trailing props): the blank before the first
    // removed key now precedes `}`, so it collapses — the whole selection counts as "last surviving".
    const out = await apply(
      (root) => root.find('pair').filter((p) => ['b', 'c'].includes(p.field('key').text)).remove({ separator: true }),
      'const config = {\n  a: 1,\n\n  b: 2,\n  c: 3,\n};',
    )
    expect(out).toBe('const config = {\n  a: 1,\n};')
  })

  it('cleans the residual space of an inline element removed under format (does not eat siblings)', async () => {
    // The element and its comma go, plus the one separating space, so no double space is left — and
    // the inline sibling `3` survives (whole-line collapse must not fire here).
    const out = await apply(
      (root) => root.find('array').first().children().at(1).remove({ separator: true }),
      'const a = [1, two(), 3];',
    )
    expect(out).toBe('const a = [1, 3];')
  })

  it('drops a directive then removes its own-line element under format (both lines collapse)', async () => {
    // The directive comment owns its line, so `dropDirective` collapses that line and stops there —
    // the following `remove` collapses the element's line independently; the two edits compose.
    const out = await apply(
      (root) => {
        const el = root.find('array').first().children().at(1)
        el.dropDirective(/x/)
        el.remove({ separator: true })
      },
      'const a = [\n  1,\n  //# x\n  two(),\n  3,\n];',
    )
    expect(out).toBe('const a = [\n  1,\n  3,\n];')
  })

  it('drops an own-line directive without removing the node, collapsing only its line, under format', async () => {
    const out = await apply(
      (root) => root.find('array').first().children().at(1).dropDirective(/x/),
      'const a = [\n  1,\n  //# x\n  two(),\n  3,\n];',
    )
    expect(out).toBe('const a = [\n  1,\n  two(),\n  3,\n];')
  })

  it('removes a node inside an unwrapped block under format (the two deletes compose)', async () => {
    // `unwrap` deletes the wrapper up to the kept body's first node, including that node's indent; a
    // following `remove` of that node abuts the unwrap delete and still lands (it must not be rejected
    // for overlapping the already-gone indent). The surviving `keep()` is dedented to the wrapper's
    // level (the deferred unwrap reindent yields to the explicit `remove`, so only it is dedented).
    const out = await apply((root) => {
      const ifst = root.find('if_statement').first()
      const stmts = ifst.field('consequence').children()
      ifst.unwrap(stmts)
      stmts.first().remove()
    }, 'if (a) {\n  drop();\n  keep();\n}')
    expect(out).toBe('keep();')
  })

  it('drops a directive and the comments stacked under it, up to the node, under format', async () => {
    // The contract is "the directive and the gap up to the node": the `///<reference>` below the
    // directive is part of that gap and must go too — not be left behind when only its line collapses.
    const out = await apply(
      (root) => root.children().first().dropDirective(/x/),
      '//# x\n/// <reference types="y" />\nconst a = 1;',
    )
    expect(out).toBe('const a = 1;')
  })

  it('collapses nested conditionals in one pass under format (unwrap then remove inside)', async () => {
    // Bati's one-pass collapse: unwrap a kept block, then descend and remove a dropped sibling inside
    // it. The inner remove must compose with the outer unwrap rather than be rejected for abutting it.
    // The surviving `no()` is dedented to the (column-0) wrapper's level — the outer unwrap's deferred
    // reindent dedents it, while the lines of the removed inner `if` yield to that explicit remove.
    const collapse = defineCodemod<Record<string, boolean>>({ namespace: '$$' }, (root, ctx) => {
      root.find('if_statement').forEach((node) => {
        const cond = node.field('condition')
        if (!cond.text.includes('$$')) return
        if (cond.evaluate(ctx)) node.unwrap(node.field('consequence').children())
        else node.remove()
      })
    })
    const t = await collapse.forTarget('tsx')
    expect(t.transform('if ($$.a) {\n  if ($$.b) {\n    yes();\n  }\n  no();\n}', { a: true, b: false })).toBe('no();')
  })

  it('dedents every statement of an unwrapped multi-statement block, not just the first', async () => {
    // Unwrapping a branch lifts all its statements one level out. The first inherits the wrapper's
    // indent for free, but the rest must be dedented to match — they kept their deeper source indent.
    // The interior blank line is preserved (it indents to nothing).
    const out = await apply((root) => {
      const ifStmt = root.find('if_statement').first()
      ifStmt.unwrap(ifStmt.field('consequence').children())
    }, 'function f() {\n  if (cond) {\n    const x = 1;\n\n    return x;\n  }\n}')
    expect(out).toBe('function f() {\n  const x = 1;\n\n  return x;\n}')
  })

  it('collapses the line of a leading comment emptied via mapLeadingComment under format', async () => {
    const out = await apply(
      (root) => root.find('object').first().children().first().mapLeadingComment(() => ''),
      'const a = {\n  // x\n  k: 1,\n};',
    )
    expect(out).toBe('const a = {\n  k: 1,\n};')
  })

  it('empties just the directive line, keeping a stacked sibling comment, under format', async () => {
    // Bati's stacked dropDirectiveComment: empty the directive but keep the `///<reference>` under it.
    const out = await apply(
      (root) => root.find('object').first().children().first().mapLeadingComment(() => ''),
      'const a = {\n  //# d\n  /// <reference />\n  k: 1,\n};',
    )
    expect(out).toBe('const a = {\n  /// <reference />\n  k: 1,\n};')
  })

  it('a non-empty mapLeadingComment still rewrites in place under format', async () => {
    const out = await apply(
      (root) => root.find('object').first().children().first().mapLeadingComment((s) => s + '!'),
      'const a = {\n  // x\n  k: 1,\n};',
    )
    expect(out).toBe('const a = {\n  // x!\n  k: 1,\n};')
  })

  it('FormatOptions overrides the detected indent unit', async () => {
    const t = await defineCodemod((root: Collection<'tsx'>) => root.find('statement_block').first().append('return 1')).forTarget('tsx')
    // an empty block carries no indent to detect — force a tab unit, so the body lands one tab in.
    expect(t.transform('function f() {}', {}, { indentUnit: '\t' })).toBe('function f() {\n\treturn 1\n}')
  })

  it('FormatOptions overrides the detected EOL for inserted lines', async () => {
    const t = await defineCodemod((root: Collection<'tsx'>) => root.find('statement_block').first().append('c()')).forTarget('tsx')
    // the source is LF; force CRLF, so the appended line uses it (untouched lines keep their own).
    expect(t.transform('function f() {\n  a()\n}', {}, { eol: '\r\n' })).toBe('function f() {\n  a()\r\n  c()\n}')
  })
})
