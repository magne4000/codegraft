# @trast/core

Runtime engine for [Trast](../../README.md): the web-tree-sitter parser, the lazy
`RichNode` wrapper, comment attachment, zone splitting, the pattern matcher, and
`createTransformer` (which applies compiled rules as `magic-string` edits with source
maps). Compiled Trast transforms depend only on this package.

```ts
import { createTransformer, remove } from '@trast/core'
```

Grammars (`tree-sitter-javascript|typescript|html|css`) are **optional peer
dependencies** — install only the ones your targets use.
