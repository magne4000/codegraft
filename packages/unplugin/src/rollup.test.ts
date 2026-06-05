import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rollup } from 'rollup'
import { defineCodemod } from '@codegraft/codemod'
import codegraftRollup from './rollup.js'

// A real-bundler smoke test: run the plugin through rollup end to end (the unit tests
// call the transform hook directly). Plain JS so rollup's parser handles input + output.
describe('rollup integration', () => {
  it('applies the transform during bundling and emits a source map', async () => {
    const codemod = defineCodemod<{ BATI: { has(f: string): boolean } }>({ namespace: '$$' }, (root, ctx) => {
      root.find('if_statement').forEach((node) => {
        const cond = node.field('condition')
        if (!cond.text.includes('$$')) return
        if (cond.evaluate(ctx)) node.unwrap(node.field('consequence').children())
        else node.unwrap(node.field('alternative').find('statement_block').first().children())
      })
    })

    const dir = await mkdtemp(join(tmpdir(), 'codegraft-rollup-'))
    const entry = join(dir, 'entry.js')
    await writeFile(entry, 'export function f() {\n  if ($$.BATI.has("auth")) { return "dash" } else { return "land" }\n}\n')

    const bundle = await rollup({
      input: entry,
      plugins: [codegraftRollup({ codemod, context: { BATI: { has: (f) => f === 'auth' } } })],
    })
    const { output } = await bundle.generate({ format: 'es', sourcemap: true })
    await bundle.close()
    await rm(dir, { recursive: true, force: true })

    const chunk = output[0]
    expect(chunk.type).toBe('chunk')
    if (chunk.type !== 'chunk') return
    expect(chunk.code).toContain('"dash"')
    expect(chunk.code).not.toContain('"land"')
    expect(chunk.code).not.toContain('$$')
    expect(chunk.map?.version).toBe(3)
  })
})
