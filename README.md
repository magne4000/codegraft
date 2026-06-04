# Trast

Structural, build-time code transformation built on [tree-sitter](https://tree-sitter.github.io/) (via `web-tree-sitter`/WASM). You author rules as **structural patterns + rewrite functions**; Trast matches them against the syntax tree and applies the rewrites as precise text edits (with source maps). The motivating use case is collapsing scaffolding conditionals — e.g. [Bati](https://batijs.dev/)'s `BATI.has("feature")` — but the engine is general.

```ts
// in:  if (BATI.has("auth")) { return <Dashboard /> } else { return <Landing /> }
// out (features: ["auth"]):  return <Dashboard />
// out (features: []):        return <Landing />
```

## Packages

| Package | Role |
|---|---|
| **`@trast/core`** | Runtime engine: parser, `RichNode`, comment attachment, zone splitting, matcher, edit application (magic-string), `createTransformer`. |
| **`@trast/match`** | Authoring: the `match` builder, `defineRules`, pattern compilation. Compiles a rule to **plain data** (`PatternNode` + `RegExp`) plus the user's rewrite. |
| **`@trast/cli`** | `trast build` (compile rules to standalone modules) and `trast run` (apply to files). |
| **`@trast/unplugin`** | Apply transforms inside a bundler — Vite / Rollup / Rolldown / esbuild / webpack / Rspack / Farm. |
| **`@trast/vue`** | `vueSplitter` — split a `.vue` SFC into `<template>`/`<script>`/`<style>` zones. |

Dependency graph: `@trast/core ← @trast/match ← @trast/cli`, and `@trast/core ← {@trast/vue, @trast/unplugin}`.

## Authoring rules

```ts
import { defineRules } from '@trast/match'
import { remove, type RichNode } from '@trast/core'

export default defineRules<{ features: string[] }>((match) => [
  // if (BATI.has("x")) { … } else { … }  → the taken branch
  match.tsx.expr`if (BATI.has($feature)) { $$$then } else { $$$otherwise }`.rewrite(
    ({ feature, then, otherwise }, ctx) =>
      ctx.features.includes((feature as RichNode).text.slice(1, -1))
        ? (then as RichNode[])
        : (otherwise as RichNode[]),
  ),
])

export const targets = ['tsx'] // for `trast build`
```

- **Patterns** are tagged templates: `match.<lang>.expr\`…\`` / `.type\`…\``, or `match.<lang>.node('type')`, or `match.any()`. `$x` captures a node, `$$$x` captures a run of siblings. Languages: `tsx`, `ts`, `js`, `html`, `css`.
- **`.where(captures => boolean)`** — a context-free match guard, e.g. to match only `if`s whose condition references `BATI` (so a structural `if (...)` pattern stays precise and nested conditionals aren't skipped).
- **`.whenLeadingComment(re)`** — gate on a directive comment (e.g. `// @bati auth`); the edit consumes the comment too.
- **`.rewrite((captures, ctx) => result)`** — return a captured node / array (kept, re-transformed in place), a string, or `remove`. `ctx` is typed via `defineRules<Ctx>`.

### Compound conditions

A structural pattern can't enumerate every `&&`/`||`/`!` shape, so capture the whole condition, gate with `.where`, and evaluate it in userland:

```ts
match.tsx.expr`if ($cond) { $$$then } else { $$$otherwise }`
  .where(({ cond }) => (cond as RichNode).text.includes('BATI.'))
  .rewrite(({ cond, then, otherwise }, ctx) =>
    evalBoolean(cond as RichNode, ctx.features) ? (then as RichNode[]) : (otherwise as RichNode[]))
```

`evalBoolean` is yours — recurse `parenthesized_expression`/`unary_expression`/`binary_expression` and resolve each `BATI.has("x")` leaf. Trast stays out of your domain semantics.

## Using it

**Dev mode** (no build step):

```ts
import rules from './bati-rules'
const transform = await rules.forTarget('tsx')
transform.transform(source, { features: ['auth'] })
```

**CLI:**

```bash
trast build bati-rules.ts --output dist/      # emit dist/<target>.js (+ barrel)
trast run "src/**/*.tsx" --transformer dist/index.js --context '{"features":["auth"]}' --in-place
```

**Bundler** (`@trast/unplugin`):

```ts
// vite.config.ts
import trast from '@trast/unplugin/vite'
import { vueSplitter } from '@trast/vue'
import rules from './bati-rules'

export default {
  plugins: [trast({ rules, context: { features: ['auth'] }, splitters: [vueSplitter] })],
}
```

(`/rollup`, `/rolldown`, `/esbuild`, `/webpack`, `/rspack`, `/farm` entries also exist.)

## How it works

`splitAndParse` turns a target into parsed zones (a single grammar → one zone; a `ZoneSplitter` → one per SFC section). Comments are attached to nodes, then a visitor walks each zone: the first rule to match (structurally + guard + comment gate) **claims** the node (outer-wins). A rewrite returning a kept subtree is transformed **in place** (the wrapper around it is removed and the kept nodes re-visited), so nesting collapses in one pass and source maps stay precise. Edits go through `magic-string`; whitespace clean-up is left to Prettier.

`@trast/match` compiles a rule to serialisable data + the rewrite's source, so `trast build` emits modules that depend only on `@trast/core` — the pattern parser never ships to consumers.

## Development

```bash
pnpm install
pnpm build     # tsc -b (project references)
pnpm test      # vitest
```

Requires Node ≥ 22.13 and pnpm 11.
