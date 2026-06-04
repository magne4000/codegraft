# @trast/match

Rule authoring for [Trast](../../README.md): the `match` builder, `defineRules`, and the
template-literal pattern parser. It compiles a rule to **plain data** (a `PatternNode`
tree + a `RegExp`) plus the user's rewrite function — `@trast/core` turns that into
runtime behaviour, so one matcher serves both dev and compiled modes.

```ts
import { defineRules, match } from '@trast/match'

export default defineRules<{ features: string[] }>((match) => [
  match.tsx.expr`if (BATI.has($f)) { $$$then } else { $$$otherwise }`.rewrite(/* … */),
])
```
