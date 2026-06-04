import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rollup } from 'rollup'
import { evaluate, type RichNode } from '@trast/core'
import { defineRules } from '@trast/match'
import trastRollup from './rollup.js'

// A real-bundler smoke test: run the plugin through rollup end to end (the unit tests
// call the transform hook directly). Plain JS so rollup's parser handles input + output.
describe('rollup integration', () => {
  it('applies the transform during bundling and emits a source map', async () => {
    const rules = defineRules<{ BATI: { has(f: string): boolean } }>({ namespace: '$$' }, (match) => [
      match.js.expr`if ($cond) { $$$then } else { $$$otherwise }`
        .where(({ cond }) => (cond as RichNode).text.includes('$$'))
        .rewrite(({ cond, then, otherwise }, ctx) =>
          evaluate(cond as RichNode, ctx) ? (then as RichNode[]) : (otherwise as RichNode[]),
        ),
    ])

    const dir = await mkdtemp(join(tmpdir(), 'trast-rollup-'))
    const entry = join(dir, 'entry.js')
    await writeFile(entry, 'export function f() {\n  if ($$.BATI.has("auth")) { return "dash" } else { return "land" }\n}\n')

    const bundle = await rollup({
      input: entry,
      plugins: [trastRollup({ rules, context: { BATI: { has: (f) => f === 'auth' } } })],
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
