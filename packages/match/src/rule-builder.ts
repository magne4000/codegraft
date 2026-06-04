import type { GrammarId } from '@trast/core'
import type { Guard, RawRule, Rewrite } from './types.js'

/**
 * The fluent chain that accumulates a rule and finalises it with `.rewrite(...)`.
 * `.where(...)` adds a match guard and `.whenLeadingComment(...)` a comment gate; both
 * are optional and order-independent. Construction is the only side-effect-free part —
 * the pattern string is parsed later, at compile time.
 */
class RuleBuilder {
  #guard: Guard | null = null
  #commentRegex: RegExp | null = null

  constructor(
    private readonly language: GrammarId | 'any',
    private readonly patternString: string | null,
    private readonly patternContext: 'expr' | 'type',
    private readonly nodeType: string | null,
  ) {}

  /** Refine the structural match with a context-free predicate over the captures. */
  where(guard: Guard): this {
    this.#guard = guard
    return this
  }

  /** Gate the rule on a leading comment (covers HTML directive comments too — §6). */
  whenLeadingComment(re: RegExp): this {
    this.#commentRegex = re
    return this
  }

  /** Finalise the chain into a {@link RawRule}. */
  rewrite(fn: Rewrite): RawRule {
    return {
      language: this.language,
      patternString: this.patternString,
      patternContext: this.patternContext,
      nodeType: this.nodeType,
      guard: this.#guard,
      commentRegex: this.#commentRegex,
      rewrite: fn,
    }
  }
}

type TemplateMatcher = (strings: TemplateStringsArray, ...values: unknown[]) => RuleBuilder
type NodeMatcher = (type: string) => RuleBuilder

function templateMatcher(language: GrammarId, context: 'expr' | 'type'): TemplateMatcher {
  return (strings, ...values) => {
    const pattern = strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ''),
      '',
    )
    return new RuleBuilder(language, pattern, context, null)
  }
}

const nodeMatcher = (language: GrammarId): NodeMatcher => (type) =>
  new RuleBuilder(language, null, 'expr', type)

/** A grammar with type-position patterns (TypeScript / TSX). */
function typed(language: GrammarId) {
  return { expr: templateMatcher(language, 'expr'), type: templateMatcher(language, 'type'), node: nodeMatcher(language) }
}

/** A grammar with expression patterns only (JS / HTML / CSS). */
function plain(language: GrammarId) {
  return { expr: templateMatcher(language, 'expr'), node: nodeMatcher(language) }
}

/**
 * The rule-authoring entry point. A plain object of plain namespaces — no callable
 * namespaces; `match.<lang>` is an object, and only `match.any()` is itself a call.
 * `match.ts`/`match.js` map to the `typescript`/`javascript` grammars.
 */
export const match = {
  tsx: typed('tsx'),
  ts: typed('typescript'),
  js: plain('javascript'),
  html: plain('html'),
  css: plain('css'),
  /** Language-agnostic: matches any node of any grammar (compiles to `{kind:'any'}`). */
  any: (): RuleBuilder => new RuleBuilder('any', null, 'expr', null),
}
