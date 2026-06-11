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

  it('re-anchors an appended multi-line block to the container, not stacking its source indent', async () => {
    // mergeDts relocates a whole `interface` by appending its `.text` — a block whose first line is
    // flush but whose body keeps its source indent. It must match its new sibling (member and closing
    // brace aligned), not land a level too deep from the indent already on its continuation lines.
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('statement_block').first().append('interface B {\n    y: Y;\n  }')
    }).forTarget('tsx')
    expect(t.transform('namespace V {\n  interface A {\n    x: X;\n  }\n}', {})).toBe(
      'namespace V {\n  interface A {\n    x: X;\n  }\n  interface B {\n    y: Y;\n  }\n}',
    )
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

  it('appends to a multi-line object on its own line, keeping the trailing-comma style', async () => {
    // The object is laid out one-key-per-line with trailing commas — the new key joins that layout
    // (its own line, indented, trailing comma) instead of being glued inline after the last key.
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('call_expression', { function: 'defineConfig' }).first().field('arguments').children().first().append('resolve: { alias: {} }')
    }).forTarget('tsx')
    expect(t.transform('export default defineConfig({\n  plugins: [vike()],\n  build: { sourcemap: false },\n});', {})).toBe(
      'export default defineConfig({\n  plugins: [vike()],\n  build: { sourcemap: false },\n  resolve: { alias: {} },\n});',
    )
  })

  it('appends to a multi-line array without a trailing comma, adding only the separating comma', async () => {
    // No trailing comma in the source → the new element gets none either; just the comma that
    // separates it from the previous one. (Host trailing-comma style preserved.)
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('array').first().append('3')
    }).forTarget('tsx')
    expect(t.transform('const a = [\n  1,\n  2\n];', {})).toBe('const a = [\n  1,\n  2,\n  3\n];')
  })

  it('appends an interface member with a `;` separator, not a comma, keeping the layout', async () => {
    // Interface/type members are `;`-separated, never comma-joined. A multi-line body that already
    // terminates members with `;` gets the new member on its own line, likewise `;`-terminated.
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('interface_body').first().append('b: B')
    }).forTarget('tsx')
    expect(t.transform('interface C {\n  a: A;\n}', {})).toBe('interface C {\n  a: A;\n  b: B;\n}')
  })

  it('appends an interface member to a `;`-less multi-line body, relying on the newline (no `;` added)', async () => {
    // The body separates members by newline alone — the `;` is optional, so the new member matches
    // (own line, no terminator) rather than introducing a `;` the host doesn't use. The real `.d.ts`
    // merge shape (Vike.PageContext member union).
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('interface_body').first().append('session?: Session')
    }).forTarget('tsx')
    expect(t.transform('interface PageContext {\n  user?: User\n}', {})).toBe(
      'interface PageContext {\n  user?: User\n  session?: Session\n}',
    )
  })

  it('folds several interface members in one pass, each on its own `;`-terminated line', async () => {
    // Multiple appends to the same body compose (each lands after the previous), the way mergeDts
    // unions a duplicate interface's members into the canonical one.
    const t = await defineCodemod({ format: true }, (root) => {
      const body = root.find('interface_body').first()
      body.append('b: B')
      body.append('c: C')
    }).forTarget('tsx')
    expect(t.transform('interface C {\n  a: A;\n}', {})).toBe('interface C {\n  a: A;\n  b: B;\n  c: C;\n}')
  })

  it('appends an `object_type` member with a `;` separator', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('object_type').first().append('c: C')
    }).forTarget('tsx')
    expect(t.transform('type T = {\n  a: A;\n  b: B;\n};', {})).toBe('type T = {\n  a: A;\n  b: B;\n  c: C;\n};')
  })

  it('keeps an inline interface body on one line, `;`-separated (not comma-joined)', async () => {
    // An inline body stays inline — the fix is the separator (`;`, not `,`); reflowing an existing
    // inline body to multi-line is beyond an additive append.
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('interface_body').first().append('b: B')
    }).forTarget('tsx')
    expect(t.transform('interface C { a: A; }', {})).toBe('interface C { a: A; b: B; }')
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

  it('drops a directive then removes its own-line element under format (both lines collapse)', async () => {
    // The directive comment owns its line, so `dropDirective` collapses that line and stops there —
    // the following `remove` collapses the element's line independently; the two edits compose.
    const t = await defineCodemod({ format: true }, (root) => {
      const el = root.find('array').first().children().at(1)
      el.dropDirective(/x/)
      el.remove({ separator: true })
    }).forTarget('tsx')
    expect(t.transform('const a = [\n  1,\n  //# x\n  two(),\n  3,\n];', {})).toBe('const a = [\n  1,\n  3,\n];')
  })

  it('drops an own-line directive without removing the node, collapsing only its line, under format', async () => {
    const t = await defineCodemod({ format: true }, (root) => {
      root.find('array').first().children().at(1).dropDirective(/x/)
    }).forTarget('tsx')
    expect(t.transform('const a = [\n  1,\n  //# x\n  two(),\n  3,\n];', {})).toBe('const a = [\n  1,\n  two(),\n  3,\n];')
  })

  it('without format, dropDirective + remove still drops the element (verbatim, blank line left)', async () => {
    const t = await defineCodemod((root) => {
      const el = root.find('array').first().children().at(1)
      el.dropDirective(/x/)
      el.remove({ separator: true })
    }).forTarget('tsx')
    expect(t.transform('const a = [\n  1,\n  //# x\n  two(),\n  3,\n];', {})).toBe('const a = [\n  1,\n  \n  3,\n];')
  })

  it('removes a node inside an unwrapped block under format (the two deletes compose)', async () => {
    // `unwrap` deletes the wrapper up to the kept body's first node, including that node's indent; a
    // following `remove` of that node abuts the unwrap delete and still lands (it must not be rejected
    // for overlapping the already-gone indent).
    const t = await defineCodemod({ format: true }, (root) => {
      const ifst = root.find('if_statement').first()
      const stmts = ifst.field('consequence').children()
      ifst.unwrap(stmts)
      stmts.first().remove()
    }).forTarget('tsx')
    expect(t.transform('if (a) {\n  drop();\n  keep();\n}', {})).toBe('  keep();')
  })

  it('drops a directive and the comments stacked under it, up to the node, under format', async () => {
    // The contract is "the directive and the gap up to the node": the `///<reference>` below the
    // directive is part of that gap and must go too — not be left behind when only its line collapses.
    const t = await defineCodemod({ format: true }, (root) => {
      root.children().first().dropDirective(/x/)
    }).forTarget('tsx')
    expect(t.transform('//# x\n/// <reference types="y" />\nconst a = 1;', {})).toBe('const a = 1;')
  })

  it('collapses nested conditionals in one pass under format (unwrap then remove inside)', async () => {
    // Bati's one-pass collapse: unwrap a kept block, then descend and remove a dropped sibling inside
    // it. The inner remove must compose with the outer unwrap rather than be rejected for abutting it.
    const collapse = defineCodemod<Record<string, boolean>>({ namespace: '$$', format: true }, (root, ctx) => {
      root.find('if_statement').forEach((node) => {
        const cond = node.field('condition')
        if (!cond.text.includes('$$')) return
        if (cond.evaluate(ctx)) node.unwrap(node.field('consequence').children())
        else node.remove()
      })
    })
    const t = await collapse.forTarget('tsx')
    expect(t.transform('if ($$.a) {\n  if ($$.b) {\n    yes();\n  }\n  no();\n}', { a: true, b: false })).toBe('  no();')
  })

  it('collapses the line of a leading comment emptied via mapLeadingComment under format', async () => {
    const t = await defineCodemod({ format: true }, (root) =>
      root.find('object').first().children().first().mapLeadingComment(() => ''),
    ).forTarget('tsx')
    expect(t.transform('const a = {\n  // x\n  k: 1,\n};', {})).toBe('const a = {\n  k: 1,\n};')
  })

  it('empties just the directive line, keeping a stacked sibling comment, under format', async () => {
    // Bati's stacked dropDirectiveComment: empty the directive but keep the `///<reference>` under it.
    const t = await defineCodemod({ format: true }, (root) =>
      root.find('object').first().children().first().mapLeadingComment(() => ''),
    ).forTarget('tsx')
    expect(t.transform('const a = {\n  //# d\n  /// <reference />\n  k: 1,\n};', {})).toBe(
      'const a = {\n  /// <reference />\n  k: 1,\n};',
    )
  })

  it('a non-empty mapLeadingComment still rewrites in place under format', async () => {
    const t = await defineCodemod({ format: true }, (root) =>
      root.find('object').first().children().first().mapLeadingComment((s) => s + '!'),
    ).forTarget('tsx')
    expect(t.transform('const a = {\n  // x\n  k: 1,\n};', {})).toBe('const a = {\n  // x!\n  k: 1,\n};')
  })

  it('without format, emptying a leading comment leaves its line blank (verbatim contract)', async () => {
    const t = await defineCodemod((root) =>
      root.find('object').first().children().first().mapLeadingComment(() => ''),
    ).forTarget('tsx')
    expect(t.transform('const a = {\n  // x\n  k: 1,\n};', {})).toBe('const a = {\n  \n  k: 1,\n};')
  })

  it('is off by default — an appended statement still lands at column 0', async () => {
    const t = await defineCodemod((root) => {
      root.find('statement_block').first().append('c()')
    }).forTarget('tsx')
    expect(t.transform('function f() {\n  a()\n  b()\n}', {})).toBe('function f() {\n  a()\n  b()\nc()\n}')
  })
})
