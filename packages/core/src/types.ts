// The contract every other file in @codegraft/core (and the @codegraft/codemod / @codegraft/cli
// packages downstream) implements against. Its only imports are leaf modules that import nothing
// back (the generated node-type module and the format options), so this stays near the root of the
// type graph.
import type { NodeTypeAll, FieldName } from './generated/node-types.js'
import type { FormatOptions } from './format.js'

/**
 * A real tree-sitter grammar. SFC *file formats* have no id of their own — a {@link ZoneSplitter}
 * maps each section to one of these. `'vue'` is the exception: it is a real tree-sitter grammar
 * (used for a `.vue` `<template>` zone) but its wasm ships with `@codegraft/vue`, not core, so it is
 * loaded by the splitter's `init()` (via `loadGrammar`'s path form) rather than resolved as built-in.
 */
export type GrammarId = 'javascript' | 'typescript' | 'tsx' | 'html' | 'css' | 'yaml' | 'vue'

/** Row/column position, mirroring tree-sitter's `Point`. */
export type Point = { row: number; column: number }

/**
 * The open extension point for multi-zone file formats (Vue SFC, Astro, …). The
 * only value today is `vueSplitter`, exported from `@codegraft/vue`; core stays
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
  /** Identifier and the file extension it handles: `'vue'` → `.vue`. */
  readonly id: string
  /** Which grammars this format can produce. */
  readonly grammars: GrammarId[]
  /** Idempotent; loads the splitter's own parsing grammar. */
  init(): Promise<void>
  split(source: string): Array<{ language: GrammarId; source: string; startOffset: number }>
}

/**
 * Lazy wrapper over the backing tree-sitter node. `children`/`allChildren` are cached;
 * comment arrays are filled by the attachment pass. Offsets come in two frames:
 * `startIndex`/`endIndex` are zone-relative, `documentStartIndex`/`documentEndIndex`
 * absolute — so edits, always in document space, never need remapping.
 */
export interface RichNode {
  readonly type: NodeTypeAll
  readonly isNamed: boolean
  readonly text: string
  /** Byte offset in the *zone* source. */
  readonly startIndex: number
  readonly endIndex: number
  readonly startPosition: Point
  readonly endPosition: Point
  readonly parent: RichNode | null
  /** The zone tree's root — the topmost ancestor, or `this` when parentless. */
  readonly root: RichNode
  /** Named structural children: no punctuation, no comments. The surface pattern
   *  matching walks, so comments never perturb a match. */
  readonly children: RichNode[]
  /** Full CST: every child, including punctuation and comment nodes. */
  readonly allChildren: RichNode[]
  child(field: FieldName): RichNode | null
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

/** A source map, structurally compatible with magic-string's (kept here so this module
 *  stays import-free). */
export interface SourceMap {
  version: number
  file?: string
  sources: string[]
  sourcesContent?: (string | null)[]
  names: string[]
  mappings: string
  toString(): string
  toUrl(): string
}

/**
 * Applies a codemod to a source string. Synchronous once built. `Ctx` is the run-context
 * type the codemod is authored against (`defineCodemod<Ctx>`); it defaults to an open record
 * and is constrained to a record so it can flow into the body and `transform(src, ctx)`.
 */
export interface Transformer<Ctx extends Record<string, unknown> = Record<string, unknown>> {
  /** Apply the codemod to `source`. The recorded edits are always rendered indentation-aware —
   *  inserts re-indented to the file's unit/EOL, a removed node's line collapsed — keyed off the
   *  source's detected style; `options` overrides that detection per apply (see {@link FormatOptions}). */
  transform(source: string, context: Ctx, options?: FormatOptions): string
  /** Like {@link transform} but also returns a source map (`options.source` names the input in the
   *  map). Used by build-pipeline integrations such as `@codegraft/unplugin`. */
  transformWithMap(
    source: string,
    context: Ctx,
    options?: { source?: string } & FormatOptions,
  ): { code: string; map: SourceMap }
}

/** A {@link Transformer} that has not yet loaded its WASM grammars. */
export interface LazyTransformer<Ctx extends Record<string, unknown> = Record<string, unknown>> {
  readonly target: GrammarId | ZoneSplitter
  /** Idempotent; WASM is loaded at most once per process. */
  init(): Promise<Transformer<Ctx>>
}
