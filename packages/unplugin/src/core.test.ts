import { describe, it, expect, beforeAll } from 'vitest'
import type { RichNode } from '@trast/core'
import { defineRules, type RuleSetBuilder } from '@trast/match'
import { vueSplitter } from '@trast/vue'
import { makeUnpluginOptions } from './core.js'
import { trast } from './index.js'

const IF_ELSE = 'if (BATI.has("auth")) { a() } else { b() }'

// unplugin's transform hook is invoked with a build-context `this`; the Trast body
// doesn't use it, so a cast suffices for direct testing.
type TransformFn = (code: string, id: string) => Promise<{ code: string } | null>
const callTransform = (opts: ReturnType<typeof makeUnpluginOptions>, code: string, id: string) =>
  (opts.transform as unknown as TransformFn)(code, id)

let rules: RuleSetBuilder<{ features: string[] }>
beforeAll(() => {
  rules = defineRules<{ features: string[] }>((match) =>
    (['tsx', 'ts'] as const).map((lang) =>
      match[lang].expr`if (BATI.has($f)) { $$$then } else { $$$otherwise }`.rewrite(
        ({ f, then, otherwise }, ctx) =>
          ctx.features.includes((f as RichNode).text.slice(1, -1))
            ? (then as RichNode[])
            : (otherwise as RichNode[]),
      ),
    ),
  )
})

describe('makeUnpluginOptions', () => {
  it('transformInclude matches handled extensions only (and respects the query suffix)', () => {
    const opts = makeUnpluginOptions({ rules, context: { features: [] } })
    expect(opts.transformInclude!('/app/Page.tsx')).toBe(true)
    expect(opts.transformInclude!('/app/main.ts?foo=1')).toBe(true) // query stripped
    expect(opts.transformInclude!('/app/readme.md')).toBe(false)
  })

  it('transforms a handled module with the build context', async () => {
    const enabled = makeUnpluginOptions({ rules, context: { features: ['auth'] } })
    expect((await callTransform(enabled, IF_ELSE, '/app/Page.tsx'))?.code).toBe('a()')

    const disabled = makeUnpluginOptions({ rules, context: { features: [] } })
    expect((await callTransform(disabled, IF_ELSE, '/app/Page.tsx'))?.code).toBe('b()')
  })

  it('returns null for unchanged code and unhandled extensions (so the bundler skips it)', async () => {
    const opts = makeUnpluginOptions({ rules, context: { features: [] } })
    expect(await callTransform(opts, 'const x = 1', '/app/Page.tsx')).toBeNull() // no rule matched
    expect(await callTransform(opts, 'whatever', '/app/notes.md')).toBeNull() // unhandled ext
  })

  it('handles a multi-zone format via a splitter (vue)', async () => {
    const opts = makeUnpluginOptions({
      rules,
      context: { features: ['auth'] },
      splitters: [vueSplitter],
    })
    expect(opts.transformInclude!('/app/App.vue')).toBe(true)
    const sfc = '<script setup lang="ts">\nif (BATI.has("auth")) { a() } else { b() }\n</script>\n'
    const result = await callTransform(opts, sfc, '/app/App.vue')
    expect(result?.code).toContain('a()')
    expect(result?.code).not.toContain('BATI.has')
  })

  it('does not handle .vue without a configured splitter', () => {
    const opts = makeUnpluginOptions({ rules, context: { features: [] } })
    expect(opts.transformInclude!('/app/App.vue')).toBe(false)
  })

  it('respects include/exclude filters', () => {
    const opts = makeUnpluginOptions({
      rules,
      context: { features: [] },
      exclude: ['**/skip/**'],
    })
    expect(opts.transformInclude!('/app/keep/Page.tsx')).toBe(true)
    expect(opts.transformInclude!('/app/skip/Page.tsx')).toBe(false)
  })
})

describe('trast adapters', () => {
  it('exposes every bundler adapter and produces a named plugin', () => {
    const instance = trast({ rules, context: { features: [] } })
    for (const adapter of ['vite', 'rollup', 'rolldown', 'esbuild', 'webpack', 'rspack', 'farm'] as const) {
      expect(typeof instance[adapter]).toBe('function')
    }
    const plugin = instance.rollup()
    expect(plugin).toMatchObject({ name: '@trast/unplugin' })
  })
})
