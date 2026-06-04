# Trast

Structural, build-time code transformation built on [tree-sitter](https://tree-sitter.github.io/) (via `web-tree-sitter`/WASM). You author rules as **structural patterns + rewrite functions**; Trast matches them against the syntax tree and applies the rewrites as precise text edits (with source maps). The motivating use case is collapsing scaffolding conditionals — e.g. [Bati](https://batijs.dev/)'s feature flags — but the engine is general.

```ts
// in:  if ($$.BATI.has("auth")) { return <Dashboard /> } else { return <Landing /> }
// out, given { BATI: { has: (f) => f === "auth" } }:  return <Dashboard />
// out, given { BATI: { has: () => false } }:          return <Landing />
```

## Packages

| Package | Role |
|---|---|
| **`@trast/core`** | Runtime engine: parser, `RichNode`, comment attachment, zone splitting, the `Collection`, scope `Resolver`, edit application (magic-string), `createCodemodTransformer` / `createTransformer`, `evaluate`. |
| **`@trast/codemod`** | Authoring (primary): `defineCodemod` — a jscodeshift-style collection API (find / navigate / edit / insert / scope). |
| **`@trast/match`** | Authoring (declarative alternative): the `match` builder, `defineRules`, structural pattern templates. |
| **`@trast/cli`** | `trast build` (compile a codemod/rule set to standalone modules) and `trast run` (apply to files). |
| **`@trast/unplugin`** | Apply transforms inside a bundler — Vite / Rollup / Rolldown / esbuild / webpack / Rspack / Farm. |
| **`@trast/vue`** | `vueSplitter` — split a `.vue` SFC into `<template>`/`<script>`/`<style>` zones. |

Dependency graph: `@trast/core ← {@trast/codemod, @trast/match} ← @trast/cli`, and `@trast/core ← {@trast/vue, @trast/unplugin}`.

## The `$$` namespace

Conditions reference your build-time globals through a single namespace — `$$` by default, configurable. The **shape is yours**: type it once with a `declare global`, so source files type-check with no import, and the same name reads naturally inside directive comments.

```ts
// trast-env.d.ts
declare global {
  const $$: { BATI: { has(feature: string): boolean } }
}
export {}
```

```ts
// any source file — type-checked, collapsed at build:
if ($$.BATI.has("auth")) doThis() else doThat()
```

Declaring the namespace (in `defineCodemod({ namespace: '$$' }, …)` or `defineRules({ namespace: '$$' }, …)`) also enables a **scan-gate**: a file that never mentions `$$` is returned untouched without being parsed, so only files that opt in pay for a parse. Pick a name distinctive enough to rarely appear by accident.

## Codemod API (`@trast/codemod`)

The primary authoring surface: a jscodeshift-style collection over the CST that records magic-string edits. `find`/`filter`/`closest`/`parent`/`children` query; `replaceWith`/`remove`/`unwrap` edit; `insertBefore`/`insertAfter`/`append`/`prepend`/`ensureImport` insert; `references`/`definition` resolve bindings (JS/TS/TSX). Everything hangs off `root`/`ctx`, so a codemod serialises for `trast build`.

```ts
import { defineCodemod } from '@trast/codemod'

// Collapse build-time conditionals (the Bati case), nesting-safe:
export default defineCodemod<Ctx>({ namespace: '$$' }, (root, ctx) => {
  root.find('if_statement').forEach((node) => {
    const cond = node.field('condition')
    if (!cond.text.includes('$$')) return
    if (cond.evaluate(ctx)) node.unwrap(node.field('consequence').children())
    else node.remove()
  })
})
export const targets = ['tsx'] // for `trast build`
```

**Insertion** is the thing the template model can't do — e.g. register a Vite plugin idempotently:

```ts
export default defineCodemod((root) => {
  const plugins = root
    .find('call_expression', { function: 'defineConfig' })
    .find('pair', { key: 'plugins' }).find('array').first()
  if (plugins.size() && plugins.find('call_expression', { function: 'myPlugin' }).size() === 0) {
    plugins.append('myPlugin()')
    root.ensureImport("import myPlugin from 'my-plugin'")
  }
})
```

**Scope** (`node.references()` / `node.definition()`) is **confident-or-abstain**: it returns `null` rather than guess when a tree contains a construct it doesn't fully model (`with`, `eval`, a TS namespace/enum, an object shorthand), so a rename never fires on a guess. JS/TS/TSX only; other languages return `null`. Vocabulary is **tree-sitter-native** — node types and field names are the grammar's own (`call_expression`, field `function`), no Babel alias layer.

```ts
root.find('identifier', { text: 'oldName' }).forEach((id) => {
  id.references()?.replaceWith('newName') // null → abstain, leave it alone
})
```

## Declarative rules (`@trast/match`, alternative)

```ts
import { defineRules } from '@trast/match'
import { remove, evaluate, type RichNode } from '@trast/core'

type Ctx = { BATI: { has(feature: string): boolean } }
const usesNamespace = ({ cond }: { cond: unknown }) => (cond as RichNode).text.includes('$$')

export default defineRules<Ctx>({ namespace: '$$' }, (match) => [
  // if ($$.…) { … } else { … }  → the taken branch
  match.tsx.expr`if ($cond) { $$$then } else { $$$otherwise }`
    .where(usesNamespace)
    .rewrite(({ cond, then, otherwise }, ctx) =>
      evaluate(cond as RichNode, ctx) ? (then as RichNode[]) : (otherwise as RichNode[])),

  // // $$.…  above a declaration
  match.tsx
    .node('lexical_declaration')
    .whenLeadingComment(/\$\$[^\n]*/)
    .rewrite(({ node, commentMatch }, ctx) => (evaluate(commentMatch![0], ctx) ? node.text : remove)),
])

export const targets = ['tsx'] // for `trast build`
```

- **Patterns** are tagged templates: `match.<lang>.expr\`…\`` / `.type\`…\``, or `match.<lang>.node('type')`, or `match.any()`. `$x` captures a node, `$$$x` captures a run of siblings. Languages: `tsx`, `ts`, `js`, `html`, `css`.
- **`.where(captures => boolean)`** — a context-free match guard. Capture the whole condition with `$cond` and gate on the namespace, so a structural `if (...)` pattern stays precise and nested conditionals aren't skipped.
- **`.whenLeadingComment(re)`** — gate on a directive comment (e.g. `// $$.BATI.has("auth")`); the edit consumes the comment too. The capture is the expression `evaluate` then decides.
- **`.rewrite((captures, ctx) => result)`** — return a captured node / array (kept, re-transformed in place), a string, or `remove`. `ctx` is the namespace value, typed via `defineRules<Ctx>`.

### `evaluate` — deciding a condition

`evaluate(condition, ctx)` computes a `$$`-rooted expression against the context value, without `eval`: the identifier root resolves to `ctx`, so `$$.BATI.has("auth")` is `ctx.BATI.has("auth")`, and `!` / `&&` / `||` / comparisons compose as in JS. It takes a captured node (an `if`/ternary condition) or a string (a comment's expression). So compound conditions need no rule-specific logic:

```ts
evaluate(/* $$.BATI.has("a") && !$$.BATI.has("b") */ cond, ctx) // → boolean
```

A condition that isn't pure over the context (a runtime variable, an unsupported operator) asserts and names the offending node, rather than evaluating wrong.

## Using it

**Dev mode** (no build step) — the context is your namespace value, functions and all:

```ts
import rules from './bati-rules'
const transform = await rules.forTarget('tsx')
transform.transform(source, { BATI: { has: (f) => enabled.has(f) } })
```

**Bundler** (`@trast/unplugin`):

```ts
// vite.config.ts
import trast from '@trast/unplugin/vite'
import { vueSplitter } from '@trast/vue'
import rules from './bati-rules'

export default {
  plugins: [trast({ rules, context: { BATI: { has: (f) => enabled.has(f) } }, splitters: [vueSplitter] })],
}
```

(`/rollup`, `/rolldown`, `/esbuild`, `/webpack`, `/rspack`, `/farm` entries also exist.)

**CLI:**

```bash
trast build bati-rules.ts --output dist/      # emit dist/<target>.js (+ barrel)
trast run "src/**/*.tsx" --transformer dist/index.js --context '{"flags":{"auth":true}}' --in-place
```

`--context` is JSON, so the CLI suits a **data-shaped** namespace (`$$.flags.auth`, comparisons). A method-valued namespace like `$$.BATI.has(...)` can't be expressed as JSON — supply it through the programmatic API (dev mode / unplugin) instead.

## How it works

`splitAndParse` turns a target into parsed zones (a single grammar → one zone; a `ZoneSplitter` → one per SFC section). Comments are attached to nodes, then a visitor walks each zone: the first rule to match (structurally + guard + comment gate) **claims** the node (outer-wins). A rewrite returning a kept subtree is transformed **in place** (the wrapper around it is removed and the kept nodes re-visited), so nesting collapses in one pass and source maps stay precise. Edits go through `magic-string`; whitespace clean-up is left to Prettier.

`@trast/match` compiles a rule to serialisable data + the rewrite's source (and the `@trast/core` helpers it references, like `evaluate`), so `trast build` emits modules that depend only on `@trast/core` — the pattern parser never ships to consumers.

## Development

```bash
pnpm install
pnpm build     # tsc -b (project references)
pnpm test      # vitest
```

Requires Node ≥ 22.13 and pnpm 11.
