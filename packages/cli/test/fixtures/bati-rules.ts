import { defineRules } from '@trast/match'
import type { RichNode } from '@trast/core'

// A minimal Bati-style rule set used by the build/parity tests.
export default defineRules<{ features: string[] }>((match) => [
  match.tsx.expr`if (BATI.has($feature)) { $$$then } else { $$$otherwise }`.rewrite(
    ({ feature, then, otherwise }, ctx) =>
      ctx.features.includes((feature as RichNode).text.slice(1, -1))
        ? (then as RichNode[])
        : (otherwise as RichNode[]),
  ),
])

export const targets = ['tsx']
