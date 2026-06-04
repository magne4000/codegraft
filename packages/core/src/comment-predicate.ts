import type { RichNode } from './types.js'

/** A leading comment that satisfied a rule's gate, plus the regex match it produced
 *  (surfaced to the rewrite as `captureArg.commentMatch`). */
export interface LeadingCommentMatch {
  comment: RichNode
  match: RegExpExecArray
}

/**
 * Build the predicate behind `.whenLeadingComment(re)`. It scans a node's
 * `leadingComments` and returns the first whose text matches `re`, with the match,
 * or `null` if none do.
 *
 * Grammar-agnostic by construction: an HTML directive comment is just a leading
 * comment (§6), so this one predicate covers it — there is no separate `.htmlComment`.
 * `re.lastIndex` is reset before each test so a global-flag regex stays correct when
 * the predicate is reused across every node in a tree.
 */
export function leadingCommentPredicate(re: RegExp): (node: RichNode) => LeadingCommentMatch | null {
  return (node) => {
    for (const comment of node.leadingComments) {
      re.lastIndex = 0
      const match = re.exec(comment.text)
      if (match) return { comment, match }
    }
    return null
  }
}
