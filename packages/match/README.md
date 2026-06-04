# @trast/match

Rule authoring for [Trast](../../README.md): the `match` builder, `defineRules`, and the
template-literal pattern parser. It compiles a rule to **plain data** (a `PatternNode`
tree + a `RegExp`) plus the user's rewrite function — `@trast/core` turns that into
runtime behaviour, so one matcher serves both dev and compiled modes.

```ts
import { defineRules } from '@trast/match'
import type { RichNode } from '@trast/core'

export default defineRules<{ BATI: { has(f: string): boolean } }>({ namespace: '$$' }, (match) => [
  match.tsx.expr`if ($cond) { $$$then } else { $$$otherwise }`
    .where(({ cond }) => (cond as RichNode).text.includes('$$'))
    .rewrite(/* ({ cond, then, otherwise }, ctx) => evaluate(cond, ctx) ? then : otherwise */),
])
```

`namespace` opts the set into the `$$` build-time marker — enabling the source-scan
optimisation — and `ctx` is its value (see the root README for the full model).
