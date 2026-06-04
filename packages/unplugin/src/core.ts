import { createFilter, type FilterPattern } from 'unplugin-utils'
import type { UnpluginOptions } from 'unplugin'
import type { GrammarId, Transformer, ZoneSplitter } from '@trast/core'
import type { RuleSetBuilder } from '@trast/match'

export interface TrastOptions<Ctx extends Record<string, unknown>> {
  /** A `defineRules(...)` result. */
  rules: RuleSetBuilder<Ctx>
  /** The run context threaded into every rewrite. */
  context: Ctx
  /**
   * SFC splitters to handle multi-zone formats, e.g. `[vueSplitter]` for `.vue`. A
   * file is matched to a splitter when its extension equals the splitter's `id`
   * (`vueSplitter.id === 'vue'` → `.vue`). Kept out of core so the plugin needn't
   * depend on any splitter package.
   */
  splitters?: ZoneSplitter[]
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

function extensionOf(id: string): string {
  const dot = id.lastIndexOf('.')
  return dot === -1 ? '' : id.slice(dot + 1).split(/[?#]/)[0] // drop a Vite query/hash suffix
}

/** A file's transform target: a splitter (by id === extension) takes precedence over a
 *  single-grammar match. */
function targetForId(id: string, splitters: ZoneSplitter[]): GrammarId | ZoneSplitter | undefined {
  const ext = extensionOf(id)
  return splitters.find((s) => s.id === ext) ?? EXTENSION_GRAMMAR[ext]
}

const cacheKey = (target: GrammarId | ZoneSplitter) => (typeof target === 'string' ? target : target.id)

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
  const splitters = options.splitters ?? []
  const cache = new Map<string, Promise<Transformer<Ctx>>>()

  return {
    name: '@trast/unplugin',
    transformInclude(id) {
      return targetForId(id, splitters) !== undefined && filter(id)
    },
    async transform(code, id) {
      const target = targetForId(id, splitters)
      if (!target) return null
      const key = cacheKey(target)
      let pending = cache.get(key)
      if (!pending) {
        pending = options.rules.forTarget(target)
        cache.set(key, pending)
      }
      const output = (await pending).transform(code, options.context)
      // No sourcemap yet: Trast does string-slice edits plus recursive re-emit, so a
      // precise map is non-trivial. Returning code-only is fine for feature-flag DCE.
      return output === code ? null : { code: output, map: null }
    },
  }
}
