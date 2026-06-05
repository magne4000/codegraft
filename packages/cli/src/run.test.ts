import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCodemodTransformer, type LazyTransformer } from '@trast/core'
import { defineCodemod } from '@trast/codemod'
import { build } from './build.js'
import { runFiles, run } from './run.js'

const IF_ELSE = 'if ($$.flags.auth) { a() } else { b() }'
const cliDir = fileURLToPath(new URL('..', import.meta.url))

function tsxTransformers(): Record<string, LazyTransformer> {
  const codemod = defineCodemod<{ flags: Record<string, boolean> }>({ namespace: '$$' }, (root, ctx) => {
    root.find('if_statement').forEach((node) => {
      const cond = node.field('condition')
      if (!cond.text.includes('$$')) return
      if (cond.evaluate(ctx)) node.unwrap(node.field('consequence').children())
      else node.unwrap(node.field('alternative').find('statement_block').first().children())
    })
  })
  return { tsx: createCodemodTransformer('tsx', codemod.fn, { namespace: codemod.namespace }) }
}

async function workdir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'trast-run-'))
  await writeFile(join(dir, 'a.tsx'), IF_ELSE)
  await writeFile(join(dir, 'b.css'), 'a { color: red }')
  return dir
}

describe('runFiles', () => {
  let transformers: Record<string, LazyTransformer>
  beforeAll(() => {
    transformers = tsxTransformers()
  })

  it('dry-run reports changes but writes nothing; unmatched extensions are skipped', async () => {
    const dir = await workdir()
    const result = await runFiles({
      files: ['a.tsx', 'b.css'],
      cwd: dir,
      transformers,
      context: { flags: { auth: true } },
      mode: { kind: 'dry-run' },
    })
    expect(result.transformed).toEqual(['a.tsx'])
    expect(result.skipped).toEqual(['b.css'])
    expect(await readFile(join(dir, 'a.tsx'), 'utf8')).toBe(IF_ELSE) // untouched
  })

  it('in-place rewrites the file, threading context through', async () => {
    const enabled = await workdir()
    await runFiles({
      files: ['a.tsx'],
      cwd: enabled,
      transformers,
      context: { flags: { auth: true } },
      mode: { kind: 'in-place' },
    })
    expect(await readFile(join(enabled, 'a.tsx'), 'utf8')).toBe('a()')

    const disabled = await workdir()
    await runFiles({
      files: ['a.tsx'],
      cwd: disabled,
      transformers,
      context: { flags: {} },
      mode: { kind: 'in-place' },
    })
    expect(await readFile(join(disabled, 'a.tsx'), 'utf8')).toBe('b()')
  })

  it('out-dir writes the result under a mirror dir, leaving the input untouched', async () => {
    const dir = await workdir()
    const out = join(dir, 'out')
    await runFiles({
      files: ['a.tsx'],
      cwd: dir,
      transformers,
      context: { flags: { auth: true } },
      mode: { kind: 'out-dir', dir: out },
    })
    expect(await readFile(join(out, 'a.tsx'), 'utf8')).toBe('a()')
    expect(await readFile(join(dir, 'a.tsx'), 'utf8')).toBe(IF_ELSE) // input untouched
  })
})

describe('run (glob + load)', () => {
  const distDir = join(cliDir, '.tmp', 'run-dist')
  beforeAll(async () => {
    await rm(distDir, { recursive: true, force: true })
    await mkdir(distDir, { recursive: true })
    await build(join(cliDir, 'test', 'fixtures', 'bati-codemod.ts'), distDir)
  })
  afterAll(async () => {
    await rm(distDir, { recursive: true, force: true })
  })

  it('globs files, loads the compiled barrel, and applies it in place', async () => {
    const work = await mkdtemp(join(tmpdir(), 'trast-run-glob-'))
    await writeFile(join(work, 'page.tsx'), IF_ELSE)
    const result = await run({
      patterns: ['*.tsx'],
      cwd: work,
      transformerPath: join(distDir, 'index.js'),
      context: { flags: { auth: true } },
      mode: { kind: 'in-place' },
    })
    expect(result.transformed).toEqual(['page.tsx'])
    expect(await readFile(join(work, 'page.tsx'), 'utf8')).toBe('a()')
  })
})
