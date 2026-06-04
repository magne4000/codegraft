import { describe, it, expect } from 'vitest'
import type { RichNode } from '@trast/core'
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
    expect(t.transform('a()\ndebugger\nb()', {})).toBe('a()\n\nb()')
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
