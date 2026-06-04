import type { PatternNode, RichNode } from './types.js'
import { assert } from './assert.js'

/** Structural captures produced by a match: a `capture` binds one node, a `spread`
 *  binds the tail of a sibling list. */
type Captures = Record<string, RichNode | RichNode[]>

/**
 * Match one `PatternNode` against one `RichNode`, returning the captures it produced
 * or `null` if it does not match. Pure; the single matcher serving both dev and
 * compiled modes. Algorithm: §5.
 *
 * Walks `node.children` (the comment-free named list, §4) — the same surface the
 * pattern was built from, so patterns and targets compare like-for-like.
 */
export function matchPattern(pattern: PatternNode, node: RichNode): Captures | null {
  switch (pattern.kind) {
    case 'any':
      return {}
    case 'node':
      return node.type === pattern.nodeType ? {} : null
    case 'text':
      return node.type === pattern.nodeType && node.text === pattern.text ? {} : null
    case 'capture':
      return { [pattern.name]: node }
    case 'exact':
      return node.type === pattern.nodeType ? matchChildren(pattern.children, node.children) : null
    case 'spread':
      // A spread is meaningful only positionally among siblings; matchChildren
      // consumes it directly and never recurses into it here.
      assert(false, 'spread pattern reached matchPattern — it must be a child of an exact pattern')
  }
}

function matchChildren(patterns: PatternNode[], nodes: RichNode[]): Captures | null {
  const caps: Captures = {}
  let pi = 0
  let ni = 0
  while (pi < patterns.length) {
    const p = patterns[pi]
    if (p.kind === 'spread') {
      // Terminal by construction (the parser asserts it): bind the remaining nodes.
      caps[p.name] = nodes.slice(ni)
      return caps
    }
    if (ni >= nodes.length) return null
    const sub = matchPattern(p, nodes[ni])
    if (sub === null) return null
    Object.assign(caps, sub)
    pi++
    ni++
  }
  // No spread consumed the tail, so any leftover node is a child-count mismatch.
  return ni < nodes.length ? null : caps
}

/** Bind a pattern once into a per-node matcher — the form `createTransformer` holds. */
export function matchVisitor(pattern: PatternNode): (node: RichNode) => Captures | null {
  return (node) => matchPattern(pattern, node)
}
