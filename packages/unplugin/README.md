# @trast/unplugin

Apply [Trast](../../README.md) transforms inside a bundler, via
[unplugin](https://github.com/unjs/unplugin) — Vite, Rollup, Rolldown, esbuild, webpack,
Rspack, Farm.

```ts
// vite.config.ts
import trast from '@trast/unplugin/vite'
import codemod from './bati-codemod'

export default {
  plugins: [trast({ codemod, context: { BATI: { has: (f) => f === 'auth' } } })],
}
```

Options: `{ codemod, context, splitters?, include?, exclude? }`. Pass `splitters: [vueSplitter]`
(from `@trast/vue`) to handle `.vue`. Emits `{ code, map }`.
