import type { GrammarId, RichNode } from './types.js'

/**
 * The node types that count as comments, per grammar — the single source of truth
 * for "what is a comment node". Consumed by the attachment pass below and by
 * `rich-node.ts` to keep comments out of `RichNode.children`.
 *
 * Every grammar Codegraft targets today names its comment node `comment`; the map is
 * kept per-grammar so a future grammar with a different name slots in without
 * touching either consumer.
 */
export const COMMENT_TYPES: Record<GrammarId, ReadonlySet<string>> = {
  javascript: new Set(['comment']),
  typescript: new Set(['comment']),
  tsx: new Set(['comment']),
  html: new Set(['comment']),
  css: new Set(['comment']),
  yaml: new Set(['comment']),
}

/**
 * Classify every comment among its parent's named siblings onto the relevant RichNode's
 * leading/trailing/inner array. Mutates in place; pure traversal, no parser dependency.
 *
 * - same row as the preceding node             → trailing of it
 * - in the contiguous comment run above a node → leading of that node
 * - no following node, or a blank-line break   → inner of the parent (it floats)
 *
 * The run is "contiguous" when each comment sits a row below the previous and the last a row above
 * the node, so a stack of comments all lead it (topmost first) — which lets a directive stacked
 * above another comment still attach to the node it gates.
 */
export function attachComments(root: RichNode): void {
  visit(root)
}

function visit(node: RichNode): void {
  // Post-order: comments live among named children, which are all reachable through
  // the structural `children` list (comments and punctuation are leaves).
  for (const child of node.children) visit(child)
  classify(node)
}

function isComment(node: RichNode): boolean {
  return COMMENT_TYPES[node.language].has(node.type)
}

function classify(parent: RichNode): void {
  const named = parent.allChildren.filter((n) => n.isNamed)
  for (let i = 0; i < named.length; i++) {
    const comment = named[i]
    if (!isComment(comment)) continue

    const next = firstNonCommentAfter(named, i)
    // No following node (e.g. a trailing comment tree-sitter absorbed as the last child) → inner.
    if (next === null) {
      parent.innerComments.push(comment)
      continue
    }

    // A comment sharing a line with the preceding node trails it — this takes precedence over
    // the leading block, so it is never also pulled into the next node's leading comments.
    const prev = lastNonCommentBefore(named, i)
    if (prev !== null && comment.startPosition.row === prev.endPosition.row) {
      prev.trailingComments.push(comment)
      continue
    }

    if (leadsContiguously(named, i, next)) next.leadingComments.push(comment)
    else parent.innerComments.push(comment)
  }
}

/** Whether `named[i]` is in the unbroken comment run directly above `next` — every row from the
 *  comment down to `next` filled by a comment, no blank-line gap. */
function leadsContiguously(named: RichNode[], i: number, next: RichNode): boolean {
  let expectedRow = named[i].endPosition.row + 1
  for (let j = i + 1; j < named.length; j++) {
    const node = named[j]
    if (node === next) return node.startPosition.row === expectedRow
    if (!isComment(node) || node.startPosition.row !== expectedRow) return false
    expectedRow = node.endPosition.row + 1
  }
  return false
}

function lastNonCommentBefore(named: RichNode[], i: number): RichNode | null {
  for (let j = i - 1; j >= 0; j--) if (!isComment(named[j])) return named[j]
  return null
}

function firstNonCommentAfter(named: RichNode[], i: number): RichNode | null {
  for (let j = i + 1; j < named.length; j++) if (!isComment(named[j])) return named[j]
  return null
}
