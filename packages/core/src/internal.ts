// Internal primitives for first-party build-time packages (@codegraft/cli, @codegraft/vue,
// @codegraft/unplugin). These are NOT part of the public consumer API — they are exposed only
// through the "@codegraft/core/internal" subpath (e.g. EXTENSION_GRAMMAR for the bundler plugin)
// so they need not duplicate the Parser/RichNode the runtime uses.
export { Parser } from './parser.js'
export { EXTENSION_GRAMMAR } from './extensions.js'
export { wrapNode } from './rich-node.js'
export { assert } from './assert.js'
// Re-exported so a ZoneSplitter (e.g. @codegraft/vue) can walk the raw shell tree returned
// by Parser.parse without taking its own web-tree-sitter dependency.
export type { Node, Tree } from 'web-tree-sitter'
