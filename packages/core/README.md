# @codegraft/core

Runtime engine for [Codegraft](../../README.md): the web-tree-sitter parser, the lazy
`RichNode` wrapper, comment attachment, zone splitting, the `Collection`, the scope
`Resolver`, and `createCodemodTransformer` (which runs a codemod as `magic-string` edits
with source maps). Compiled Codegraft codemods depend only on this package.

```ts
import { Collection, createCodemodTransformer, evaluate } from '@codegraft/core'
```

Every built-in grammar (JS/TS/TSX, HTML, CSS, YAML) **and the `web-tree-sitter` engine itself** ship
vendored here, so `@codegraft/core`'s only runtime dependency is `magic-string`: installing
`@codegraft/*` pulls no native `tree-sitter-*` package, no `web-tree-sitter` tarball, and needs no
C++ toolchain or `node-gyp` build. A `ZoneSplitter` for an external format still supplies its own
grammar wasm.
