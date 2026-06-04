import { createUnplugin } from 'unplugin'
import { makeUnpluginOptions, type TrastOptions } from './core.js'

/**
 * The unified Trast plugin. `trast(options)` returns an unplugin instance — use
 * `trast(opts).vite` / `.rollup` / `.rolldown` / `.esbuild` / `.webpack` / `.rspack` /
 * `.farm`, or import a per-bundler entry (e.g. `@trast/unplugin/vite`) for the common
 * `plugins: [trast(opts)]` shape.
 */
export function trast<Ctx extends Record<string, unknown>>(options: TrastOptions<Ctx>) {
  return createUnplugin(() => makeUnpluginOptions(options))
}

export type { TrastOptions } from './core.js'
