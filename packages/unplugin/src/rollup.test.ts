import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rollup } from 'rollup'
import type { RichNode } from '@trast/core'
import { defineRules } from '@trast/match'
import trastRollup from './rollup.js'

// A real-bundler smoke test: run the plugin through rollup end to end (the unit tests
// call the transform hook directly). Plain JS so rollup's parser handles input + output.
describe('rollup integration', () => {
  it('applies the transform during bundling and emits a source map', async () => {
    const rules = defineRules<{ features: string[] }>((match) => [
      match.js.expr`if (BATI.has($f)) { $$$then } else { $$$otherwise }`.rewrite(
        ({ f, then, otherwise }, ctx) =>
          ctx.features.includes((f as RichNode).text.slice(1, -1))
            ? (then as RichNode[])
            : (otherwise as RichNode[]),
      ),
    ])

    const dir = await mkdtemp(join(tmpdir(), 'trast-rollup-'))
    const entry = join(dir, 'entry.js')
    await writeFile(entry, 'export function f() {\n  if (BATI.has("auth")) { return "dash" } else { return "land" }\n}\n')

    const bundle = await rollup({
      input: entry,
      plugins: [trastRollup({ rules, context: { features: ['auth'] } })],
    })
    const { output } = await bundle.generate({ format: 'es', sourcemap: true })
    await bundle.close()
    await rm(dir, { recursive: true, force: true })

    const chunk = output[0]
    expect(chunk.type).toBe('chunk')
    if (chunk.type !== 'chunk') return
    expect(chunk.code).toContain('"dash"')
    expect(chunk.code).not.toContain('"land"')
    expect(chunk.code).not.toContain('BATI.has')
    expect(chunk.map?.version).toBe(3)
  })
})
