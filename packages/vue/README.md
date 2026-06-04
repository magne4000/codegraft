# @trast/vue

Vue SFC support for [Trast](../../README.md). `vueSplitter` splits a `.vue` file into
zones so Trast rules apply per section:

| Section | Grammar |
|---|---|
| `<template>` | `html` |
| `<script>` / `<script setup>` | `typescript` / `tsx` / `javascript` (by `lang`) |
| `<style>` | `css` |

```ts
import { vueSplitter } from '@trast/vue'

const transform = await rules.forTarget(vueSplitter)
// or, in @trast/unplugin:  trast({ rules, context, splitters: [vueSplitter] })
```

## Vendored grammar wasm

No vue grammar ships a prebuilt WebAssembly, so `wasm/tree-sitter-vue.wasm` is
**vendored** here — WASI-built from the maintained
[`tree-sitter-grammars/tree-sitter-vue`](https://github.com/tree-sitter-grammars/tree-sitter-vue)
(MIT). The package owns its grammar with no `tree-sitter-vue` dependency.

To regenerate it (WASI via `tree-sitter-cli`'s bundled wasi-sdk — no Docker/emscripten;
needs network):

```bash
pnpm --filter @trast/vue regen-wasm        # or: regen-wasm <git-ref>
```

WASI matters: `web-tree-sitter` ≥ 0.26 only loads WASI-built grammars, and the older
`tree-sitter-wasms` (emscripten) build is rejected.
