# Trast

Structural, build-time code transformation built on [tree-sitter](https://tree-sitter.github.io/) (via `web-tree-sitter`/WASM). You author **codemods** — a jscodeshift-style collection API that finds, navigates, edits, and inserts over the syntax tree — and Trast applies them as precise text edits (with source maps). The motivating use case is collapsing scaffolding conditionals — e.g. [Bati](https://batijs.dev/)'s feature flags — but the engine is general.

```ts
// in:  if ($$.BATI.has("auth")) { return <Dashboard /> } else { return <Landing /> }
// out, given { BATI: { has: (f) => f === "auth" } }:  return <Dashboard />
// out, given { BATI: { has: () => false } }:          return <Landing />
```

## Packages

| Package | Role |
|---|---|
| **`@trast/core`** | Runtime engine: parser, `RichNode`, comment attachment, zone splitting, the `Collection`, scope `Resolver`, edit application (magic-string), `createCodemodTransformer`, `evaluate`. |
| **`@trast/codemod`** | Authoring: `defineCodemod` — a jscodeshift-style collection API (find / navigate / edit / insert / scope). |
| **`@trast/cli`** | `trast build` (compile a codemod to standalone modules) and `trast run` (apply to files). |
| **`@trast/unplugin`** | Apply transforms inside a bundler — Vite / Rollup / Rolldown / esbuild / webpack / Rspack / Farm. |
| **`@trast/vue`** | `vueSplitter` — split a `.vue` SFC into `<template>`/`<script>`/`<style>` zones. |

Dependency graph: `@trast/core ← @trast/codemod ← @trast/cli`, and `@trast/core ← {@trast/vue, @trast/unplugin}`.

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

Declaring the namespace (in `defineCodemod({ namespace: '$$' }, …)`) also enables a **scan-gate**: a file that never mentions `$$` is returned untouched without being parsed, so only files that opt in pay for a parse. Pick a name distinctive enough to rarely appear by accident.

## Codemod API (`@trast/codemod`)

The authoring surface: a jscodeshift-style collection over the CST that records magic-string edits. `find`/`filter`/`closest`/`parent`/`children` query; `replaceWith`/`remove`/`unwrap` edit; `insertBefore`/`insertAfter`/`append`/`prepend`/`ensureImport` insert; `references`/`definition` resolve bindings (JS/TS/TSX). Everything hangs off `root`/`ctx`, so a codemod serialises for `trast build`.

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

### Evaluating a condition

`node.evaluate(ctx)` (and `node.evaluateExpression(string, ctx)` for a directive comment's captured text) computes a `$$`-rooted expression against the context value, without `eval`: the identifier root resolves to `ctx`, so `$$.BATI.has("auth")` is `ctx.BATI.has("auth")`, and `!` / `&&` / `||` / comparisons compose as in JS. So a compound condition needs no codemod-specific logic:

```ts
node.field('condition').evaluate(ctx) // e.g. $$.BATI.has("a") && !$$.BATI.has("b") → boolean
```

A condition that isn't pure over the context (a runtime variable, an unsupported operator) asserts and names the offending node, rather than evaluating wrong.

## Compared to jscodeshift

The collection shape — `find` → navigate → edit — is modelled on [jscodeshift](https://github.com/facebook/jscodeshift), so the API reads familiarly. The engines differ underneath:

| | jscodeshift | Trast |
|---|---|---|
| Parser | Babel + recast (AST) | tree-sitter / WASM (CST) |
| Languages | JS / TS / JSX / TSX / Flow | JS / TS / TSX, HTML, CSS, and SFC zones (`.vue`) |
| Vocabulary | Babel node types + typed builders (`j.identifier(…)`) | the grammar's own node types and fields; new code is inserted as **text** |
| Output | recast reprints each changed node from the AST | `magic-string` edits only the touched byte ranges, with **source maps** |
| Scope / bindings | full `path.scope` analysis (ast-types) | `references()` / `definition()`, **confident-or-abstain** (syntactic, JS/TS/TSX only) |
| Distribution | one-shot CLI runner | `trast run`, plus **compile-ahead** (`trast build`) and bundler (`@trast/unplugin`) |
| Ecosystem | large, established corpus of codemods | new |

Where each fits:

- **jscodeshift is stronger** when you need typed AST construction (builders yield structurally valid nodes; Trast inserts raw strings, checked only when re-parsed), type-aware scope analysis, or an existing codemod to reuse.
- **Trast is stronger** when you need more than the JS family (CSS/HTML/Vue in one tool), byte-exact output with source maps (recast can reflow the subtree it reprints), comment-directive–gated edits, or to ship the transform into a build/bundler step instead of running it once.
- **The scope models differ by intent.** jscodeshift resolves a binding and leaves the decision to you; Trast returns `null` for any construct it can't model syntactically, so a rename never fires on a guess — fewer renames, but no wrong ones.

## Using it

**Dev mode** (no build step) — the context is your namespace value, functions and all:

```ts
import codemod from './bati-codemod'
const transform = await codemod.forTarget('tsx')
transform.transform(source, { BATI: { has: (f) => enabled.has(f) } })
```

**Bundler** (`@trast/unplugin`):

```ts
// vite.config.ts
import trast from '@trast/unplugin/vite'
import { vueSplitter } from '@trast/vue'
import codemod from './bati-codemod'

export default {
  plugins: [trast({ codemod, context: { BATI: { has: (f) => enabled.has(f) } }, splitters: [vueSplitter] })],
}
```

(`/rollup`, `/rolldown`, `/esbuild`, `/webpack`, `/rspack`, `/farm` entries also exist.)

**CLI:**

```bash
trast build bati-codemod.ts --output dist/    # emit dist/<target>.js (+ barrel)
trast run "src/**/*.tsx" --transformer dist/index.js --context '{"flags":{"auth":true}}' --in-place
```

`--context` is JSON, so the CLI suits a **data-shaped** namespace (`$$.flags.auth`, comparisons). A method-valued namespace like `$$.BATI.has(...)` can't be expressed as JSON — supply it through the programmatic API (dev mode / unplugin) instead.

## How it works

`splitAndParse` turns a target into parsed zones (a single grammar → one zone; a `ZoneSplitter` → one per SFC section). Comments are attached to nodes, then your codemod runs against a `Collection` over every zone's tree, recording edits. Edits go through `magic-string` (so source maps stay precise); a narrow-delete like `unwrap` keeps the retained range editable, so nested conditionals collapse in one pass. Whitespace clean-up is left to Prettier.

Because a codemod body is **param-rooted** (everything hangs off `root`/`context`), its `.toString()` is self-contained: `trast build` emits one module per target that depends only on `@trast/core` (via `createCodemodTransformer`) — the authoring package never ships to consumers.

## Development

```bash
pnpm install
pnpm build     # tsc -b (project references)
pnpm test      # vitest
```

Requires Node ≥ 22.13 and pnpm 11.
