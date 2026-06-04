import type { CaptureArg, GrammarId, RewriteResult } from '@trast/core'
import type { Guard, RawRule, Rewrite } from './types.js'

/**
 * The fluent chain that accumulates a rule and finalises it with `.rewrite(...)`.
 * Generic over the run-context type `Ctx` so the rewrite's second argument is typed
 * (see {@link makeMatch} / `defineRules`). `.where(...)` adds a context-free match
 * guard and `.whenLeadingComment(...)` a comment gate; both are optional and
 * order-independent.
 */
export class RuleBuilder<Ctx extends Record<string, unknown>> {
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

  /** Finalise the chain into a {@link RawRule}. The `Ctx`-typed rewrite is stored as the
   *  erased {@link Rewrite}: `Ctx` is a compile-time-only refinement of the context the
   *  rewrite is actually called with at runtime, so the assertion is sound. */
  rewrite(fn: (captures: CaptureArg, context: Ctx) => RewriteResult): RawRule {
    return {
      language: this.language,
      patternString: this.patternString,
      patternContext: this.patternContext,
      nodeType: this.nodeType,
      guard: this.#guard,
      commentRegex: this.#commentRegex,
      rewrite: fn as Rewrite,
    }
  }
}

type TemplateMatcher<Ctx extends Record<string, unknown>> = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => RuleBuilder<Ctx>
type NodeMatcher<Ctx extends Record<string, unknown>> = (type: string) => RuleBuilder<Ctx>

/** A grammar exposing type-position patterns (TypeScript / TSX). */
export interface TypedNamespace<Ctx extends Record<string, unknown>> {
  expr: TemplateMatcher<Ctx>
  type: TemplateMatcher<Ctx>
  node: NodeMatcher<Ctx>
}
/** A grammar exposing expression patterns only (JS / HTML / CSS). */
export interface PlainNamespace<Ctx extends Record<string, unknown>> {
  expr: TemplateMatcher<Ctx>
  node: NodeMatcher<Ctx>
}

/** The rule-authoring surface, bound to a run-context type. */
export interface Match<Ctx extends Record<string, unknown>> {
  tsx: TypedNamespace<Ctx>
  ts: TypedNamespace<Ctx>
  js: PlainNamespace<Ctx>
  html: PlainNamespace<Ctx>
  css: PlainNamespace<Ctx>
  /** Language-agnostic: matches any node of any grammar (compiles to `{kind:'any'}`). */
  any: () => RuleBuilder<Ctx>
}

function templateMatcher<Ctx extends Record<string, unknown>>(
  language: GrammarId,
  context: 'expr' | 'type',
): TemplateMatcher<Ctx> {
  return (strings, ...values) => {
    const pattern = strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ''),
      '',
    )
    return new RuleBuilder<Ctx>(language, pattern, context, null)
  }
}

const nodeMatcher =
  <Ctx extends Record<string, unknown>>(language: GrammarId): NodeMatcher<Ctx> =>
  (type) =>
    new RuleBuilder<Ctx>(language, null, 'expr', type)

function typed<Ctx extends Record<string, unknown>>(language: GrammarId): TypedNamespace<Ctx> {
  return {
    expr: templateMatcher<Ctx>(language, 'expr'),
    type: templateMatcher<Ctx>(language, 'type'),
    node: nodeMatcher<Ctx>(language),
  }
}

function plain<Ctx extends Record<string, unknown>>(language: GrammarId): PlainNamespace<Ctx> {
  return { expr: templateMatcher<Ctx>(language, 'expr'), node: nodeMatcher<Ctx>(language) }
}

/**
 * Build a {@link Match} bound to a run-context type. `defineRules<Ctx>` hands the
 * factory `makeMatch<Ctx>()` so rewrites get a typed `context`; the exported `match`
 * is the open-context default for quick, untyped use.
 *
 * A plain object of plain namespaces — no callable namespaces; only `match.any()` is a
 * call. `ts`/`js` map to the `typescript`/`javascript` grammars.
 */
export function makeMatch<Ctx extends Record<string, unknown>>(): Match<Ctx> {
  return {
    tsx: typed<Ctx>('tsx'),
    ts: typed<Ctx>('typescript'),
    js: plain<Ctx>('javascript'),
    html: plain<Ctx>('html'),
    css: plain<Ctx>('css'),
    any: () => new RuleBuilder<Ctx>('any', null, 'expr', null),
  }
}

/** The open-context entry point. For a typed context, use `defineRules<Ctx>`. */
export const match: Match<Record<string, unknown>> = makeMatch<Record<string, unknown>>()
