import { defineRules, match } from '@trast/match'

/** Two rules matching the same node — the first wins (EditCollector drops the
 *  overlapping second edit). Used by the conflict-first-wins fixture. */
export default defineRules(() => [
  match.tsx.node('lexical_declaration').rewrite(() => 'FIRST'),
  match.tsx.node('lexical_declaration').rewrite(() => 'SECOND'),
])
