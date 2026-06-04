import { describe, it, expect } from 'vitest'
import { remove, evaluate, type RichNode } from '@trast/core'
import { defineRules } from './define-rules.js'

describe('defineRules (dev mode)', () => {
  it('decides $$ conditions — simple and compound — with the built-in evaluate', async () => {
    const rules = defineRules<{ BATI: { has(f: string): boolean } }>({ namespace: '$$' }, (match) => [
      match.tsx.expr`if ($cond) { $$$then } else { $$$otherwise }`
        .where(({ cond }) => (cond as RichNode).text.includes('$$'))
        .rewrite(({ cond, then, otherwise }, ctx) =>
          evaluate(cond as RichNode, ctx) ? (then as RichNode[]) : (otherwise as RichNode[]),
        ),
    ])
    const t = await rules.forTarget('tsx')
    const bati = (...on: string[]) => ({ BATI: { has: (f: string) => on.includes(f) } })

    const simple = 'if ($$.BATI.has("auth")) { a() } else { b() }'
    expect(t.transform(simple, bati('auth'))).toBe('a()')
    expect(t.transform(simple, bati())).toBe('b()')

    const compound = 'if ($$.BATI.has("a") && !$$.BATI.has("b")) { yes() } else { no() }'
    expect(t.transform(compound, bati('a'))).toBe('yes()') // T && !F
    expect(t.transform(compound, bati('a', 'b'))).toBe('no()') // T && !T = F

    // a plain non-$$ if isn't claimed (the guard misses)
    expect(t.transform('if (x) { y() } else { z() }', bati())).toBe('if (x) { y() } else { z() }')
  })

  it('comment-gated rule removes only the tagged declaration', async () => {
    const rules = defineRules((match) => [
      match.ts.node('lexical_declaration').whenLeadingComment(/@kill/).rewrite(() => remove),
    ])
    const t = await rules.forTarget('typescript')
    expect(t.transform('// @kill\nconst x = 1\nconst y = 2', {})).toBe('\nconst y = 2')
  })

  it('compiledRulesFor emits plain data (parsed pattern + passthrough rewrite)', async () => {
    const rules = defineRules((match) => [
      match.tsx.expr`BATI.has($f)`.rewrite(() => remove),
    ])
    const compiled = await rules.compiledRulesFor('tsx')
    expect(compiled).toHaveLength(1)
    expect(compiled[0]).toMatchObject({
      language: 'tsx',
      pattern: { kind: 'exact', nodeType: 'call_expression' },
      guard: null,
      commentRegex: null,
    })
    expect(typeof compiled[0].rewrite).toBe('function')
  })

  it('filters rules per target and always includes any rules', async () => {
    const rules = defineRules((match) => [
      match.css.node('declaration').rewrite(() => '/*c*/'),
      match.tsx.node('lexical_declaration').rewrite(() => 'TS'),
      match.any().rewrite(() => remove),
    ])
    expect((await rules.compiledRulesFor('tsx')).map((r) => r.language)).toEqual(['tsx', 'any'])
    expect((await rules.compiledRulesFor('css')).map((r) => r.language)).toEqual(['css', 'any'])
  })
})
