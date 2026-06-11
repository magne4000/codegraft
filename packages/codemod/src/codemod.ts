import type { Collection, GrammarId, Transformer, ZoneSplitter } from '@codegraft/core'
import { createCodemodTransformer } from '@codegraft/core'

/** A codemod body: receives the file's {@link Collection} and the run context, records edits.
 *  `G` types the node-type/field vocabulary; annotate `root` (`Collection<'tsx'>`) to narrow it. */
export type CodemodFn<Ctx extends Record<string, unknown>, G extends GrammarId = GrammarId> = (
  root: Collection<G>,
  context: Ctx,
) => void

/** Options for a codemod. */
export interface CodemodConfig {
  /**
   * The build-time global marker the codemod keys off (e.g. `$$`). Enables the source-scan
   * optimisation — files that never mention it are returned untouched without being parsed.
   */
  namespace?: string
}

/**
 * Authoring handle for a codemod. `forTarget` builds a transformer for one target; `codegraft run`
 * and `@codegraft/unplugin` call it to apply the codemod live (no build step).
 *
 * `G` is the grammar the body was authored against (inferred from a `root: Collection<'tsx'>`
 * annotation, else every built-in grammar); it ties `forTarget` to a matching bare-grammar target.
 */
export class Codemod<
  Ctx extends Record<string, unknown> = Record<string, unknown>,
  G extends GrammarId = GrammarId,
> {
  readonly fn: CodemodFn<Ctx, G>
  readonly namespace: string | undefined

  constructor(fn: CodemodFn<Ctx, G>, namespace?: string) {
    this.fn = fn
    this.namespace = namespace
  }

  /** Interpreted mode: build a ready transformer for `target`. A grammar-annotated codemod only
   *  accepts its own bare grammar; a {@link ZoneSplitter} is always allowed (its grammars aren't
   *  statically known). Formatting is chosen per apply — `transform(src, ctx, { format })`. */
  forTarget(target: G | ZoneSplitter): Promise<Transformer<Ctx>> {
    return createCodemodTransformer<Ctx, G>(target, this.fn, { namespace: this.namespace }).init()
  }
}

/**
 * Entry point for authoring a codemod. An optional {@link CodemodConfig} may precede the body.
 * `Ctx` types the run context threaded into the body (and the resulting transformer's
 * `transform(src, ctx)`); defaults to an open record. `G` is inferred from the body's `root`
 * annotation (defaulting to every built-in grammar).
 */
export function defineCodemod<Ctx extends Record<string, unknown> = Record<string, unknown>, G extends GrammarId = GrammarId>(
  fn: CodemodFn<Ctx, G>,
): Codemod<Ctx, G>
export function defineCodemod<Ctx extends Record<string, unknown> = Record<string, unknown>, G extends GrammarId = GrammarId>(
  config: CodemodConfig,
  fn: CodemodFn<Ctx, G>,
): Codemod<Ctx, G>
export function defineCodemod<Ctx extends Record<string, unknown> = Record<string, unknown>, G extends GrammarId = GrammarId>(
  configOrFn: CodemodConfig | CodemodFn<Ctx, G>,
  maybeFn?: CodemodFn<Ctx, G>,
): Codemod<Ctx, G> {
  const fn = maybeFn ?? (configOrFn as CodemodFn<Ctx, G>)
  const config = maybeFn ? (configOrFn as CodemodConfig) : undefined
  return new Codemod<Ctx, G>(fn, config?.namespace)
}
