import { describe, it, expect, beforeAll } from 'vitest'
import type { RichNode } from '@trast/core'
import { defineRules, type RuleSetBuilder } from '@trast/match'
import { vueSplitter } from '@trast/vue'
import { makeUnpluginOptions } from './core.js'
import { trast } from './index.js'

const IF_ELSE = 'if (BATI.has("auth")) { a() } else { b() }'

// `transform` is an object hook { filter, handler }; the handler's build-context `this`
// is unused, so a cast suffices for direct testing.
type Handler = (code: string, id: string) => Promise<{ code: string; map?: { version: number; sources: string[] } } | null>
interface TransformHook {
  filter?: { id?: { include?: unknown; exclude?: unknown } }
  handler: Handler
}
const hook = (opts: ReturnType<typeof makeUnpluginOptions>) => opts.transform as unknown as TransformHook
const callTransform = (opts: ReturnType<typeof makeUnpluginOptions>, code: string, id: string) =>
  hook(opts).handler(code, id)

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
  it('transforms handled extensions (stripping a query suffix); skips unhandled ones', async () => {
    const opts = makeUnpluginOptions({ rules, context: { features: ['auth'] } })
    expect((await callTransform(opts, IF_ELSE, '/app/Page.tsx'))?.code).toBe('a()')
    expect((await callTransform(opts, IF_ELSE, '/app/main.ts?v=1'))?.code).toBe('a()') // query stripped
    expect(await callTransform(opts, 'whatever', '/app/readme.md')).toBeNull() // unhandled extension
  })

  it('threads the build context into the transform', async () => {
    const disabled = makeUnpluginOptions({ rules, context: { features: [] } })
    expect((await callTransform(disabled, IF_ELSE, '/app/Page.tsx'))?.code).toBe('b()')
  })

  it('returns a source map alongside transformed code', async () => {
    const opts = makeUnpluginOptions({ rules, context: { features: ['auth'] } })
    const result = await callTransform(opts, IF_ELSE, '/app/Page.tsx')
    expect(result?.map?.version).toBe(3)
    expect(result?.map?.sources).toContain('/app/Page.tsx')
  })

  it('returns null when a handled file is left unchanged', async () => {
    const opts = makeUnpluginOptions({ rules, context: { features: [] } })
    expect(await callTransform(opts, 'const x = 1', '/app/Page.tsx')).toBeNull()
  })

  it('handles a multi-zone format via a splitter (vue); skips .vue without one', async () => {
    const sfc = '<script setup lang="ts">\nif (BATI.has("auth")) { a() } else { b() }\n</script>\n'

    const withVue = makeUnpluginOptions({ rules, context: { features: ['auth'] }, splitters: [vueSplitter] })
    const result = await callTransform(withVue, sfc, '/app/App.vue')
    expect(result?.code).toContain('a()')
    expect(result?.code).not.toContain('BATI.has')

    const noVue = makeUnpluginOptions({ rules, context: { features: [] } })
    expect(await callTransform(noVue, sfc, '/app/App.vue')).toBeNull()
  })

  it('wires include/exclude into the native transform filter', () => {
    const opts = makeUnpluginOptions({
      rules,
      context: { features: [] },
      include: ['**/keep/**'],
      exclude: ['**/skip/**'],
    })
    expect(hook(opts).filter?.id).toEqual({ include: ['**/keep/**'], exclude: ['**/skip/**'] })
  })
})

describe('trast adapters', () => {
  it('exposes every bundler adapter and produces a named plugin', () => {
    const instance = trast({ rules, context: { features: [] } })
    for (const adapter of ['vite', 'rollup', 'rolldown', 'esbuild', 'webpack', 'rspack', 'farm'] as const) {
      expect(typeof instance[adapter]).toBe('function')
    }
    expect(instance.rollup()).toMatchObject({ name: '@trast/unplugin' })
  })
})
