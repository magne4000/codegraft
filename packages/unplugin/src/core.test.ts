import { describe, it, expect } from 'vitest'
import { defineCodemod } from '@trast/codemod'
import { vueSplitter } from '@trast/vue'
import { makeUnpluginOptions } from './core.js'
import { trast } from './index.js'

const IF_ELSE = 'if ($$.BATI.has("auth")) { a() } else { b() }'
type Ctx = { BATI: { has(feature: string): boolean } }
const bati = (...features: string[]): Ctx => ({ BATI: { has: (f) => features.includes(f) } })

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

// A codemod is language-agnostic (it walks `if_statement` directly), so one instance serves
// every target the plugin picks per extension.
const codemod = defineCodemod<Ctx>({ namespace: '$$' }, (root, ctx) => {
  root.find('if_statement').forEach((node) => {
    const cond = node.field('condition')
    if (!cond.text.includes('$$')) return
    if (cond.evaluate(ctx)) node.unwrap(node.field('consequence').children())
    else node.unwrap(node.field('alternative').find('statement_block').first().children())
  })
})

describe('makeUnpluginOptions', () => {
  it('transforms handled extensions (stripping a query suffix); skips unhandled ones', async () => {
    const opts = makeUnpluginOptions({ codemod, context: bati('auth') })
    expect((await callTransform(opts, IF_ELSE, '/app/Page.tsx'))?.code).toBe('a()')
    expect((await callTransform(opts, IF_ELSE, '/app/main.ts?v=1'))?.code).toBe('a()') // query stripped
    expect(await callTransform(opts, 'whatever', '/app/readme.md')).toBeNull() // unhandled extension
  })

  it('threads the build context into the transform', async () => {
    const disabled = makeUnpluginOptions({ codemod, context: bati() })
    expect((await callTransform(disabled, IF_ELSE, '/app/Page.tsx'))?.code).toBe('b()')
  })

  it('returns a source map alongside transformed code', async () => {
    const opts = makeUnpluginOptions({ codemod, context: bati('auth') })
    const result = await callTransform(opts, IF_ELSE, '/app/Page.tsx')
    expect(result?.map?.version).toBe(3)
    expect(result?.map?.sources).toContain('/app/Page.tsx')
  })

  it('returns null when a handled file is left unchanged', async () => {
    const opts = makeUnpluginOptions({ codemod, context: bati() })
    expect(await callTransform(opts, 'const x = 1', '/app/Page.tsx')).toBeNull()
  })

  it('handles a multi-zone format via a splitter (vue); skips .vue without one', async () => {
    const sfc = '<script setup lang="ts">\nif ($$.BATI.has("auth")) { a() } else { b() }\n</script>\n'

    const withVue = makeUnpluginOptions({ codemod, context: bati('auth'), splitters: [vueSplitter] })
    const result = await callTransform(withVue, sfc, '/app/App.vue')
    expect(result?.code).toContain('a()')
    expect(result?.code).not.toContain('BATI.has')

    const noVue = makeUnpluginOptions({ codemod, context: bati() })
    expect(await callTransform(noVue, sfc, '/app/App.vue')).toBeNull()
  })

  it('wires include/exclude into the native transform filter', () => {
    const opts = makeUnpluginOptions({
      codemod,
      context: bati(),
      include: ['**/keep/**'],
      exclude: ['**/skip/**'],
    })
    expect(hook(opts).filter?.id).toEqual({ include: ['**/keep/**'], exclude: ['**/skip/**'] })
  })
})

describe('trast adapters', () => {
  it('exposes every bundler adapter and produces a named plugin', () => {
    const instance = trast({ codemod, context: bati() })
    for (const adapter of ['vite', 'rollup', 'rolldown', 'esbuild', 'webpack', 'rspack', 'farm'] as const) {
      expect(typeof instance[adapter]).toBe('function')
    }
    expect(instance.rollup()).toMatchObject({ name: '@trast/unplugin' })
  })
})
