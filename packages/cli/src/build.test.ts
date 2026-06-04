import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { remove, type RichNode } from '@trast/core'
import { defineRules } from '@trast/match'
import { build, buildRules } from './build.js'

const cliDir = fileURLToPath(new URL('..', import.meta.url))
const fixture = join(cliDir, 'test', 'fixtures', 'bati-rules.ts')
// Write output inside the package (gitignored) so vitest resolves the emitted
// module's `@trast/core` import via the workspace alias.
const outDir = join(cliDir, '.tmp', 'build')

beforeEach(async () => {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
})
afterAll(async () => {
  await rm(join(cliDir, '.tmp'), { recursive: true, force: true })
})

describe('buildRules', () => {
  it('emits a per-target module, a barrel, and package.json', async () => {
    const ruleSet = defineRules((match) => [
      match.tsx.node('debugger_statement').rewrite(() => remove),
    ])
    const result = await buildRules(ruleSet, ['tsx'], outDir)
    expect(result.files).toEqual(['tsx.js', 'index.js', 'package.json'])

    const tsx = await readFile(join(outDir, 'tsx.js'), 'utf8')
    expect(tsx).toContain("from '@trast/core'")
    expect(tsx).not.toContain('@trast/match') // compiled output never imports the builder
    expect(tsx).not.toContain('@trast/vue')

    const barrel = await readFile(join(outDir, 'index.js'), 'utf8')
    expect(barrel).toContain("export { transform as tsx } from './tsx.js'")

    const pkg = JSON.parse(await readFile(join(outDir, 'package.json'), 'utf8'))
    expect(pkg.sideEffects).toBe(false)
  })

  it('reports the grammar packages the targets require', async () => {
    const { grammarPackages } = await buildRules(defineRules(() => []), ['tsx', 'css'], outDir)
    expect(grammarPackages).toEqual(['tree-sitter-css', 'tree-sitter-typescript'])
  })
})

describe('build (parity with dev mode)', () => {
  it('emits a transformer that matches dev-mode output for the same inputs', async () => {
    const result = await build(fixture, outDir)
    expect(result.files).toContain('tsx.js')

    const emitted = await import(pathToFileURL(join(outDir, 'tsx.js')).href)
    const compiled = await emitted.transform.init()

    const dev = await (await import(pathToFileURL(fixture).href)).default.forTarget('tsx')

    const src = 'if (BATI.has("auth")) { a() } else { b() }'
    for (const features of [['auth'], [] as string[]]) {
      const ctx = { features }
      expect(compiled.transform(src, ctx)).toBe(dev.transform(src, ctx))
    }
    expect(compiled.transform(src, { features: ['auth'] })).toBe('a()')
    expect(compiled.transform(src, { features: [] })).toBe('b()')
  })
})
