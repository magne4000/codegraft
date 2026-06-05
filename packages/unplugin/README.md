# @codegraft/unplugin

Apply [Codegraft](../../README.md) transforms inside a bundler, via
[unplugin](https://github.com/unjs/unplugin) — Vite, Rollup, Rolldown, esbuild, webpack,
Rspack, Farm.

```ts
// vite.config.ts
import codegraft from '@codegraft/unplugin/vite'
import codemod from './bati-codemod'

export default {
  plugins: [codegraft({ codemod, context: { BATI: { has: (f) => f === 'auth' } } })],
}
```

Options: `{ codemod, context, splitters?, include?, exclude? }`. Pass `splitters: [vueSplitter]`
(from `@codegraft/vue`) to handle `.vue`. Emits `{ code, map }`.
