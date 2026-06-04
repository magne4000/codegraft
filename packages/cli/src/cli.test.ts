import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, rm, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { main } from './cli.js'

const IF_ELSE = 'if ($$.flags.auth) { a() } else { b() }'
const cliDir = fileURLToPath(new URL('..', import.meta.url))
const fixture = join(cliDir, 'test', 'fixtures', 'bati-rules.ts')
const distDir = join(cliDir, '.tmp', 'cli-dist')

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  )

beforeAll(async () => {
  await rm(distDir, { recursive: true, force: true })
  await mkdir(distDir, { recursive: true })
})
afterAll(async () => {
  await rm(distDir, { recursive: true, force: true })
})

describe('cli main', () => {
  it('build writes the emitted modules to --output', async () => {
    await main(['build', fixture, '--output', distDir], cliDir)
    expect(await exists(join(distDir, 'tsx.js'))).toBe(true)
    expect(await exists(join(distDir, 'index.js'))).toBe(true)
  })

  it('run --in-place --context applies the compiled transformer', async () => {
    const work = await mkdtemp(join(tmpdir(), 'trast-cli-'))
    await writeFile(join(work, 'page.tsx'), IF_ELSE)
    await main(
      ['run', '*.tsx', '--transformer', join(distDir, 'index.js'), '--context', '{"flags":{"auth":true}}', '--in-place'],
      work,
    )
    expect(await readFile(join(work, 'page.tsx'), 'utf8')).toBe('a()')
  })

  it('run defaults to dry-run (writes nothing)', async () => {
    const work = await mkdtemp(join(tmpdir(), 'trast-cli-'))
    await writeFile(join(work, 'page.tsx'), IF_ELSE)
    await main(
      ['run', '*.tsx', '--transformer', join(distDir, 'index.js'), '--context', '{"flags":{"auth":true}}'],
      work,
    )
    expect(await readFile(join(work, 'page.tsx'), 'utf8')).toBe(IF_ELSE) // untouched
  })

  it('rejects an unknown command and missing required args', async () => {
    await expect(main(['frobnicate'], cliDir)).rejects.toThrow(/unknown command/)
    await expect(main(['run', '*.tsx'], cliDir)).rejects.toThrow(/--transformer/)
    await expect(main(['build'], cliDir)).rejects.toThrow(/rules-file/)
  })

  it('rejects more than one run mode', async () => {
    await expect(
      main(['run', '*.tsx', '--transformer', join(distDir, 'index.js'), '--in-place', '--dry-run'], cliDir),
    ).rejects.toThrow(/at most one/)
  })
})
