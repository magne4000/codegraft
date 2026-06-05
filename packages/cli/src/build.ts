import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { GrammarId, ZoneSplitter } from '@trast/core'
import { assert, grammarPackage } from '@trast/core/internal'
import type { Codemod } from '@trast/codemod'
import { serialiseCodemod } from './serialise.js'

type Target = GrammarId | ZoneSplitter

export interface BuildResult {
  /** File names written under the output dir. */
  files: string[]
  /** The grammar packages the chosen targets require — the optional peers the
   *  shipping tool must add to its own dependencies. */
  grammarPackages: string[]
}

/** The `default` export (a `defineCodemod` result) and `targets` a codemod file must provide. */
interface CodemodModule {
  default: Codemod
  targets: Target[]
}

const isCodemod = (x: unknown): x is Codemod => typeof (x as Codemod | undefined)?.fn === 'function'

/**
 * `trast build`: import a codemod file and emit one transformer module per declared target,
 * a barrel, and a `package.json`. The file must be importable by the running Node (compile TS
 * first, or run under a loader).
 */
export async function build(codemodFile: string, outputDir: string): Promise<BuildResult> {
  const mod = (await import(pathToFileURL(codemodFile).href)) as Partial<CodemodModule>
  assert(isCodemod(mod.default), `codemod file '${codemodFile}' must default-export a defineCodemod result`)
  assert(Array.isArray(mod.targets), `codemod file '${codemodFile}' must export a 'targets' array`)
  return buildCodemod(mod.default, mod.targets, outputDir)
}

/** Emit one transformer module per target, a barrel, and a `package.json` for a loaded codemod. */
export async function buildCodemod(codemod: Codemod, targets: Target[], outputDir: string): Promise<BuildResult> {
  await mkdir(outputDir, { recursive: true })
  const body = codemod.fn.toString()

  const stems: string[] = []
  for (const target of targets) {
    const stem = typeof target === 'string' ? target : target.id
    await writeFile(join(outputDir, `${stem}.js`), serialiseCodemod(target, body, codemod.namespace))
    stems.push(stem)
  }

  const barrel = stems.map((stem) => `export { transform as ${stem} } from './${stem}.js'`).join('\n')
  await writeFile(join(outputDir, 'index.js'), `${barrel}\n`)
  // type:module so Node loads the emitted ESM without a reparse warning; sideEffects:false
  // lets bundlers tree-shake the per-target modules a consumer doesn't import.
  const pkg = { type: 'module', sideEffects: false }
  await writeFile(join(outputDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

  return {
    files: [...stems.map((s) => `${s}.js`), 'index.js', 'package.json'],
    grammarPackages: grammarPackagesFor(targets),
  }
}

function grammarPackagesFor(targets: Target[]): string[] {
  const grammars = new Set<GrammarId>()
  for (const target of targets) {
    if (typeof target === 'string') grammars.add(target)
    else for (const g of target.grammars) grammars.add(g)
  }
  // null = a vendored grammar (ships with @trast/core), so it needs no peer.
  const packages = [...grammars].map(grammarPackage).filter((p): p is string => p !== null)
  return [...new Set(packages)].sort()
}
