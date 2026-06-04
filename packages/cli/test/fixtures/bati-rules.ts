import { defineRules } from '@trast/match'
import type { RichNode } from '@trast/core'

// A minimal Bati-style rule set for the build/run tests. The namespace is data-shaped
// (`$$.flags.x`) so the context is JSON-serialisable — the form `trast run --context`
// accepts — and the rewrite is self-contained, so it serialises cleanly in compiled
// mode (`evaluate` and other imported helpers are an interpreted-mode convenience).
export default defineRules<{ flags: Record<string, boolean> }>({ namespace: '$$' }, (match) => [
  match.tsx.expr`if ($$.flags.$flag) { $$$then } else { $$$otherwise }`.rewrite(
    ({ flag, then, otherwise }, ctx) =>
      ctx.flags[(flag as RichNode).text] ? (then as RichNode[]) : (otherwise as RichNode[]),
  ),
])

export const targets = ['tsx']
