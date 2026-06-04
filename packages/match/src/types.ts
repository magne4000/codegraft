import type { CaptureArg, GrammarId, RewriteResult } from '@trast/core'

/**
 * The user's rewrite callback: captures as the first argument, the run context as the
 * second, the return value driving the edit (see core's §7 pipeline). This is the one
 * function a compiled rule serialises via `.toString()`.
 */
export type Rewrite = (captures: CaptureArg, context: Record<string, unknown>) => RewriteResult

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
  commentRegex: RegExp | null
  rewrite: Rewrite
}
