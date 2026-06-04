// Internal primitives for first-party build-time packages (@trast/match's pattern
// parser). These are NOT part of the public consumer API (§1) — they are exposed only
// through the "@trast/core/internal" subpath so @trast/match can parse pattern strings
// with the same Parser/RichNode the runtime uses, without re-initialising web-tree-sitter.
export { Parser, grammarPackage } from './parser.js'
export { wrapNode } from './rich-node.js'
export { assert } from './assert.js'
