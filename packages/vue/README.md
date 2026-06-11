# @codegraft/vue

Vue SFC support for [Codegraft](../../README.md). `vueSplitter` splits a `.vue` file into
zones so a Codegraft codemod applies per section:

| Section | Grammar |
|---|---|
| `<template>` | `vue` |
| `<script>` / `<script setup>` | `typescript` / `tsx` / `javascript` (by `lang`) |
| `<style>` | `css` |

The `<template>` is parsed with the **vue** grammar (not `html`), so a codemod matches its structure
directly — `interpolation`, `directive_attribute` (`directive_name` / `directive_value` /
`attribute_value`), component `tag_name`. The grammar's node types are generated into Codegraft's
typed unions, so `find('directive_attribute')` autocompletes and type-checks like any other. (Embedded
template *expressions* are still opaque text inside those nodes — parsing them as JS is a later tier.)

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
