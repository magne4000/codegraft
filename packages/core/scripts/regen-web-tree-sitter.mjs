// Vendor the web-tree-sitter ESM runtime (Emscripten glue + engine wasm) into vendor/web-tree-sitter/,
// so @codegraft/core ships it and a consumer pulls no `web-tree-sitter` package. Its npm tarball is
// ~4.6 MB — a debug build, source maps, and a CJS variant — of which codegraft (ESM) loads only the
// ~0.35 MB release glue + engine wasm. The glue self-locates the wasm via
// `new URL("web-tree-sitter.wasm", import.meta.url)`, so the two are kept side by side; the MIT
// LICENSE is carried, and the .d.ts types core's re-exports. Pinned to the package.json devDep version.
//
//   pnpm --filter @codegraft/core regen-web-tree-sitter
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
const pkgDir = dirname(require.resolve('web-tree-sitter'))
const version = require(`${pkgDir}/package.json`).version
const dest = new URL('../vendor/web-tree-sitter/', import.meta.url)

mkdirSync(dest, { recursive: true })
for (const file of ['web-tree-sitter.js', 'web-tree-sitter.wasm', 'web-tree-sitter.d.ts', 'LICENSE']) {
  copyFileSync(`${pkgDir}/${file}`, new URL(file, dest))
}

// Two fixups so the copies stand alone: (1) drop the dangling `//# sourceMappingURL` pointers — we
// don't vendor the .map files (they're the bulk of the waste). (2) unwrap the `.d.ts` from its
// `declare module 'web-tree-sitter' { … }` ambient wrapper into a real module, so a relative import
// of the glue (`../vendor/web-tree-sitter/web-tree-sitter.js`) resolves its types.
const stripSourcemap = (text) => text.replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/, '\n')

const glue = new URL('web-tree-sitter.js', dest)
writeFileSync(glue, stripSourcemap(readFileSync(glue, 'utf8')))

const dts = new URL('web-tree-sitter.d.ts', dest)
const lines = stripSourcemap(readFileSync(dts, 'utf8')).split('\n')
if (/^declare module 'web-tree-sitter' \{/.test(lines[0])) {
  lines.shift()
  while (lines.length && lines.at(-1).trim() === '') lines.pop()
  if (lines.length && lines.at(-1).trim() === '}') lines.pop()
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith('\t')) lines[i] = lines[i].slice(1)
}
writeFileSync(dts, lines.join('\n') + '\n')

console.log(`vendored web-tree-sitter@${version} (glue + engine wasm + types + LICENSE) into vendor/web-tree-sitter/`)
