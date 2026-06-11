import type { FilterPattern, UnpluginOptions } from 'unplugin'
import type { GrammarId, Transformer, ZoneSplitter } from '@codegraft/core'
import { EXTENSION_GRAMMAR } from '@codegraft/core/internal'

/** A codemod by shape — so the plugin needn't depend on `@codegraft/codemod` just for a type. */
interface TransformerSource<Ctx extends Record<string, unknown>> {
  forTarget(target: GrammarId | ZoneSplitter): Promise<Transformer<Ctx>>
}

export interface CodegraftOptions<Ctx extends Record<string, unknown>> {
  /** A `defineCodemod(...)` result. */
  codemod: TransformerSource<Ctx>
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
  /** Render edits indentation-aware (re-indent inserts, collapse removed lines) instead of verbatim.
   *  Off by default — leave whitespace clean-up to the build's formatter. */
  format?: boolean
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
  options: CodegraftOptions<Ctx>,
): UnpluginOptions {
  const splitters = options.splitters ?? []
  const cache = new Map<string, Promise<Transformer<Ctx>>>()

  return {
    name: '@codegraft/unplugin',
    transform: {
      // unplugin's native id filter applies include/exclude; the handler skips any
      // extension Codegraft doesn't handle (returning null).
      filter: { id: { include: options.include, exclude: options.exclude } },
      async handler(code, id) {
        const target = targetForId(id, splitters)
        if (!target) return null
        const key = cacheKey(target)
        let pending = cache.get(key)
        if (!pending) {
          pending = options.codemod.forTarget(target)
          cache.set(key, pending)
        }
        const result = (await pending).transformWithMap(code, options.context, { source: id, format: options.format })
        return result.code === code ? null : { code: result.code, map: result.map }
      },
    },
  }
}
