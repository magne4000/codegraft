# Trast

> [!WARNING]
> **Work in progress.** Trast is pre-1.0 and unstable — the API can change without notice and it isn't battle-tested. Pin exact versions and expect breaking changes.

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

The authoring surface: a jscodeshift-style collection over the CST that records magic-string edits, everything hanging off `root`/`ctx` so a codemod serialises for `trast build`.

- **Query** — `find` (a concrete type or a grammar supertype; field matchers can nest), `filter`, `closest`, `parent`, `children`, `siblings`/`nextSibling`/`prevSibling`, `ancestors`, `closestScope`, `first`/`at`, `isOfType`/`getTypes`.
- **Edit** — `replaceWith` (a string or `(node) => string`), `setField`, `remove`, `unwrap`, `wrap`, `moveBefore`/`moveAfter`.
- **Insert** — `insertBefore`/`insertAfter`, `append`/`prepend`, `ensureImport`; build the text with the grammar-validated `` code`…` ``.
- **Scope** (JS/TS/TSX, confident-or-abstain) — `references`, `definition`, `lookup`, `bindingsInScope`.
- **Comments** — `addLeadingComment`/`addTrailingComment`, `removeComments`, `mapLeadingComment`, plus the `directive`/`dropDirective` gates.

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

**Scope** (`references`/`definition`, plus `lookup`/`bindingsInScope`) is **confident-or-abstain**: it returns `null` rather than guess when a tree contains a construct it doesn't fully model (`with`, `eval`, a TS namespace or ambient module, an object shorthand), so a rename never fires on a guess. JS/TS/TSX only; other languages return `null`. Vocabulary is **tree-sitter-native** — node types and field names are the grammar's own (`call_expression`, field `function`), no Babel alias layer.

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

## Compared to other tools

Trast's collection shape — `find` → navigate → edit — is modelled on [jscodeshift](https://github.com/facebook/jscodeshift), so that API reads familiarly. Across the wider landscape the engines differ on a few axes:

| Tool | Foundation | Languages | Authoring | Output | Type-aware |
|---|---|---|---|---|---|
| **Trast** | tree-sitter (CST) | JS / TS / TSX, HTML, CSS, `.vue` | imperative collection | byte-range edits + source maps | no (syntactic) |
| [jscodeshift](https://github.com/facebook/jscodeshift) | Babel + recast (AST) | JS / TS / JSX / Flow | imperative collection + typed builders | recast reprint | no |
| [ts-morph](https://ts-morph.com/) | TypeScript compiler | TS / JS | imperative, typed | compiler reprint | **yes** (full type checker) |
| [Babel](https://babeljs.io/) plugins | Babel (AST) | JS / TS / JSX | visitor plugins | regenerate (recast optional) | no |
| [ast-grep](https://ast-grep.github.io/) | tree-sitter (Rust) | many | declarative patterns + YAML rules | pattern fix | no |

Picking between them:

- **Type-aware or cross-file refactors** (semantic rename, follow a symbol through the program) → **ts-morph**, which runs the real TypeScript checker. Trast is purely syntactic and single-file; its `references()`/`definition()` **abstain** (return `null`) on anything they can't resolve from the CST alone, so a rename never fires on a guess.
- **JS-family transforms with an existing corpus to reuse** → **jscodeshift** / **Babel**. Their *typed* builders construct nodes that are valid by construction; Trast builds with the `` code`…` `` template, which validates the snippet against the grammar (it just isn't a typed node API).
- **Fast declarative search-lint-rewrite by pattern** → **ast-grep** (or GritQL) — close in spirit to Trast's removed `expr` rules; Trast chose an imperative collection instead, for insertion and navigation that patterns can't express.
- **Trast's niche**: real grammars across the JS family *and* HTML/CSS/Vue in one API, byte-exact edits with source maps (recast/Babel reprint the subtree they touch), comment-directive–gated edits, and shipping the transform **into a build step** (`trast build`) or **bundler** (`@trast/unplugin`) rather than running it once.

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
