// Internal primitives for first-party build-time packages (@trast/cli, @trast/vue,
// @trast/unplugin). These are NOT part of the public consumer API — they are exposed only
// through the "@trast/core/internal" subpath (e.g. EXTENSION_GRAMMAR for the bundler plugin,
// grammarPackage for the CLI) so they need not duplicate the Parser/RichNode the runtime uses.
export { Parser, grammarPackage } from './parser.js'
export { EXTENSION_GRAMMAR } from './extensions.js'
export { wrapNode } from './rich-node.js'
export { assert } from './assert.js'
// Re-exported so a ZoneSplitter (e.g. @trast/vue) can walk the raw shell tree returned
// by Parser.parse without taking its own web-tree-sitter dependency.
export type { Node, Tree } from 'web-tree-sitter'
