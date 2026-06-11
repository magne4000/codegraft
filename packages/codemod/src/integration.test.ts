import { describe, it, expect } from 'vitest'
import type { Collection } from '@codegraft/core'
import { vueSplitter } from '@codegraft/vue'
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

  // Tier 1: the `<template>` is a `vue` zone (not opaque html), so a codemod can match and edit its
  // structure — `tag_name`, `directive_attribute`, `interpolation` — typed against the generated vue
  // node-type unions (no cast).
  it('reaches template structure as a vue zone — renames a tag, strips a directive', async () => {
    const edit = defineCodemod((root) => {
      root.find('tag_name').forEach((tag) => {
        if (tag.text === 'OldWidget') tag.replaceWith('NewWidget')
      })
      root.find('directive_attribute').forEach((attr) => {
        const name = attr.find('directive_name').first()
        if (name.size() > 0 && name.text === 'v-debug') attr.remove()
      })
    })
    const t = await edit.forTarget(vueSplitter)
    const sfc = ['<template>', '  <OldWidget v-debug>{{ label }}</OldWidget>', '</template>', ''].join('\n')
    const out = t.transform(sfc, {})
    expect(out).toContain('<NewWidget') // start tag_name renamed
    expect(out).toContain('</NewWidget>') // end tag_name renamed too
    expect(out).not.toContain('OldWidget')
    expect(out).not.toContain('v-debug') // directive_attribute removed
    expect(out).toContain('{{ label }}') // interpolation preserved
  })

  // Tier 1: directive-level `$$` collapse — the headline feature reaching the template via
  // `evaluateExpression` on the directive's value text. (Inside-expression collapse is Tier 2.)
  it('collapses a $$ `v-if` at the directive level (true → strip directive, false → drop element)', async () => {
    const collapseVIf = defineCodemod<Ctx>({ namespace: '$$' }, (root, ctx) => {
      root.find('directive_attribute').forEach((attr) => {
        const name = attr.find('directive_name').first()
        if (name.size() === 0 || name.text !== 'v-if') return
        const expr = attr.find('attribute_value').first()
        if (expr.size() === 0 || !expr.text.includes('$$')) return
        if (attr.evaluateExpression(expr.text, ctx)) attr.remove()
        else attr.closest('element').remove()
      })
    })
    const t = await collapseVIf.forTarget(vueSplitter)
    const sfc = ['<template>', `  <nav v-if="$$.BATI.has('auth')">menu</nav>`, '</template>', ''].join('\n')

    const on = t.transform(sfc, bati('auth'))
    expect(on).toContain('<nav') // element kept
    expect(on).toContain('menu')
    expect(on).not.toContain('v-if') // always-true directive stripped
    expect(on).not.toContain('$$')

    const off = t.transform(sfc, bati())
    expect(off).not.toContain('<nav') // whole element dropped
    expect(off).not.toContain('menu')
  })
})
