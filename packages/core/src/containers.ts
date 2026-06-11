import type { RichNode } from './types.js'
import { isComment } from './comment-attachment.js'
import { assert } from './assert.js'

// Structural queries over container nodes (arrays / objects / blocks / interface bodies …), shared by
// the Collection (routing, `remove({ separator })`) and the Formatter (layout). Kept here so neither
// has to import the other.

/** The opening delimiter token (`[` / `{` / `(`) of a container node. */
export function openDelimiter(node: RichNode): RichNode {
  const open = node.allChildren[0]
  assert(open, `container '${node.type}' has no opening delimiter`)
  return open
}

/** The separator token (a `,` by default, or `;` for a `;`-list) immediately after `node` among its
 *  parent's children (comments skipped), or `null` — the trailing separator `remove({ separator })`
 *  drops alongside a list element, and `append` extends to keep the container's style. */
export function trailingSeparator(node: RichNode, sep = ','): RichNode | null {
  const siblings = node.parent?.allChildren
  if (!siblings) return null
  const i = siblings.indexOf(node)
  if (i === -1) return null
  for (let j = i + 1; j < siblings.length; j++) {
    const sib = siblings[j]
    if (isComment(sib)) continue
    return sib.type === sep ? sib : null
  }
  return null
}

/** Whether `node` spans more than one line (its open and close sit on different rows) — the cue for
 *  `append`/`prepend` to lay an element on its own line rather than inline. */
export function isMultiline(node: RichNode): boolean {
  return node.startPosition.row !== node.endPosition.row
}

/** Containers whose elements are separated by newlines (a block / class body), not commas. */
export const NEWLINE_CONTAINERS = new Set(['statement_block', 'class_body', 'program'])

/** Containers whose members are separated/terminated by `;` (a TS interface / object type). */
export const SEMI_CONTAINERS = new Set(['interface_body', 'object_type'])
