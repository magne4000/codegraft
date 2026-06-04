import type { GrammarId, RichNode } from './types.js'

/**
 * The node types that count as comments, per grammar — the single source of truth
 * for "what is a comment node". Consumed by the attachment pass below and by
 * `rich-node.ts` to keep comments out of `RichNode.children`.
 *
 * Every grammar Trast targets today names its comment node `comment`; the map is
 * kept per-grammar so a future grammar with a different name slots in without
 * touching either consumer.
 */
export const COMMENT_TYPES: Record<GrammarId, ReadonlySet<string>> = {
  javascript: new Set(['comment']),
  typescript: new Set(['comment']),
  tsx: new Set(['comment']),
  html: new Set(['comment']),
  css: new Set(['comment']),
}

/**
 * Classify every comment node and record it on the relevant `RichNode`'s
 * `leadingComments` / `trailingComments` / `innerComments` array. Mutates in place;
 * pure tree traversal, no parser dependency. Algorithm: §6 of the plan.
 *
 * Each comment is classified among its parent's *named* siblings:
 * - no following non-comment sibling           → inner of the parent
 * - same row as the preceding non-comment node → trailing of that node
 * - exactly one row above the next node        → leading of that node
 * - otherwise (e.g. separated by a blank line) → inner of the parent (it floats)
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

    const prev = lastNonCommentBefore(named, i)
    const next = firstNonCommentAfter(named, i)

    if (next === null) {
      parent.innerComments.push(comment)
    } else if (prev !== null && comment.startPosition.row === prev.endPosition.row) {
      prev.trailingComments.push(comment)
    } else if (next.startPosition.row - comment.endPosition.row === 1) {
      next.leadingComments.push(comment)
    } else {
      parent.innerComments.push(comment)
    }
  }
}

function lastNonCommentBefore(named: RichNode[], i: number): RichNode | null {
  for (let j = i - 1; j >= 0; j--) if (!isComment(named[j])) return named[j]
  return null
}

function firstNonCommentAfter(named: RichNode[], i: number): RichNode | null {
  for (let j = i + 1; j < named.length; j++) if (!isComment(named[j])) return named[j]
  return null
}
