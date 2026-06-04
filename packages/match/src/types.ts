import type { CaptureArg, GrammarId, RewriteResult } from '@trast/core'

/**
 * The user's rewrite callback: captures as the first argument, the run context as the
 * second, the return value driving the edit (see core's §7 pipeline). This is the one
 * function a compiled rule serialises via `.toString()`.
 */
export type Rewrite = (captures: CaptureArg, context: Record<string, unknown>) => RewriteResult

/**
 * An optional `.where(...)` match guard: a context-free predicate over the captures
 * that refines the structural match (e.g. "this condition references BATI"). Serialised
 * like {@link Rewrite}, so it must be self-contained.
 */
export type Guard = (captures: CaptureArg) => boolean

/**
 * A rule as captured by the builder at definition time, before any WASM grammar is
 * loaded. `compiledRulesFor` / `forTarget` lower it to a core `CompiledRule` by
 * parsing `patternString` (or deriving `{kind:'node'}` / `{kind:'any'}`) once the
 * grammar is available. Internal to @trast/match.
 */
export interface RawRule {
  language: GrammarId | 'any'
  /** The template-literal pattern source; `null` for `match.any()` and `match.<lang>.node()`. */
  patternString: string | null
  patternContext: 'expr' | 'type'
  /** Set by `.node(type)`; `null` otherwise. */
  nodeType: string | null
  /** Set by `.where(...)`; `null` otherwise. */
  guard: Guard | null
  commentRegex: RegExp | null
  rewrite: Rewrite
}
