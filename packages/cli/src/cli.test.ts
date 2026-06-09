import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { main } from './cli.js'

const IF_ELSE = 'if ($$.flags.auth) { a() } else { b() }'
const cliDir = fileURLToPath(new URL('..', import.meta.url))
const codemod = join(cliDir, 'test', 'fixtures', 'bati-codemod.ts')

describe('cli main', () => {
  it('run --in-place --context applies the codemod live', async () => {
    const work = await mkdtemp(join(tmpdir(), 'codegraft-cli-'))
    await writeFile(join(work, 'page.tsx'), IF_ELSE)
    await main(['run', '*.tsx', '--codemod', codemod, '--context', '{"flags":{"auth":true}}', '--in-place'], work)
    expect(await readFile(join(work, 'page.tsx'), 'utf8')).toBe('a()')
  })

  it('run defaults to dry-run (writes nothing)', async () => {
    const work = await mkdtemp(join(tmpdir(), 'codegraft-cli-'))
    await writeFile(join(work, 'page.tsx'), IF_ELSE)
    await main(['run', '*.tsx', '--codemod', codemod, '--context', '{"flags":{"auth":true}}'], work)
    expect(await readFile(join(work, 'page.tsx'), 'utf8')).toBe(IF_ELSE) // untouched
  })

  it('rejects an unknown command and missing required args', async () => {
    await expect(main(['frobnicate'], cliDir)).rejects.toThrow(/unknown command/)
    await expect(main(['run', '*.tsx'], cliDir)).rejects.toThrow(/--codemod/)
    await expect(main(['run', '--codemod', codemod], cliDir)).rejects.toThrow(/missing <glob>/)
  })

  it('rejects more than one run mode', async () => {
    await expect(
      main(['run', '*.tsx', '--codemod', codemod, '--in-place', '--dry-run'], cliDir),
    ).rejects.toThrow(/at most one/)
  })
})
