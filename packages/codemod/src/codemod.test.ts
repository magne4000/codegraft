import { describe, it, expect } from 'vitest'
import type { RichNode } from '@codegraft/core'
import { defineCodemod } from './codemod.js'

describe('defineCodemod — query + edits', () => {
  it('finds by type + field predicate and replaces each match', async () => {
    const t = await defineCodemod((root) => {
      root.find('call_expression', { function: 'foo' }).replaceWith('bar()')
    }).forTarget('tsx')
    expect(t.transform('foo(); baz(); foo()', {})).toBe('bar(); baz(); bar()')
  })

  it('matches a node by its own text via the `text` pseudo-key', async () => {
    const t = await defineCodemod((root) => {
      root.find('identifier', { text: 'old' }).replaceWith('next')
    }).forTarget('tsx')
    expect(t.transform('const x = old + old.y', {})).toBe('const x = next + next.y')
  })

  it('filter + single-node accessors (text/field/evaluate) work inside forEach', async () => {
    const t = await defineCodemod<{ on: boolean }>((root, ctx) => {
      root.find('if_statement').forEach((node) => {
        const cond = node.field('condition')
        if (cond.text !== '(flag)') return
        node.replaceWith(ctx.on ? 'KEEP' : 'DROP')
      })
    }).forTarget('tsx')
    expect(t.transform('if (flag) { a() }', { on: true })).toBe('KEEP')
    expect(t.transform('if (other) { a() }', { on: true })).toBe('if (other) { a() }')
  })

  it('navigates with closest/parent and removes', async () => {
    const t = await defineCodemod((root) => {
      // remove the statement that contains a `debugger`
      root.find('debugger_statement').forEach((node) => {
        expect(node.type).toBe('debugger_statement')
        expect((node.node as RichNode).parent?.type).toBeTypeOf('string')
        node.remove()
      })
    }).forTarget('tsx')
    expect(t.transform('a()\ndebugger\nb()', {})).toBe('a()\nb()')
  })

  it('size() supports idempotency checks', async () => {
    const cm = defineCodemod((root) => {
      if (root.find('call_expression', { function: 'init' }).size() === 0) {
        root.find('identifier', { text: 'marker' }).replaceWith('init()')
      }
    })
    const t = await cm.forTarget('tsx')
    expect(t.transform('marker', {})).toBe('init()')
    expect(t.transform('init()', {})).toBe('init()') // already present → untouched
  })

  it('findComments selects comment nodes (which find/children skip) and can remove them', async () => {
    const t = await defineCodemod((root) => {
      root.findComments(/drop/).remove()
    }).forTarget('tsx')
    expect(t.transform('a() // keep\nb() // drop me', {})).toBe('a() // keep\nb() ')
  })

  it('findComments without a pattern selects every comment in the subtree', async () => {
    const t = await defineCodemod<{ count?: number }>((root, ctx) => {
      ctx.count = root.findComments().size()
    }).forTarget('css')
    const ctx: { count?: number } = {}
    t.transform('/* a */ x { y: 1 } /* b */', ctx)
    expect(ctx.count).toBe(2)
  })

  it('findComments(pattern) removes a CSS comment by content', async () => {
    const t = await defineCodemod((root) => {
      root.findComments(/\$\$/).remove()
    }).forTarget('css')
    expect(t.transform('/* $$.marker */\na { color: red }', {})).toBe('a { color: red }')
  })

  it('remove({ wholeLines }) deletes the whole line, leaving none blank', async () => {
    const t = await defineCodemod((root) => {
      root.findComments(/drop/).remove({ wholeLines: true })
    }).forTarget('css')
    expect(t.transform('a { x: 1 }\n  /* drop */\nb { y: 2 }\n', {})).toBe('a { x: 1 }\nb { y: 2 }\n')
  })

  it('remove({ collapseBlankBefore }) also eats a blank-line separator above', async () => {
    const t = await defineCodemod((root) => {
      root.findComments(/drop/).remove({ wholeLines: true, collapseBlankBefore: true })
    }).forTarget('css')
    expect(t.transform('a { x: 1 }\n\n/* drop */\nb { y: 2 }\n', {})).toBe('a { x: 1 }\nb { y: 2 }\n')
  })
})

describe('defineCodemod — unwrap (nested collapse) + directives', () => {
  // Collapse `if ($$.x) { … }` (no else) by evaluating the condition; unwrap keeps the body and
  // drops the wrapper, so an inner `if` collapses in the same pass.
  const collapse = defineCodemod<Record<string, boolean>>({ namespace: '$$' }, (root, ctx) => {
    root.find('if_statement').forEach((node) => {
      const cond = node.field('condition')
      if (!cond.text.includes('$$')) return
      if (cond.evaluate(ctx)) node.unwrap(node.field('consequence').children())
      else node.remove()
    })
  })

  it('collapses nested conditionals in one pass', async () => {
    const t = await collapse.forTarget('tsx')
    const src = 'if ($$.a) {\n  if ($$.b) {\n    yes()\n  }\n}'
    expect(t.transform(src, { a: true, b: true })).toBe('yes()')
    expect(t.transform(src, { a: true, b: false })).toBe('')
    expect(t.transform(src, { a: false, b: true })).toBe('')
  })

  it('leaves non-$$ ifs untouched (the scan-gate + guard)', async () => {
    const t = await collapse.forTarget('tsx')
    expect(t.transform('if (other) { a() }', { a: true })).toBe('if (other) { a() }')
  })

  it('gates a declaration on a directive comment, consuming the directive', async () => {
    const cm = defineCodemod<Record<string, boolean>>({ namespace: '$$' }, (root, ctx) => {
      root.find('lexical_declaration').forEach((decl) => {
        const m = decl.directive(/\$\$[^\n]*/)
        if (!m) return
        decl.dropDirective(/\$\$/)
        if (!decl.evaluateExpression(m[0], ctx)) decl.remove()
      })
    })
    const t = await cm.forTarget('tsx')
    expect(t.transform('// $$.auth\nconst x = 1', { auth: true })).toBe('const x = 1')
    expect(t.transform('// $$.auth\nconst x = 1', { auth: false })).toBe('')
    expect(t.transform('const y = 2', { auth: false })).toBe('const y = 2')
  })
})

describe('defineCodemod — insertion', () => {
  it('insertBefore / insertAfter a node', async () => {
    const t = await defineCodemod((root) => {
      root.find('call_expression', { function: 'go' }).insertBefore('before;\n').insertAfter(';after')
    }).forTarget('tsx')
    expect(t.transform('go()', {})).toBe('before;\ngo();after')
  })

  it('append / prepend into an array (and an empty one)', async () => {
    const t = await defineCodemod((root) => {
      root.find('array').first().append('c').prepend('a0')
    }).forTarget('tsx')
    expect(t.transform('const x = [a, b]', {})).toBe('const x = [a0, a, b, c]')

    const empty = await defineCodemod((root) => root.find('array').first().append('only')).forTarget('tsx')
    expect(empty.transform('const x = []', {})).toBe('const x = [only]')
  })

  it('ensureImport is idempotent and lands after existing imports', async () => {
    const t = await defineCodemod((root) => root.ensureImport("import p from 'p'")).forTarget('tsx')
    expect(t.transform("import a from 'a'\nconst x = 1", {})).toBe("import a from 'a'\nimport p from 'p'\nconst x = 1")
    expect(t.transform("import p from 'p'\nconst x = 1", {})).toBe("import p from 'p'\nconst x = 1")
    expect(t.transform('const x = 1', {})).toBe("import p from 'p'\nconst x = 1")
  })

  it('vite.config flagship: register a plugin + its import, idempotently', async () => {
    const cm = defineCodemod((root) => {
      const plugins = root
        .find('call_expression', { function: 'defineConfig' })
        .find('pair', { key: 'plugins' })
        .find('array')
        .first()
      if (plugins.size() && plugins.find('call_expression', { function: 'myPlugin' }).size() === 0) {
        plugins.append('myPlugin()')
        root.ensureImport("import myPlugin from 'my-plugin'")
      }
    })
    const t = await cm.forTarget('tsx')
    const src = [
      "import { defineConfig } from 'vite'",
      'export default defineConfig({',
      '  plugins: [react()],',
      '})',
      '',
    ].join('\n')
    const out = t.transform(src, {})
    expect(out).toContain("import myPlugin from 'my-plugin'")
    expect(out).toContain('plugins: [react(), myPlugin()]')
    expect(t.transform(out, {})).toBe(out) // idempotent
  })
})

describe('defineCodemod — functional mutation', () => {
  it('replaceWith derives the text from each node via a callback', async () => {
    const t = await defineCodemod((root) => {
      root.find('identifier').replaceWith((id) => id.text.toUpperCase())
    }).forTarget('tsx')
    expect(t.transform('a + b', {})).toBe('A + B')
  })

  it('setField overwrites a field (literal + derived) and no-ops when absent', async () => {
    const value = await defineCodemod((root) => root.find('variable_declarator').setField('value', '2')).forTarget('tsx')
    expect(value.transform('const x = 1', {})).toBe('const x = 2')

    const name = await defineCodemod((root) =>
      root.find('variable_declarator').setField('name', (c) => c.toUpperCase()),
    ).forTarget('tsx')
    expect(name.transform('const x = 1', {})).toBe('const X = 1')

    const absent = await defineCodemod((root) => root.find('variable_declarator').setField('nope', 'z')).forTarget('tsx')
    expect(absent.transform('const x = 1', {})).toBe('const x = 1')
  })

  it('wrap surrounds each node', async () => {
    const t = await defineCodemod((root) => root.find('call_expression').wrap('(', ')')).forTarget('tsx')
    expect(t.transform('foo()', {})).toBe('(foo())')
  })

  it('moveBefore relocates a node (delete here, re-insert there)', async () => {
    const t = await defineCodemod((root) => {
      const stmts = root.find('expression_statement')
      stmts.at(1).moveBefore(stmts.first())
    }).forTarget('tsx')
    expect(t.transform('keep();\nmove();', {})).toBe('move();keep();\n')
  })
})

describe('defineCodemod — code builder', () => {
  it('validates a snippet and feeds it to an insert', async () => {
    const t = await defineCodemod((root) => {
      const arr = root.find('array').first()
      arr.append(arr.code`vue()`)
    }).forTarget('tsx')
    expect(t.transform('const x = [react()]', {})).toBe('const x = [react(), vue()]')
  })

  it('interpolates a Collection’s text', async () => {
    const t = await defineCodemod((root) => {
      root.find('call_expression').forEach((call) => {
        const name = call.field('function')
        call.replaceWith(call.code`wrap(${name})`)
      })
    }).forTarget('tsx')
    expect(t.transform('foo()', {})).toBe('wrap(foo)')
  })

  it('asserts on a malformed snippet instead of emitting it', async () => {
    const t = await defineCodemod((root) => {
      root.find('array').first().append(root.code`vue(`)
    }).forTarget('tsx')
    expect(() => t.transform('const x = [a]', {})).toThrow(/invalid tsx snippet/)
  })
})

describe('defineCodemod — richer querying', () => {
  it('matches a nested field path', async () => {
    const t = await defineCodemod((root) => {
      root.find('call_expression', { function: { object: 'foo' } }).replaceWith('X')
    }).forTarget('tsx')
    expect(t.transform('foo.bar()\nbaz.bar()', {})).toBe('X\nbaz.bar()')
  })

  it('expands a grammar supertype to its concrete subtypes (transitively)', async () => {
    let kinds: string[] = []
    const t = await defineCodemod((root) => {
      kinds = root.find('statement').getTypes()
    }).forTarget('tsx')
    t.transform('const a = 1\nif (x) {}\nfoo()', {})
    expect(kinds).toContain('lexical_declaration') // reached transitively via `declaration`
    expect(kinds).toContain('if_statement')
    expect(kinds).toContain('expression_statement')
  })

  it('isOfType gates an edit', async () => {
    const t = await defineCodemod((root) => {
      const nums = root.find('number')
      if (nums.isOfType('number')) nums.replaceWith('0')
    }).forTarget('tsx')
    expect(t.transform('const x = 5', {})).toBe('const x = 0')
  })
})

describe('defineCodemod — navigation', () => {
  it('nextSibling / prevSibling / siblings', async () => {
    const next = await defineCodemod((root) =>
      root.find('identifier', { text: 'b' }).nextSibling().replaceWith('N'),
    ).forTarget('tsx')
    expect(next.transform('const x = [a, b, c]', {})).toBe('const x = [a, b, N]')

    const prev = await defineCodemod((root) =>
      root.find('identifier', { text: 'b' }).prevSibling().replaceWith('P'),
    ).forTarget('tsx')
    expect(prev.transform('const x = [a, b, c]', {})).toBe('const x = [P, b, c]')

    const sibs = await defineCodemod((root) =>
      root.find('identifier', { text: 'b' }).siblings().replaceWith('X'),
    ).forTarget('tsx')
    expect(sibs.transform('const x = [a, b, c]', {})).toBe('const x = [X, b, X]')
  })

  it('ancestors lists the chain and filters by type', async () => {
    let types: string[] = []
    const list = await defineCodemod((root) => {
      types = root.find('identifier', { text: 'deep' }).ancestors().getTypes()
    }).forTarget('tsx')
    list.transform('function f() { return [deep] }', {})
    expect(types).toEqual(expect.arrayContaining(['array', 'function_declaration', 'program']))

    const filtered = await defineCodemod((root) =>
      root.find('identifier', { text: 'deep' }).ancestors('function_declaration').replaceWith('FN'),
    ).forTarget('tsx')
    expect(filtered.transform('function f() { return deep }', {})).toBe('FN')
  })

  it('closestScope finds the nearest scope boundary', async () => {
    let type = ''
    const t = await defineCodemod((root) => {
      type = root.find('identifier', { text: 'x' }).first().closestScope().type
    }).forTarget('tsx')
    t.transform('function f() { const x = 1 }', {})
    expect(type).toBe('statement_block')
  })
})

describe('defineCodemod — comments', () => {
  it('adds a leading / trailing comment', async () => {
    const lead = await defineCodemod((root) =>
      root.find('lexical_declaration').addLeadingComment('// note'),
    ).forTarget('tsx')
    expect(lead.transform('const x = 1', {})).toBe('// note\nconst x = 1')

    const trail = await defineCodemod((root) =>
      root.find('lexical_declaration').addTrailingComment('// keep'),
    ).forTarget('tsx')
    expect(trail.transform('const x = 1', {})).toBe('const x = 1 // keep')
  })

  it('removes a node’s comments (leading + inner/trailing), keeping the code', async () => {
    const t = await defineCodemod((root) => root.find('lexical_declaration').first().removeComments()).forTarget('tsx')
    const out = t.transform('// a\nconst x = 1 // b\nconst y = 2', {})
    expect(out).not.toMatch(/\/\/ a|\/\/ b/) // both comments gone (residual spacing left to Prettier)
    expect(out).toContain('const x = 1')
    expect(out).toContain('const y = 2')
  })

  it('rewrites the first leading comment', async () => {
    const t = await defineCodemod((root) =>
      root.find('lexical_declaration').mapLeadingComment((c) => c.toUpperCase()),
    ).forTarget('tsx')
    expect(t.transform('// note\nconst x = 1', {})).toBe('// NOTE\nconst x = 1')
  })
})
