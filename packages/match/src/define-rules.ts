import { makeMatch, type Match } from './rule-builder.js'
import { RuleSetBuilder } from './rule-set-builder.js'
import type { RawRule } from './types.js'

/**
 * Entry point for authoring a rule set. The factory runs immediately (at module-import
 * time) and returns the rules; pattern strings stay raw until compile time. `Ctx` is
 * the run-context type — the factory receives a `Ctx`-bound `match` so each rewrite's
 * `context` argument is typed, and the resulting transformer's `transform(src, ctx)` is
 * typed too. Defaults to an open record for untyped use.
 */
export function defineRules<Ctx extends Record<string, unknown> = Record<string, unknown>>(
  factory: (match: Match<Ctx>) => RawRule[],
): RuleSetBuilder<Ctx> {
  return new RuleSetBuilder<Ctx>(factory(makeMatch<Ctx>()))
}
