import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { GrammarId, ZoneSplitter } from '@trast/core'
import { assert, grammarPackage } from '@trast/core/internal'
import type { RuleSetBuilder } from '@trast/match'
import { serialiseRules } from './serialise.js'

type Target = GrammarId | ZoneSplitter

export interface BuildResult {
  /** File names written under the output dir. */
  files: string[]
  /** The grammar packages the chosen targets require — the optional peers (§2) the
   *  shipping tool must add to its own dependencies. */
  grammarPackages: string[]
}

/** The `default` export (rule set) and `targets` export a rules file must provide. */
interface RulesModule {
  default: RuleSetBuilder
  targets: Target[]
}

/**
 * `trast build`: import a compiled rules file and emit one transformer module per
 * declared target, a barrel, and a `package.json`. The rules file must be importable
 * by the running Node (compile TS first, or run under a loader) — §8.
 */
export async function build(rulesFile: string, outputDir: string): Promise<BuildResult> {
  const mod = (await import(pathToFileURL(rulesFile).href)) as Partial<RulesModule>
  assert(mod.default, `rules file '${rulesFile}' has no default export (a defineRules result)`)
  assert(Array.isArray(mod.targets), `rules file '${rulesFile}' must export a 'targets' array`)
  return buildRules(mod.default, mod.targets, outputDir)
}

/**
 * Emit the per-target modules + barrel + package.json for an already-loaded rule set.
 * Separated from `build` so it is testable without a file import.
 */
export async function buildRules(
  ruleSet: RuleSetBuilder,
  targets: Target[],
  outputDir: string,
): Promise<BuildResult> {
  await mkdir(outputDir, { recursive: true })

  const stems: string[] = []
  for (const target of targets) {
    const stem = typeof target === 'string' ? target : target.id
    const source = serialiseRules(target, await ruleSet.compiledRulesFor(target))
    await writeFile(join(outputDir, `${stem}.js`), source)
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
  return [...new Set([...grammars].map(grammarPackage))].sort()
}
