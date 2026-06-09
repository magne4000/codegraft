import { glob, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { GrammarId, LazyTransformer, Transformer, ZoneSplitter } from '@codegraft/core'
import { assert, EXTENSION_GRAMMAR } from '@codegraft/core/internal'

type Target = GrammarId | ZoneSplitter
type TransformerMap = Record<string, LazyTransformer>

// File extension → target stem: the shared grammar map plus SFC splitter stems.
const EXTENSION_TARGET: Record<string, string> = { ...EXTENSION_GRAMMAR, vue: 'vue' }

/** What `codegraft run` needs from a codemod module: its `forTarget` (taken structurally, so the cli
 *  needn't depend on `@codegraft/codemod`) and the `targets` it declares. */
interface CodemodModule {
  default: { forTarget(target: Target): Promise<Transformer> }
  targets: Target[]
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
 * `codegraft run` — no globbing or module loading, so it is directly testable. Each file's
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
 * `codegraft run`: load a codemod, resolve globs, and apply it. The codemod runs **live** — each
 * declared target becomes a lazy transformer via `forTarget`, so the codemod's helpers, imports,
 * and deps work as written, with no build/compile step.
 */
export async function run(opts: {
  patterns: string[]
  cwd: string
  codemodPath: string
  context: Record<string, unknown>
  mode: RunMode
}): Promise<RunResult> {
  const mod = (await import(pathToFileURL(opts.codemodPath).href)) as Partial<CodemodModule>
  const codemod = mod.default
  assert(codemod && typeof codemod.forTarget === 'function', `codemod '${opts.codemodPath}' must default-export a defineCodemod result`)
  assert(Array.isArray(mod.targets), `codemod '${opts.codemodPath}' must export a 'targets' array`)

  const transformers: TransformerMap = {}
  for (const target of mod.targets) {
    const stem = typeof target === 'string' ? target : target.id
    transformers[stem] = { target, init: () => codemod.forTarget(target) }
  }

  const files: string[] = []
  for await (const match of glob(opts.patterns, { cwd: opts.cwd })) files.push(match)
  return runFiles({ files, cwd: opts.cwd, transformers, context: opts.context, mode: opts.mode })
}
