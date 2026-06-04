import { createFilter, type FilterPattern } from 'unplugin-utils'
import type { UnpluginOptions } from 'unplugin'
import type { GrammarId, Transformer } from '@trast/core'
import type { RuleSetBuilder } from '@trast/match'

export interface TrastOptions<Ctx extends Record<string, unknown>> {
  /** A `defineRules(...)` result. */
  rules: RuleSetBuilder<Ctx>
  /** The run context threaded into every rewrite. */
  context: Ctx
  /** Limit which module ids are transformed (defaults to all handled extensions). */
  include?: FilterPattern
  exclude?: FilterPattern
}

/** File extension → the grammar that handles it. v1 covers single-grammar files; `.vue`
 *  (which needs the deferred @trast/vue splitter) is intentionally absent. */
const EXTENSION_GRAMMAR: Record<string, GrammarId> = {
  tsx: 'tsx',
  jsx: 'tsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  html: 'html',
  htm: 'html',
  css: 'css',
}

function grammarForId(id: string): GrammarId | undefined {
  const dot = id.lastIndexOf('.')
  if (dot === -1) return undefined
  const ext = id.slice(dot + 1).split(/[?#]/)[0] // drop a Vite query/hash suffix
  return EXTENSION_GRAMMAR[ext]
}

/**
 * The bundler-agnostic plugin body, shared by every adapter (`createUnplugin` turns it
 * into Vite/Rollup/Rolldown/etc.). A module's extension selects a transformer (lazily
 * `init`-ed once and cached), which runs with the build's context. Returns `null` when
 * the file isn't handled or is unchanged, so the bundler skips it.
 */
export function makeUnpluginOptions<Ctx extends Record<string, unknown>>(
  options: TrastOptions<Ctx>,
): UnpluginOptions {
  const filter = createFilter(options.include, options.exclude)
  const cache = new Map<GrammarId, Promise<Transformer<Ctx>>>()

  return {
    name: '@trast/unplugin',
    transformInclude(id) {
      return grammarForId(id) !== undefined && filter(id)
    },
    async transform(code, id) {
      const grammar = grammarForId(id)
      if (!grammar) return null
      let pending = cache.get(grammar)
      if (!pending) {
        pending = options.rules.forTarget(grammar)
        cache.set(grammar, pending)
      }
      const output = (await pending).transform(code, options.context)
      // No sourcemap yet: Trast does string-slice edits plus recursive re-emit, so a
      // precise map is non-trivial. Returning code-only is fine for feature-flag DCE.
      return output === code ? null : { code: output, map: null }
    },
  }
}
