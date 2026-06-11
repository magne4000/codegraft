// Internal primitives for first-party build-time packages (@codegraft/cli, @codegraft/vue,
// @codegraft/unplugin). These are NOT part of the public consumer API — they are exposed only
// through the "@codegraft/core/internal" subpath (e.g. EXTENSION_GRAMMAR for the bundler plugin)
// so they need not duplicate the Parser/RichNode the runtime uses.
export { Parser } from './parser.js'
export { EXTENSION_GRAMMAR } from './extensions.js'
export { wrapNode } from './rich-node.js'
export { assert } from './assert.js'
// Re-exported (from the vendored engine, so a ZoneSplitter needs no web-tree-sitter dependency of
// its own) to let it walk the raw shell tree Parser.parse returns.
export type { Node, Tree } from '../vendor/web-tree-sitter/web-tree-sitter.js'
