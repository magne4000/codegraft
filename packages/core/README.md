# @codegraft/core

Runtime engine for [Codegraft](../../README.md): the web-tree-sitter parser, the lazy
`RichNode` wrapper, comment attachment, zone splitting, the `Collection`, the scope
`Resolver`, and `createCodemodTransformer` (which runs a codemod as `magic-string` edits
with source maps). Compiled Codegraft codemods depend only on this package.

```ts
import { Collection, createCodemodTransformer, evaluate } from '@codegraft/core'
```

Grammars (`tree-sitter-javascript|typescript|html|css`) are **optional peer
dependencies** — install only the ones your targets use.
