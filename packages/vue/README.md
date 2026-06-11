# @codegraft/vue

Vue SFC support for [Codegraft](../../README.md). `vueSplitter` splits a `.vue` file into
zones so a Codegraft codemod applies per section:

| Section | Grammar |
|---|---|
| `<template>` | `vue` (+ one `typescript` zone per embedded expression) |
| `<script>` / `<script setup>` | `typescript` / `tsx` / `javascript` (by `lang`) |
| `<style>` | `css` (+ one `typescript` zone per `v-bind()` argument) |

The `<template>` is parsed with the **vue** grammar (not `html`), so a codemod matches its structure
directly — `interpolation`, `directive_attribute` (`directive_name` / `directive_value` /
`attribute_value`), component `tag_name`. The grammar's node types are generated into Codegraft's
typed unions, so `find('directive_attribute')` autocompletes and type-checks like any other.

Every JS expression embedded in the template — interpolation bodies, directive values, and dynamic
arguments (`:[expr]`) — additionally becomes its own `typescript` zone, so the same codemod sees real
`identifier` / `member_expression` / … nodes inside the template (use-detection, `$$` collapse,
migrations) rather than opaque text. `v-for` contributes only its iterable (the alias is a
template-local) and `v-slot` patterns are skipped (locals, not references). These zones overlap the
structural `vue` zone — structure edits land on the vue nodes, expression edits on the `typescript`
ones; a value that is a bare object literal (`:class="{ a: x }"`) parses in statement position as a
block, so identifiers inside it still surface but structural edits targeting the object won't match.

A `<style>` likewise yields a `typescript` zone per `v-bind()` argument (`color: v-bind(themeColor)`),
covering both the bare and quoted (`v-bind('a + "b"')`) forms — so a binding referenced only from CSS
is seen as used too.

```ts
import { vueSplitter } from '@codegraft/vue'

const transform = await codemod.forTarget(vueSplitter)
// or, in @codegraft/unplugin:  codegraft({ codemod, context, splitters: [vueSplitter] })
```

## Vendored grammar wasm

No vue grammar ships a prebuilt WebAssembly, so `wasm/tree-sitter-vue.wasm` is
**vendored** here — WASI-built from the maintained
[`tree-sitter-grammars/tree-sitter-vue`](https://github.com/tree-sitter-grammars/tree-sitter-vue)
(MIT). The package owns its grammar with no `tree-sitter-vue` dependency.

To regenerate it (WASI via `tree-sitter-cli`'s bundled wasi-sdk — no Docker/emscripten;
needs network):

```bash
pnpm --filter @codegraft/vue regen-wasm        # or: regen-wasm <git-ref>
```

WASI matters: `web-tree-sitter` ≥ 0.26 only loads WASI-built grammars, and the older
`tree-sitter-wasms` (emscripten) build is rejected.
