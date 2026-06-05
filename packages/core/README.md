# @trast/core

Runtime engine for [Trast](../../README.md): the web-tree-sitter parser, the lazy
`RichNode` wrapper, comment attachment, zone splitting, the `Collection`, the scope
`Resolver`, and `createCodemodTransformer` (which runs a codemod as `magic-string` edits
with source maps). Compiled Trast codemods depend only on this package.

```ts
import { Collection, createCodemodTransformer, evaluate } from '@trast/core'
```

Grammars (`tree-sitter-javascript|typescript|html|css`) are **optional peer
dependencies** — install only the ones your targets use.
