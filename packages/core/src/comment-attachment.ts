import type { GrammarId } from './types.js'

/**
 * The node types that count as comments, per grammar — the single source of truth
 * for "what is a comment node". Consumed here by the attachment pass (added in a
 * later step) and by `rich-node.ts` to keep comments out of `RichNode.children`.
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
