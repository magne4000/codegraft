import { describe, it, expect } from 'vitest'
import { remove, type RichNode } from '@trast/core'
import { defineRules } from './define-rules.js'

const featureOf = (call: RichNode) => call.child('arguments')?.children[0]?.text.slice(1, -1)

// A userland boolean evaluator over a JS/TS condition tree (core ships no such helper).
function evalBoolean(node: RichNode, leaf: (n: RichNode) => boolean): boolean {
  switch (node.type) {
    case 'parenthesized_expression':
      return evalBoolean(node.children[0], leaf)
    case 'unary_expression': // !x
      return !evalBoolean(node.children[0], leaf)
    case 'binary_expression': {
      const op = node.child('operator')?.text
      if (op === '&&') return evalBoolean(node.children[0], leaf) && evalBoolean(node.children[1], leaf)
      if (op === '||') return evalBoolean(node.children[0], leaf) || evalBoolean(node.children[1], leaf)
      return leaf(node)
    }
    default:
      return leaf(node)
  }
}

describe('defineRules (dev mode)', () => {
  it('transforms a single BATI.has if/else from typed context', async () => {
    const rules = defineRules<{ features: string[] }>((match) => [
      match.tsx.expr`if (BATI.has($feature)) { $$$then } else { $$$otherwise }`.rewrite(
        ({ feature, then, otherwise }, ctx) =>
          ctx.features.includes((feature as RichNode).text.slice(1, -1))
            ? (then as RichNode[])
            : (otherwise as RichNode[]),
      ),
    ])
    const t = await rules.forTarget('tsx')
    const src = 'if (BATI.has("auth")) { a() } else { b() }'
    expect(t.transform(src, { features: ['auth'] })).toBe('a()')
    expect(t.transform(src, { features: [] })).toBe('b()')
  })

  it('handles a compound condition via a .where guard + userland evalBoolean', async () => {
    const rules = defineRules<{ features: string[] }>((match) => [
      match.tsx.expr`if ($cond) { $$$then } else { $$$otherwise }`
        .where(({ cond }) => (cond as RichNode).text.includes('BATI.'))
        .rewrite(({ cond, then, otherwise }, ctx) => {
          const on = evalBoolean(cond as RichNode, (leaf) => ctx.features.includes(featureOf(leaf) ?? ''))
          return on ? (then as RichNode[]) : (otherwise as RichNode[])
        }),
    ])
    const t = await rules.forTarget('tsx')
    const src = 'if (BATI.has("a") && !BATI.has("b")) { yes() } else { no() }'
    expect(t.transform(src, { features: ['a'] })).toBe('yes()') // a && !b = T && !F
    expect(t.transform(src, { features: ['a', 'b'] })).toBe('no()') // T && !T = F
    expect(t.transform(src, { features: [] })).toBe('no()') // F && ...
    // a plain non-BATI if is not claimed (guard misses)
    expect(t.transform('if (x) { y() } else { z() }', { features: [] })).toBe(
      'if (x) { y() } else { z() }',
    )
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
