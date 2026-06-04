import type { CompiledRule, GrammarId, PatternNode, Transformer, ZoneSplitter } from '@trast/core'
import { createTransformer } from '@trast/core'
import { Parser, assert } from '@trast/core/internal'
import { parsePattern } from './pattern-parser.js'
import type { RawRule } from './types.js'

/**
 * Holds the raw rules from `defineRules` and lowers them to core `CompiledRule` data on
 * demand — patterns are parsed only here (and in `forTarget`), once the grammar is
 * loaded, never at module-import time (§10.2). Generic over the run-context type `Ctx`
 * so `forTarget` returns a `Ctx`-typed transformer.
 */
export class RuleSetBuilder<Ctx extends Record<string, unknown> = Record<string, unknown>> {
  readonly #rules: RawRule[]

  constructor(rules: RawRule[]) {
    this.#rules = rules
  }

  /** Compile the rules that apply to `target` (its grammars, plus every `any` rule) to
   *  serialisable `CompiledRule` data — consumed by `@trast/cli` and by `forTarget`. */
  async compiledRulesFor(target: GrammarId | ZoneSplitter): Promise<CompiledRule[]> {
    const grammars = new Set<GrammarId>(typeof target === 'string' ? [target] : target.grammars)
    const matching = this.#rules.filter(
      (rule) => rule.language === 'any' || grammars.has(rule.language),
    )
    await Parser.init()
    const compiled: CompiledRule[] = []
    for (const rule of matching) compiled.push(await compile(rule))
    return compiled
  }

  /** Interpreted mode: compile for `target` and build a ready transformer. */
  async forTarget(target: GrammarId | ZoneSplitter): Promise<Transformer<Ctx>> {
    return createTransformer<Ctx>(target, await this.compiledRulesFor(target)).init()
  }
}

async function compile(rule: RawRule): Promise<CompiledRule> {
  let pattern: PatternNode
  if (rule.patternString !== null) {
    assert(rule.language !== 'any', 'a pattern rule must target a specific grammar')
    await Parser.loadGrammar(rule.language)
    pattern = parsePattern(rule.patternString, rule.language, rule.patternContext)
  } else if (rule.nodeType !== null) {
    pattern = { kind: 'node', nodeType: rule.nodeType }
  } else {
    pattern = { kind: 'any' }
  }
  return {
    language: rule.language,
    pattern,
    guard: rule.guard,
    commentRegex: rule.commentRegex,
    rewrite: rule.rewrite,
  }
}
