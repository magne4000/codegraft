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

`tree-sitter-vue` ships no prebuilt WebAssembly, so `wasm/tree-sitter-vue.wasm` is
**vendored** here — extracted from [`tree-sitter-wasms`](https://www.npmjs.com/package/tree-sitter-wasms),
which builds it from the MIT-licensed [`tree-sitter-vue`](https://github.com/ikatyang/tree-sitter-vue)
grammar. The package thus owns its grammar with no `tree-sitter-vue` dependency.

To regenerate the binary from source (the `tree-sitter` CLI uses Docker for the
emscripten toolchain):

```bash
# with the tree-sitter-vue grammar checked out / installed
npx tree-sitter@0.25 build --wasm <path-to-tree-sitter-vue> \
  --output packages/vue/wasm/tree-sitter-vue.wasm
```

The wasm is verified at load time against the `web-tree-sitter` runtime (grammar ABI 14).
