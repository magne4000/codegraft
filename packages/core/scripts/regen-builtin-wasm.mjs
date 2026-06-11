// Vendor the html/css grammar wasm into wasm/ from their npm packages, so @codegraft/core ships them
// and a consumer needs no native `tree-sitter-*` peer. Unlike tree-sitter-typescript (ABI-14, no
// supertype metadata — rebuilt by regen-ts-wasm.sh), these bare-package wasm already carry the ABI
// and supertype metadata web-tree-sitter needs, so they are copied verbatim — the same bytes codegraft
// used to `require.resolve` from the peer. Pinned to the package.json devDependency versions.
//
//   pnpm --filter @codegraft/core regen-builtin-wasm
import { createRequire } from 'node:module'
import { copyFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const wasmDir = new URL('../wasm/', import.meta.url)

for (const grammar of ['css', 'html']) {
  const pkg = `tree-sitter-${grammar}`
  copyFileSync(require.resolve(`${pkg}/${pkg}.wasm`), new URL(`${pkg}.wasm`, wasmDir))
  console.log(`vendored ${pkg}.wasm from ${pkg}@${require(`${pkg}/package.json`).version}`)
}
