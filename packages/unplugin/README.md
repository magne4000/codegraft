# @trast/unplugin

Apply [Trast](../../README.md) transforms inside a bundler, via
[unplugin](https://github.com/unjs/unplugin) — Vite, Rollup, Rolldown, esbuild, webpack,
Rspack, Farm.

```ts
// vite.config.ts
import trast from '@trast/unplugin/vite'
import rules from './bati-rules'

export default {
  plugins: [trast({ rules, context: { features: ['auth'] } })],
}
```

Options: `{ rules, context, splitters?, include?, exclude? }`. Pass `splitters: [vueSplitter]`
(from `@trast/vue`) to handle `.vue`. Emits `{ code, map }`.
