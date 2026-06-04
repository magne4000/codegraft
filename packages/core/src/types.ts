// The contract every other file in @trast/core (and the @trast/match / @trast/cli
// packages downstream) implements against. No imports: this module is the root of
// the type graph and must stay dependency-free.

/** A real tree-sitter grammar. There is no id for SFC file formats — those are
 *  handled by a {@link ZoneSplitter}, which maps each section to one of these. */
export type GrammarId = 'javascript' | 'typescript' | 'tsx' | 'html' | 'css'

/** Row/column position, mirroring tree-sitter's `Point`. */
export type Point = { row: number; column: number }

/**
 * The open extension point for multi-zone file formats (Vue SFC, Astro, …). The
 * only value today is `vueSplitter`, exported from `@trast/vue`; core stays
 * ignorant of any concrete format.
 *
 * `init()` lets a splitter load whatever grammar it parses the shell with (Vue
 * loads `tree-sitter-vue`), so `split()` can stay synchronous. The pipeline calls
 * `init()` once, before the first `split()`.
 *
 * `split()` returns raw zone descriptors only — it does not parse zone *contents*;
 * that is the pipeline's job (`splitAndParse`).
 */
export interface ZoneSplitter {
  /** Output file stem: `'vue'` → `dist/vue.js`. */
  readonly id: string
  /** Which grammars this format can produce. */
  readonly grammars: GrammarId[]
  /** Idempotent; loads the splitter's own parsing grammar. */
  init(): Promise<void>
  split(source: string): Array<{ language: GrammarId; source: string; startOffset: number }>
}

/**
 * A lazy wrapper over a tree-sitter `SyntaxNode`. Reads type/text/positions
 * straight from the backing node on each access; `children` and `allChildren` are
 * computed once and cached. The comment arrays start empty and are filled in by the
 * comment-attachment pass.
 *
 * All offset accessors come in two flavours: `startIndex`/`endIndex` are relative
 * to the *zone* source, `documentStartIndex`/`documentEndIndex` are absolute in the
 * original document (`startIndex + zone.startOffset`). Edits are always expressed in
 * document space, so they never need remapping.
 */
export interface RichNode {
  readonly type: string
  readonly isNamed: boolean
  readonly text: string
  /** Byte offset in the *zone* source. */
  readonly startIndex: number
  readonly endIndex: number
  readonly startPosition: Point
  readonly endPosition: Point
  readonly parent: RichNode | null
  /** Named structural children: no punctuation, no comments. The surface pattern
   *  matching walks, so comments never perturb a match. */
  readonly children: RichNode[]
  /** Full CST: every child, including punctuation and comment nodes. */
  readonly allChildren: RichNode[]
  child(field: string): RichNode | null
  childrenForField(field: string): RichNode[]
  readonly leadingComments: RichNode[]
  readonly trailingComments: RichNode[]
  readonly innerComments: RichNode[]
  readonly language: GrammarId
  /** Absolute offset in the original document: `startIndex + zone.startOffset`. */
  readonly documentStartIndex: number
  readonly documentEndIndex: number
}

/**
 * One parsed region of a document. A single-grammar file produces exactly one
 * synthetic zone with `startOffset: 0`; an SFC produces one per section. Either way
 * the rest of the pipeline sees only `Zone[]`.
 */
export interface Zone {
  language: GrammarId
  /** Exact slice: `outerSource.slice(startOffset, startOffset + source.length)`. */
  source: string
  startOffset: number
  tree: RichNode
}

/** A single text replacement, expressed in document offsets. */
export interface Edit {
  /** Document offset, inclusive. */
  start: number
  /** Document offset, exclusive. */
  end: number
  /** `''` for a deletion. */
  replacement: string
}

/**
 * The object passed as the first argument to every rewrite callback. `node` and the
 * named captures are always `RichNode`/`RichNode[]`; `commentMatch` is present only
 * for comment-gated rules. The index signature is widened to admit `commentMatch`
 * so the type stays sound — an intersection with `Record<string, RichNode |
 * RichNode[]>` would reject the `RegExpExecArray`.
 */
export type CaptureArg = {
  node: RichNode
  commentMatch?: RegExpExecArray
  [capture: string]: RichNode | RichNode[] | RegExpExecArray | undefined
}

/**
 * The serialisable shape of a pattern. Every rule kind reduces to one of these, so
 * a single matcher covers them all: `match.any()` → `{kind:'any'}`,
 * `match.<lang>.node(t)` → `{kind:'node',nodeType:t}`, and a pattern string compiles
 * to an `exact`/`text` tree.
 */
export type PatternNode =
  | { kind: 'exact'; nodeType: string; children: PatternNode[] } // type + recurse children
  | { kind: 'text'; nodeType: string; text: string } // leaf: type + literal text
  | { kind: 'node'; nodeType: string } // type only (match.<lang>.node)
  | { kind: 'capture'; name: string } // $feature
  | { kind: 'spread'; name: string } // $$$body — must be terminal in its sibling list
  | { kind: 'any' } // match.any(): any node, no captures

/**
 * The sentinel a rewrite returns to delete the matched node (and, for comment-gated
 * rules, its directive comment). A `unique symbol`, defined once here so there is a
 * single source of truth — it is re-exported as part of the public API.
 */
export const remove = Symbol('trast.remove')

/** What a rewrite callback may return. */
export type RewriteResult = RichNode | RichNode[] | string | typeof remove

/**
 * Plain data plus the user's rewrite function — no library-generated closures.
 * `@trast/core` turns `pattern` into a visitor and `commentRegex` into a predicate at
 * `init()`. This is what lets a rule serialise: the only function emitted via
 * `.toString()` is the user-authored `rewrite`; everything else is a `PatternNode`
 * literal and a `RegExp` literal.
 */
export interface CompiledRule {
  language: GrammarId | 'any'
  pattern: PatternNode
  /**
   * An optional match guard run after the structural match. It refines the match
   * decision (e.g. "this `if`'s condition references BATI") without enumerating
   * shapes structurally, so the match stays precise and outer-wins skips only true
   * matches. Context-free by design — matching does not depend on run context, only
   * the rewrite does. Serialised like `rewrite`. `null` when the rule has no guard.
   */
  guard: ((captures: CaptureArg) => boolean) | null
  commentRegex: RegExp | null
  rewrite: (captures: CaptureArg, context: Record<string, unknown>) => RewriteResult
}

/** Applies a compiled rule set to a source string. Synchronous once built. */
export interface Transformer {
  transform(source: string, context: Record<string, unknown>): string
}

/** A {@link Transformer} that has not yet loaded its WASM grammars. */
export interface LazyTransformer {
  readonly target: GrammarId | ZoneSplitter
  /** Idempotent; WASM is loaded at most once per process. */
  init(): Promise<Transformer>
}
