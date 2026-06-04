import { glob, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LazyTransformer, Transformer } from '@trast/core'

/** The named exports of a compiled transformer barrel (`dist/index.js`): a lazy
 *  transformer per target stem (`tsx`, `typescript`, `vue`, …). */
type TransformerMap = Record<string, LazyTransformer>

/** File extension (no dot) → the barrel export stem that handles it. */
const EXTENSION_TARGET: Record<string, string> = {
  tsx: 'tsx',
  jsx: 'tsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'vue',
  html: 'html',
  htm: 'html',
  css: 'css',
}

export type RunMode =
  | { kind: 'dry-run' } // report changes, write nothing
  | { kind: 'in-place' } // overwrite the input files
  | { kind: 'out-dir'; dir: string } // write under a mirror directory

export interface RunResult {
  /** Files whose output differs from their input (written, unless dry-run). */
  transformed: string[]
  /** Files a transformer ran on but left unchanged. */
  unchanged: string[]
  /** Files with no transformer for their extension. */
  skipped: string[]
}

/**
 * Apply transformers to a fixed list of files (relative to `cwd`). The pure core of
 * `trast run` — no globbing or module loading, so it is directly testable. Each file's
 * extension selects a transformer (lazily `init`-ed once); files with no matching
 * transformer are skipped.
 */
export async function runFiles(opts: {
  files: string[]
  cwd: string
  transformers: TransformerMap
  context: Record<string, unknown>
  mode: RunMode
}): Promise<RunResult> {
  const ready = new Map<string, Transformer>()
  const result: RunResult = { transformed: [], unchanged: [], skipped: [] }

  for (const file of opts.files) {
    const stem = EXTENSION_TARGET[extname(file).slice(1)]
    const lazy = stem ? opts.transformers[stem] : undefined
    if (!lazy) {
      result.skipped.push(file)
      continue
    }
    let transformer = ready.get(stem)
    if (!transformer) {
      transformer = await lazy.init()
      ready.set(stem, transformer)
    }

    const absolute = join(opts.cwd, file)
    const source = await readFile(absolute, 'utf8')
    const output = transformer.transform(source, opts.context)
    if (output === source) {
      result.unchanged.push(file)
      continue
    }
    result.transformed.push(file)
    await writeOutput(opts.mode, file, absolute, output)
  }
  return result
}

async function writeOutput(mode: RunMode, file: string, absolute: string, output: string): Promise<void> {
  if (mode.kind === 'dry-run') return
  if (mode.kind === 'in-place') {
    await writeFile(absolute, output)
    return
  }
  const dest = join(mode.dir, file)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, output)
}

/**
 * `trast run`: resolve globs, load the compiled transformer barrel, and apply it.
 * Thin wrapper over {@link runFiles} that adds the I/O the CLI needs.
 */
export async function run(opts: {
  patterns: string[]
  cwd: string
  transformerPath: string
  context: Record<string, unknown>
  mode: RunMode
}): Promise<RunResult> {
  const transformers = (await import(pathToFileURL(opts.transformerPath).href)) as TransformerMap
  const files: string[] = []
  for await (const match of glob(opts.patterns, { cwd: opts.cwd })) files.push(match)
  return runFiles({ files, cwd: opts.cwd, transformers, context: opts.context, mode: opts.mode })
}
