#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assert } from '@codegraft/core/internal'
import { run, type RunMode } from './run.js'

const USAGE = `usage:
  codegraft run <glob...> --codemod <codemod-file> [--context <json>] [--format] [--dry-run | --in-place | --out-dir <dir>]`

/** Dispatch a `codegraft` invocation. Exported (with an injectable `cwd`) so it is testable
 *  without spawning a process; the bin auto-runs it only when invoked directly. */
export async function main(argv: string[], cwd: string = process.cwd()): Promise<void> {
  const [command, ...rest] = argv
  if (command === 'run') return cmdRun(rest, cwd)
  throw new Error(`unknown command '${command ?? ''}'\n${USAGE}`)
}

async function cmdRun(args: string[], cwd: string): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      codemod: { type: 'string', short: 'c' },
      context: { type: 'string' },
      format: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'in-place': { type: 'boolean' },
      'out-dir': { type: 'string' },
    },
  })
  assert(positionals.length > 0, `codegraft run: missing <glob>\n${USAGE}`)
  assert(values.codemod, `codegraft run: missing --codemod <codemod-file>\n${USAGE}`)

  const modes = [values['dry-run'], values['in-place'], values['out-dir'] !== undefined].filter(Boolean)
  assert(modes.length <= 1, 'codegraft run: choose at most one of --dry-run, --in-place, --out-dir')
  const mode: RunMode = values['in-place']
    ? { kind: 'in-place' }
    : values['out-dir'] !== undefined
      ? { kind: 'out-dir', dir: resolve(cwd, values['out-dir']) }
      : { kind: 'dry-run' } // safe default: never mutate without an explicit flag

  const result = await run({
    patterns: positionals,
    cwd,
    codemodPath: resolveCodemod(values.codemod, cwd),
    context: values.context ? (JSON.parse(values.context) as Record<string, unknown>) : {},
    mode,
    format: values.format,
  })
  process.stdout.write(
    `codegraft run: ${result.transformed.length} transformed, ${result.unchanged.length} unchanged, ${result.skipped.length} skipped\n`,
  )
}

/** A `--codemod` value is a path (`./rule.ts`, absolute) resolved against `cwd`, or a package
 *  specifier (`@codegraft/rules/remove-unused-imports`) resolved from `cwd`'s node_modules. */
function resolveCodemod(value: string, cwd: string): string {
  if (value.startsWith('.') || isAbsolute(value)) return resolve(cwd, value)
  return fileURLToPath(import.meta.resolve(value, pathToFileURL(join(cwd, '_.js')).href))
}

// Auto-run only when this file is the process entry point (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
