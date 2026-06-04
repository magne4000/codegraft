import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Tests always run against package *source*, not built dist, so editing a
// package never requires a rebuild before its (or a downstream) test sees it.
const src = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    // Array form: entries are matched in order, so the more specific "/internal"
    // subpath must precede the bare package alias.
    alias: [
      { find: '@trast/core/internal', replacement: src('./packages/core/src/internal.ts') },
      { find: '@trast/core', replacement: src('./packages/core/src/index.ts') },
      { find: '@trast/match', replacement: src('./packages/match/src/index.ts') },
      { find: '@trast/vue', replacement: src('./packages/vue/src/index.ts') },
      { find: '@trast/unplugin', replacement: src('./packages/unplugin/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/*/{src,test}/**/*.test.ts'],
    passWithNoTests: true,
  },
})
