import { trast } from './index.js'
import type { TrastOptions } from './core.js'

/** Trast plugin for rollup: `plugins: [trast({ rules, context })]`. */
export default <Ctx extends Record<string, unknown>>(options: TrastOptions<Ctx>) =>
  trast(options).rollup()
