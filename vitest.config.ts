import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Tests always run against package *source*, not built dist, so editing a
// package never requires a rebuild before its (or a downstream) test sees it.
const src = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@trast/core': src('./packages/core/src/index.ts'),
      '@trast/match': src('./packages/match/src/index.ts'),
      '@trast/vue': src('./packages/vue/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/{src,test}/**/*.test.ts'],
    passWithNoTests: true,
  },
})
