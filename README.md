# Codegraft

> [!WARNING]
> **Work in progress.** Codegraft is pre-1.0 and unstable — the API can change without notice and it isn't battle-tested. Pin exact versions and expect breaking changes.

Codegraft rewrites source code with **codemods** — small programs that search a file's syntax tree and edit it. You write a codemod once, and Codegraft can apply it three ways: from your own code, inside your bundler (Vite, webpack, …), or as a one-shot CLI run over your file tree.

It is built on [tree-sitter](https://tree-sitter.github.io/) (via `web-tree-sitter`/WASM), so one API covers JavaScript, TypeScript, JSX/TSX, HTML, CSS, YAML, and `.vue` single-file components. Edits are applied as precise text patches with source maps — not a re-print of the whole file — so **code you don't touch keeps its exact formatting**.

- [Why would I want this?](#why-would-i-want-this)
- [Quick start](#quick-start)
- [Writing codemods](#writing-codemods)
- [Running codemods](#running-codemods)
- [Ready-made rules](#ready-made-rules-codegraftrules)
- [Packages](#packages)
- [How it compares to other tools](#how-it-compares-to-other-tools)
- [How it works](#how-it-works)
- [Development](#development)

## Why would I want this?

The motivating use case is **project scaffolding**. Tools like [Bati](https://batijs.dev/) generate projects from templates, and template code is full of feature-flag conditionals:

```tsx
// template code
if ($$.BATI.has("auth")) {
  return <Dashboard />
} else {
  return <Landing />
}
```

When a user generates a project *with* auth, a codemod collapses that whole block down to:

```tsx
return <Dashboard />
```

…and to `return <Landing />` without it. The generated project contains only the code for the features the user picked — no leftover flags, no dead branches.

But the engine is general. Anything that finds-and-edits syntax fits: registering a plugin into a `vite.config.ts`, removing unused imports, renaming an API across a codebase.

## Quick start

```bash
npm install -D @codegraft/codemod @codegraft/cli
```

A codemod is a function that receives the parsed file (`root`) and a context object (`ctx`, your build-time values), finds nodes, and edits them:

```ts
// collapse-flags.ts
import { defineCodemod } from '@codegraft/codemod'

export default defineCodemod({ namespace: '$$' }, (root, ctx) => {
  root.find('if_statement').forEach((node) => {
    const cond = node.field('condition')
    if (!cond.text.includes('$$')) return // not a build-time conditional — leave it alone
    if (cond.evaluate(ctx)) {
      // condition is true: keep the body, drop the if/else around it
      node.unwrap(node.field('consequence').children())
    } else {
      // condition is false: keep the else body if there is one, otherwise delete
      const alt = node.field('alternative')
      if (alt.size() === 0) node.remove()
      else node.unwrap(alt.find('statement_block').first().children())
    }
  })
})

export const targets = ['tsx'] // the file types this codemod handles
```

Run it over your source tree:

```bash
codegraft run "src/**/*.tsx" --codemod ./collapse-flags.ts --context '{"flags":{"auth":true}}' --in-place
```

Every `if ($$.flags.auth) { … }` in `src/` collapses to the winning branch. Use `--dry-run` to preview or `--out-dir` to write the results elsewhere.

## Writing codemods

The API (from `@codegraft/codemod`) is a collection over the syntax tree, modelled on [jscodeshift](https://github.com/facebook/jscodeshift): `find` nodes, navigate from them, edit them. Everything hangs off `root` and `ctx`.

| Group | Methods |
|---|---|
| **Query** | `find` (by node type, with optional field matchers), `filter`, `closest`, `parent`, `children`, `siblings` / `nextSibling` / `prevSibling`, `ancestors`, `closestScope`, `first` / `at`, `isOfType` / `getTypes` |
| **Edit** | `replaceWith` (a string or `(node) => string`), `setField`, `remove`, `unwrap`, `wrap`, `moveBefore` / `moveAfter` |
| **Insert** | `insertBefore` / `insertAfter`, `append` / `prepend`, `ensureImport`, the grammar-validated `` code`…` `` template |
| **Scope** | `references`, `definition`, `lookup`, `bindingsInScope` (JS/TS/TSX only) |
| **Comments** | `addLeadingComment` / `addTrailingComment`, `removeComments`, `mapLeadingComment`, the `directive` / `dropDirective` gates |

Node types and field names are tree-sitter's own (`call_expression`, field `function`) — there is no Babel-style alias layer.

### Inserting code

Insertion is the thing declarative pattern tools can't do. For example, registering a Vite plugin idempotently:

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

### Evaluating conditions

`node.evaluate(ctx)` computes a `$$`-rooted expression against your context value — without `eval`. The namespace root resolves to `ctx`, so `$$.BATI.has("auth")` runs `ctx.BATI.has("auth")`, and `!`, `&&`, `||`, and comparisons compose as in JavaScript:

```ts
node.field('condition').evaluate(ctx) // $$.BATI.has("a") && !$$.BATI.has("b") → boolean
```

If a condition isn't pure over the context — it references a runtime variable, or uses an unsupported operator — evaluation throws and names the offending node rather than guessing.

For conditions written in comments, `evaluateExpression(string, ctx)` evaluates captured text. Combined with the `directive` gate, this lets a comment control whether a declaration survives:

```ts
// source:
//   // $$.BATI.has("auth")
//   const session = createSession()

root.find('lexical_declaration').forEach((decl) => {
  const m = decl.directive(/\$\$[^\n]*/)
  if (!m) return
  decl.dropDirective(/\$\$/)
  if (!decl.evaluateExpression(m[0], ctx)) decl.remove()
})
```

### Scope: confident or abstain

`references()` and `definition()` resolve identifiers through the scope tree, but they **never guess**: if the file contains a construct they can't fully model (`with`, `eval`, a TS namespace or ambient module, an object shorthand), they return `null` instead of a wrong answer. So a rename never fires on a guess:

```ts
root.find('identifier', { text: 'oldName' }).forEach((id) => {
  id.references()?.replaceWith('newName') // null → abstain, leave it alone
})
```

Scope resolution covers JS/TS/TSX; other languages always return `null`.

### Type-checked node names

The node-type and field-name strings are typed against the installed grammars — a typo like `find('if_statment')` is a compile error, and you get autocomplete for every node type across JS/TS/TSX, HTML, CSS, and YAML. The unions are generated from each grammar's `node-types.json`.

`Collection` is generic over the grammar and defaults to all of them. Annotate `root` to narrow to one grammar's vocabulary; the narrowing carries through navigation:

```ts
defineCodemod((root: Collection<'tsx'>) => {
  root.find('jsx_element').field('name')   // ✓ tsx, narrowed all the way down
  root.find('type_identifier')             // ✓ tsx includes the TS type grammar
})
defineCodemod((root: Collection<'javascript'>) => {
  root.find('type_identifier')             // ✗ compile error — TS-only node type in a JS codemod
})
```

(A `ZoneSplitter` that introduces a grammar outside the built-in set casts — `find('astro_frontmatter' as NodeType)` — until its types are generated.)

### The `$$` namespace

Build-time conditions reference your values through a single namespace — `$$` by default, configurable via `defineCodemod({ namespace: … })`. Two things make this pleasant:

**Your shape, typed once.** Declare the namespace globally and every source file type-checks with no import:

```ts
// codegraft-env.d.ts
declare global {
  const $$: { BATI: { has(feature: string): boolean } }
}
export {}
```

```ts
// any source file — type-checks today, collapses at build time:
if ($$.BATI.has("auth")) doThis() else doThat()
```

**Free skip for untouched files.** Declaring the namespace also enables a scan-gate: a file that never mentions `$$` is returned untouched without even being parsed. Pick a name distinctive enough to rarely appear by accident.

## Running codemods

The same codemod runs in three settings. In every one of them the codemod's actual function runs live, so it can use module-scope helpers, imports, and npm dependencies — there is no compile/serialize step.

**Programmatic** — the context is your namespace value, functions and all:

```ts
import codemod from './collapse-flags'

const transform = await codemod.forTarget('tsx')
transform.transform(source, { BATI: { has: (f) => enabled.has(f) } })
```

**Inside a bundler** (`@codegraft/unplugin`) — transforms run as part of the build:

```ts
// vite.config.ts
import codegraft from '@codegraft/unplugin/vite'
import { vueSplitter } from '@codegraft/vue'
import codemod from './collapse-flags'

export default {
  plugins: [codegraft({ codemod, context: { BATI: { has: (f) => enabled.has(f) } }, splitters: [vueSplitter] })],
}
```

`/rollup`, `/rolldown`, `/esbuild`, `/webpack`, `/rspack`, and `/farm` entries also exist.

**CLI** — a one-shot, on-disk refactor (the jscodeshift use case):

```bash
codegraft run "src/**/*.tsx" --codemod ./collapse-flags.ts --context '{"flags":{"auth":true}}' --in-place
```

One caveat: `--context` is JSON, so the CLI suits a *data-shaped* namespace (`$$.flags.auth`, comparisons). A method-valued namespace like `$$.BATI.has(...)` can't be expressed as JSON — use the programmatic API or the bundler plugin for those.

## Ready-made rules (`@codegraft/rules`)

ESLint-rule-style transforms, authored with `defineCodemod` and shipped tree-shakeable — one rule per module, so importing one drops the rest.

The first rule is **`removeUnusedImports`** (the analogue of `eslint-plugin-unused-imports` plus the import half of `@typescript-eslint/consistent-type-imports`). It:

- removes imports that nothing references;
- rewrites a value import used only in type positions into a type import (`import { Foo }` + `let v: Foo` → `import type { Foo }`);
- removes unused `import type` too.

Like the scope resolver it leans on, it is confident-or-abstain: it never removes a side-effect import (`import 'x'`), and it skips a whole file it can't model (`with` / `eval` / a TS namespace / ambient module) rather than risk a wrong removal.

A rule is grammar-agnostic — the same definition runs against any JS-family grammar, and on the `<script>` of a `.vue` file through a splitter:

```ts
import { removeUnusedImports } from '@codegraft/rules'
import { vueSplitter } from '@codegraft/vue'

// programmatic — one target at a time
const transform = await removeUnusedImports.forTarget('tsx')
transform.transform(source, {})

// Vue SFC — prunes the <script>, but keeps imports used only from the template
// (a <Tag>, a v-directive, or an interpolation/binding expression)
const vue = await removeUnusedImports.forTarget(vueSplitter)
```

Each rule is also a ready codemod module, so the CLI applies it directly — `.vue` `<script>` included, via the CLI's built-in splitter:

```bash
codegraft run "src/**/*.{ts,tsx,vue}" --codemod @codegraft/rules/remove-unused-imports --in-place
```

In a bundler, hand it to `@codegraft/unplugin` like any other codemod.

## Packages

| Package | What it's for |
|---|---|
| **`@codegraft/codemod`** | Authoring codemods: `defineCodemod` and the collection API. **Start here.** |
| **`@codegraft/cli`** | `codegraft run` — apply a codemod over a file tree, one-shot. |
| **`@codegraft/unplugin`** | Apply codemods inside a bundler — Vite / Rollup / Rolldown / esbuild / webpack / Rspack / Farm. |
| **`@codegraft/rules`** | Ready-made codemods, e.g. `removeUnusedImports`. |
| **`@codegraft/vue`** | `vueSplitter` — splits a `.vue` SFC into `<template>` / `<script>` / `<style>` zones. |
| **`@codegraft/core`** | The engine underneath: parser, comment attachment, zone splitting, scope resolver, edit application. You rarely import it directly. |

## How it compares to other tools

Codegraft's `find` → navigate → edit shape is modelled on jscodeshift, so the API reads familiarly. The engines differ on a few axes:

| Tool | Foundation | Languages | Authoring | Output | Type-aware |
|---|---|---|---|---|---|
| **Codegraft** | tree-sitter (CST) | JS / TS / TSX, HTML, CSS, YAML, `.vue` | imperative collection | byte-range edits + source maps | no (syntactic) |
| [jscodeshift](https://github.com/facebook/jscodeshift) | Babel + recast (AST) | JS / TS / JSX / Flow | imperative collection + typed builders | recast reprint | no |
| [ts-morph](https://ts-morph.com/) | TypeScript compiler | TS / JS | imperative, typed | compiler reprint | **yes** (full type checker) |
| [Babel](https://babeljs.io/) plugins | Babel (AST) | JS / TS / JSX | visitor plugins | regenerate (recast optional) | no |
| [ast-grep](https://ast-grep.github.io/) | tree-sitter (Rust) | many | declarative patterns + YAML rules | pattern fix | no |

Picking between them:

- **Need type information or cross-file refactors** (semantic rename, follow a symbol through the program)? Use **ts-morph** — it runs the real TypeScript checker. Codegraft is purely syntactic and single-file; its scope queries abstain rather than guess.
- **JS-only transforms, with an existing corpus to reuse**? **jscodeshift** or **Babel**. Their typed builders construct nodes that are valid by construction; Codegraft builds with the `` code`…` `` template, which validates snippets against the grammar but isn't a typed node API.
- **Fast declarative search-and-replace by pattern**? **ast-grep**. Codegraft chose an imperative collection instead, for insertion and navigation that patterns can't express.
- **Codegraft's niche**: real grammars across the JS family *and* HTML/CSS/Vue in one API, byte-exact edits with source maps, comment-directive–gated edits, and running the same codemod inside a bundler as well as one-shot over your source.

## How it works

`splitAndParse` turns a target into parsed zones — a plain file is one zone; a `ZoneSplitter` makes one per SFC section. Comments are attached to nodes, then your codemod runs against a `Collection` over each zone's tree, recording edits. Edits are applied through `magic-string`, which keeps source maps precise. A narrow-delete like `unwrap` keeps the retained range editable, so nested conditionals collapse in a single pass.

### Formatting: syntactic validity, nothing more

Untouched code keeps its exact bytes — there is no reprint step to disturb it. For the text an edit *does* produce, a small formatter renders just enough for the result to parse, and leaves cosmetics to whatever formatter you already run (Prettier, Biome, …):

- an inserted snippet is re-indented to its anchor line, preserving its own internal indentation, with line breaks normalized to the source's EOL;
- `append` / `prepend` give the new element its container's separator (a `,` / `;` / line break) so it parses;
- `remove` is a plain delete; `{ separator: true }` also drops the element's delimiter — no `[1, , 3]` hole, no blank line where a statement sat.

Beyond that it does **no** cosmetic layout — an appended element isn't reflowed onto its own line, for instance. That's deliberate: Codegraft isn't a formatter, and staying out of layout keeps the engine small and free of style opinions that would fight your Prettier/Biome config.

## Development

```bash
pnpm install
pnpm build     # tsc -b (project references)
pnpm test      # vitest
```

Requires Node ≥ 22.13 and pnpm 11.

The node-type/field unions in `@codegraft/core/src/generated/node-types.ts` are checked in; regenerate with `pnpm --filter @codegraft/core regen-node-types` (CI fails if a regen is owed). It reads javascript/html/css types from their npm packages, typescript/tsx from the vendored `node-types.json` that `regen-ts-wasm` writes (it builds only the tsx wasm — the runtime grammar for the whole JS/TS/TSX family — but vendors both node-types so the per-grammar typings stay distinct), and yaml from the vendored copy alongside the `tree-sitter-yaml` wasm.
