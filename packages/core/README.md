# @codegraft/core

Runtime engine for [Codegraft](../../README.md): the web-tree-sitter parser, the lazy
`RichNode` wrapper, comment attachment, zone splitting, the `Collection`, the scope
`Resolver`, and `createCodemodTransformer` (which runs a codemod as `magic-string` edits
with source maps). Compiled Codegraft codemods depend only on this package.

```ts
import { Collection, createCodemodTransformer, evaluate } from '@codegraft/core'
```

JavaScript, TypeScript, and TSX all parse with a vendored grammar bundled here (no peer
dependency); `tree-sitter-html` and `tree-sitter-css` are **optional peer dependencies** —
install them only if your targets include `.html` / `.css`.
