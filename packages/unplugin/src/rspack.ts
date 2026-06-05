import { codegraft } from './index.js'
import type { CodegraftOptions } from './core.js'

/** Codegraft plugin for rspack: `plugins: [codegraft({ rules, context })]`. */
export default <Ctx extends Record<string, unknown>>(options: CodegraftOptions<Ctx>) =>
  codegraft(options).rspack()
