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
      { find: '@codegraft/core/internal', replacement: src('./packages/core/src/internal.ts') },
      { find: '@codegraft/core', replacement: src('./packages/core/src/index.ts') },
      { find: '@codegraft/codemod', replacement: src('./packages/codemod/src/index.ts') },
      { find: '@codegraft/vue', replacement: src('./packages/vue/src/index.ts') },
      { find: '@codegraft/unplugin', replacement: src('./packages/unplugin/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/*/{src,test}/**/*.test.ts'],
    passWithNoTests: true,
  },
})
