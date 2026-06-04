import { makeMatch, type Match } from './rule-builder.js'
import { RuleSetBuilder } from './rule-set-builder.js'
import type { RawRule } from './types.js'

/** Options for a rule set. */
export interface RuleSetConfig {
  /**
   * The build-time global marker the rules reference (e.g. `$$`, used as `$$.BATI.has(…)`
   * in code and directive comments). Setting it enables the source-scan optimisation —
   * files that never mention the marker are returned untouched without being parsed —
   * so it must be distinctive enough to rarely appear by accident.
   */
  namespace?: string
}

type RuleFactory<Ctx extends Record<string, unknown>> = (match: Match<Ctx>) => RawRule[]

/**
 * Entry point for authoring a rule set. The factory runs immediately (at module-import
 * time) and returns the rules; pattern strings stay raw until compile time. `Ctx` is
 * the run-context type — the factory receives a `Ctx`-bound `match` so each rewrite's
 * `context` argument is typed, and the resulting transformer's `transform(src, ctx)` is
 * typed too. Defaults to an open record for untyped use. An optional {@link RuleSetConfig}
 * may precede the factory.
 */
export function defineRules<Ctx extends Record<string, unknown> = Record<string, unknown>>(
  factory: RuleFactory<Ctx>,
): RuleSetBuilder<Ctx>
export function defineRules<Ctx extends Record<string, unknown> = Record<string, unknown>>(
  config: RuleSetConfig,
  factory: RuleFactory<Ctx>,
): RuleSetBuilder<Ctx>
export function defineRules<Ctx extends Record<string, unknown> = Record<string, unknown>>(
  configOrFactory: RuleSetConfig | RuleFactory<Ctx>,
  maybeFactory?: RuleFactory<Ctx>,
): RuleSetBuilder<Ctx> {
  const factory = maybeFactory ?? (configOrFactory as RuleFactory<Ctx>)
  const namespace = maybeFactory ? (configOrFactory as RuleSetConfig).namespace : undefined
  return new RuleSetBuilder<Ctx>(factory(makeMatch<Ctx>()), namespace)
}
