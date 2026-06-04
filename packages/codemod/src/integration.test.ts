import { describe, it, expect } from 'vitest'
import type { Collection } from '@trast/core'
import { vueSplitter } from '@trast/vue'
import { defineCodemod } from './codemod.js'

type Ctx = { BATI: { has(feature: string): boolean } }
const bati = (...features: string[]): Ctx => ({ BATI: { has: (f) => features.includes(f) } })

const usesNamespace = (cond: Collection) => cond.text.includes('$$')

/** The canonical Bati transform, re-authored as a codemod (replacing the expr rule set):
 *  if/else + ternary collapse via evaluate+unwrap, and comment-gated declarations. */
const batiCodemod = defineCodemod<Ctx>({ namespace: '$$' }, (root, ctx) => {
  root.find('if_statement').forEach((node) => {
    const cond = node.field('condition')
    if (!usesNamespace(cond)) return
    if (cond.evaluate(ctx)) {
      node.unwrap(node.field('consequence').children())
    } else {
      const alt = node.field('alternative')
      if (alt.size() === 0) node.remove()
      else node.unwrap(alt.find('statement_block').first().children())
    }
  })

  root.find('ternary_expression').forEach((node) => {
    const cond = node.field('condition')
    if (!usesNamespace(cond)) return
    node.unwrap(cond.evaluate(ctx) ? node.field('consequence') : node.field('alternative'))
  })

  root.find('lexical_declaration').forEach((decl) => {
    const m = decl.directive(/\$\$[^\n]*/)
    if (!m) return
    decl.dropDirective(/\$\$/)
    if (!decl.evaluateExpression(m[0], ctx)) decl.remove()
  })
})

describe('codemod integration — the Bati transform', () => {
  it('collapses if/else (both branches)', async () => {
    const t = await batiCodemod.forTarget('tsx')
    const src = 'if ($$.BATI.has("auth")) {\n  dash()\n} else {\n  landing()\n}'
    expect(t.transform(src, bati('auth'))).toBe('dash()')
    expect(t.transform(src, bati())).toBe('landing()')
  })

  it('collapses a ternary', async () => {
    const t = await batiCodemod.forTarget('tsx')
    const src = 'const v = $$.BATI.has("auth") ? dash : landing'
    expect(t.transform(src, bati('auth'))).toBe('const v = dash')
    expect(t.transform(src, bati())).toBe('const v = landing')
  })

  it('gates a declaration on a directive comment', async () => {
    const t = await batiCodemod.forTarget('tsx')
    const src = '// $$.BATI.has("auth")\nconst session = createSession()'
    expect(t.transform(src, bati('auth'))).toBe('const session = createSession()')
    expect(t.transform(src, bati())).toBe('')
  })

  it('transforms the <script> zone of a Vue SFC (multi-zone)', async () => {
    const t = await batiCodemod.forTarget(vueSplitter)
    const sfc = [
      '<template>',
      '  <h1>{{ title }}</h1>',
      '</template>',
      '',
      '<script setup lang="ts">',
      'const title = "App"',
      'if ($$.BATI.has("auth")) {',
      '  useAuth()',
      '} else {',
      '  useGuest()',
      '}',
      '</script>',
      '',
    ].join('\n')
    const on = t.transform(sfc, bati('auth'))
    expect(on).toContain('useAuth()')
    expect(on).not.toContain('useGuest()')
    expect(on).not.toContain('$$')
    expect(on).toContain('<h1>{{ title }}</h1>') // template untouched

    const off = t.transform(sfc, bati())
    expect(off).toContain('useGuest()')
    expect(off).not.toContain('useAuth()')
  })
})
