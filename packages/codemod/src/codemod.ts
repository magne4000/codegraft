import type { Collection, GrammarId, Transformer, ZoneSplitter } from '@codegraft/core'
import { createCodemodTransformer } from '@codegraft/core'

/** A codemod body: receives the file's {@link Collection} and the run context, records edits. */
export type CodemodFn<Ctx extends Record<string, unknown>> = (root: Collection, context: Ctx) => void

/** Options for a codemod. */
export interface CodemodConfig {
  /**
   * The build-time global marker the codemod keys off (e.g. `$$`). Enables the source-scan
   * optimisation — files that never mention it are returned untouched without being parsed.
   */
  namespace?: string
}

/**
 * Authoring handle for a codemod. `forTarget` builds an interpreted transformer; `fn`/`namespace`
 * are read by `codegraft build` for compiled mode. Because the body is param-rooted (everything hangs
 * off `root`/`context`), `fn.toString()` is self-contained and serialises.
 */
export class Codemod<Ctx extends Record<string, unknown> = Record<string, unknown>> {
  readonly fn: CodemodFn<Ctx>
  readonly namespace: string | undefined

  constructor(fn: CodemodFn<Ctx>, namespace?: string) {
    this.fn = fn
    this.namespace = namespace
  }

  /** Interpreted mode: build a ready transformer for `target`. */
  forTarget(target: GrammarId | ZoneSplitter): Promise<Transformer<Ctx>> {
    return createCodemodTransformer<Ctx>(target, this.fn, { namespace: this.namespace }).init()
  }
}

/**
 * Entry point for authoring a codemod. An optional {@link CodemodConfig} may precede the body.
 * `Ctx` types the run context threaded into the body (and the resulting transformer's
 * `transform(src, ctx)`); defaults to an open record.
 */
export function defineCodemod<Ctx extends Record<string, unknown> = Record<string, unknown>>(
  fn: CodemodFn<Ctx>,
): Codemod<Ctx>
export function defineCodemod<Ctx extends Record<string, unknown> = Record<string, unknown>>(
  config: CodemodConfig,
  fn: CodemodFn<Ctx>,
): Codemod<Ctx>
export function defineCodemod<Ctx extends Record<string, unknown> = Record<string, unknown>>(
  configOrFn: CodemodConfig | CodemodFn<Ctx>,
  maybeFn?: CodemodFn<Ctx>,
): Codemod<Ctx> {
  const fn = maybeFn ?? (configOrFn as CodemodFn<Ctx>)
  const namespace = maybeFn ? (configOrFn as CodemodConfig).namespace : undefined
  return new Codemod<Ctx>(fn, namespace)
}
