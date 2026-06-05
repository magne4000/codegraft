import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { defineCodemod } from '@codegraft/codemod'
import { buildCodemod } from './build.js'

const cliDir = fileURLToPath(new URL('..', import.meta.url))
// Output inside the package (gitignored) so the emitted module resolves @codegraft/core via the workspace.
const outDir = join(cliDir, '.tmp', 'codemod-build')

beforeEach(async () => {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
})
afterAll(async () => {
  await rm(outDir, { recursive: true, force: true })
})

describe('buildCodemod (compiled-mode parity)', () => {
  it('emits a transformer matching interpreted output — the param-rooted body serialises', async () => {
    const codemod = defineCodemod<Record<string, boolean>>({ namespace: '$$' }, (root, ctx) => {
      root.find('if_statement').forEach((node) => {
        const cond = node.field('condition')
        if (!cond.text.includes('$$')) return
        if (cond.evaluate(ctx)) node.unwrap(node.field('consequence').children())
        else node.remove()
      })
      root.find('call_expression', { function: 'foo' }).replaceWith('bar()')
    })

    const result = await buildCodemod(codemod, ['tsx'], outDir)
    expect(result.files).toContain('tsx.js')

    const emitted = await import(pathToFileURL(join(outDir, 'tsx.js')).href)
    const compiled = await emitted.transform.init()
    const dev = await codemod.forTarget('tsx')

    const src = 'if ($$.on) {\n  foo()\n}'
    for (const ctx of [{ on: true }, { on: false }]) {
      expect(compiled.transform(src, ctx)).toBe(dev.transform(src, ctx))
    }
    expect(compiled.transform(src, { on: true })).toBe('bar()')
    expect(compiled.transform(src, { on: false })).toBe('')
  })

  it('serialises the functional mutation surface (callbacks/wrap)', async () => {
    const codemod = defineCodemod((root) => {
      root.find('number').replaceWith((n) => String(Number(n.text) + 1))
      root.find('call_expression').wrap('(', ')')
      root.find('identifier', { text: 'x' }).replaceWith((id) => id.text.toUpperCase())
    })
    // A distinct dir per importing test: Node's ESM loader caches by URL, so reusing tsx.js
    // would return the prior test's module.
    const mutDir = join(outDir, 'mut')
    await buildCodemod(codemod, ['tsx'], mutDir)
    const compiled = await (await import(pathToFileURL(join(mutDir, 'tsx.js')).href)).transform.init()
    const dev = await codemod.forTarget('tsx')

    const src = 'const x = 1\nfoo()'
    expect(compiled.transform(src, {})).toBe(dev.transform(src, {}))
    expect(compiled.transform(src, {})).toBe('const X = 2\n(foo())')
  })

  it('serialises the code builder (validation runs in the emitted module)', async () => {
    const codemod = defineCodemod((root) => {
      const arr = root.find('array').first()
      arr.append(arr.code`vue()`)
    })
    const codeDir = join(outDir, 'code')
    await buildCodemod(codemod, ['tsx'], codeDir)
    const compiled = await (await import(pathToFileURL(join(codeDir, 'tsx.js')).href)).transform.init()
    const dev = await codemod.forTarget('tsx')

    const src = 'const x = [react()]'
    expect(compiled.transform(src, {})).toBe(dev.transform(src, {}))
    expect(compiled.transform(src, {})).toBe('const x = [react(), vue()]')
  })

  it('emitted module imports only @codegraft/core', async () => {
    const codemod = defineCodemod((root) => root.find('identifier', { text: 'a' }).replaceWith('b'))
    await buildCodemod(codemod, ['tsx'], outDir)
    const tsx = await readFile(join(outDir, 'tsx.js'), 'utf8')
    expect(tsx).toContain('createCodemodTransformer')
    expect(tsx).toContain("from '@codegraft/core'")
    expect(tsx).not.toContain('@codegraft/codemod') // the authoring package never ships to consumers
  })
})
