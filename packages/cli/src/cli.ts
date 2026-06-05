#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assert } from '@trast/core/internal'
import { build } from './build.js'
import { run, type RunMode } from './run.js'

const USAGE = `usage:
  trast build <codemod-file> --output <dir>
  trast run <glob...> --transformer <dist/index.js> [--context <json>] [--dry-run | --in-place | --out-dir <dir>]`

/** Dispatch a `trast` invocation. Exported (with an injectable `cwd`) so it is testable
 *  without spawning a process; the bin auto-runs it only when invoked directly. */
export async function main(argv: string[], cwd: string = process.cwd()): Promise<void> {
  const [command, ...rest] = argv
  if (command === 'build') return cmdBuild(rest, cwd)
  if (command === 'run') return cmdRun(rest, cwd)
  throw new Error(`unknown command '${command ?? ''}'\n${USAGE}`)
}

async function cmdBuild(args: string[], cwd: string): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { output: { type: 'string', short: 'o' } },
  })
  const [codemodFile] = positionals
  assert(codemodFile, `trast build: missing <codemod-file>\n${USAGE}`)
  const outputDir = resolve(cwd, values.output ?? 'dist')

  const result = await build(resolve(cwd, codemodFile), outputDir)
  process.stdout.write(`trast build: wrote ${result.files.join(', ')} to ${outputDir}\n`)
  if (result.grammarPackages.length > 0) {
    process.stdout.write(`trast build: targets require ${result.grammarPackages.join(', ')}\n`)
  }
}

async function cmdRun(args: string[], cwd: string): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      transformer: { type: 'string', short: 't' },
      context: { type: 'string', short: 'c' },
      'dry-run': { type: 'boolean' },
      'in-place': { type: 'boolean' },
      'out-dir': { type: 'string' },
    },
  })
  assert(positionals.length > 0, `trast run: missing <glob>\n${USAGE}`)
  assert(values.transformer, `trast run: missing --transformer <dist/index.js>\n${USAGE}`)

  const modes = [values['dry-run'], values['in-place'], values['out-dir'] !== undefined].filter(Boolean)
  assert(modes.length <= 1, 'trast run: choose at most one of --dry-run, --in-place, --out-dir')
  const mode: RunMode = values['in-place']
    ? { kind: 'in-place' }
    : values['out-dir'] !== undefined
      ? { kind: 'out-dir', dir: resolve(cwd, values['out-dir']) }
      : { kind: 'dry-run' } // safe default: never mutate without an explicit flag

  const result = await run({
    patterns: positionals,
    cwd,
    transformerPath: resolve(cwd, values.transformer),
    context: values.context ? (JSON.parse(values.context) as Record<string, unknown>) : {},
    mode,
  })
  process.stdout.write(
    `trast run: ${result.transformed.length} transformed, ${result.unchanged.length} unchanged, ${result.skipped.length} skipped\n`,
  )
}

// Auto-run only when this file is the process entry point (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
