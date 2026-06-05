import { createUnplugin } from 'unplugin'
import { makeUnpluginOptions, type CodegraftOptions } from './core.js'

/**
 * The unified Codegraft plugin. `codegraft(options)` returns an unplugin instance — use
 * `codegraft(opts).vite` / `.rollup` / `.rolldown` / `.esbuild` / `.webpack` / `.rspack` /
 * `.farm`, or import a per-bundler entry (e.g. `@codegraft/unplugin/vite`) for the common
 * `plugins: [codegraft(opts)]` shape.
 */
export function codegraft<Ctx extends Record<string, unknown>>(options: CodegraftOptions<Ctx>) {
  return createUnplugin(() => makeUnpluginOptions(options))
}

export type { CodegraftOptions } from './core.js'
