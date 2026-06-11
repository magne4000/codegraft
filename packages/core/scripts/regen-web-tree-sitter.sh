#!/usr/bin/env bash
# Vendor the web-tree-sitter ESM runtime (Emscripten glue + engine wasm) into vendor/web-tree-sitter/,
# so @codegraft/core ships it and a consumer pulls no `web-tree-sitter` package. Its npm tarball is
# ~4.6 MB — a debug build, source maps, and a CJS variant — of which codegraft (ESM) loads only the
# ~0.35 MB release glue + engine wasm. The glue self-locates the wasm via
# `new URL("web-tree-sitter.wasm", import.meta.url)`, so the two are kept side by side; the MIT
# LICENSE is carried, and the .d.ts types core's re-exports. Pinned to the package.json devDep version.
#
#   pnpm --filter @codegraft/core regen-web-tree-sitter
set -euo pipefail
dest="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/vendor/web-tree-sitter"
pkg="$(node -e "process.stdout.write(require('node:path').dirname(require.resolve('web-tree-sitter')))")"
version="$(node -e "process.stdout.write(require('${pkg}/package.json').version)")"

mkdir -p "$dest"
for f in web-tree-sitter.js web-tree-sitter.wasm web-tree-sitter.d.ts LICENSE; do
  cp "$pkg/$f" "$dest/$f"
done

# Two fixups so the copies stand alone: (1) drop the dangling `//# sourceMappingURL` pointers — we
# don't vendor the .map files (they're the bulk of the waste). (2) unwrap the `.d.ts` from its
# `declare module 'web-tree-sitter' { … }` ambient wrapper into a real module, so a relative import
# of the glue (`../vendor/web-tree-sitter/web-tree-sitter.js`) resolves its types.
node -e '
const fs = require("node:fs");
const dir = process.argv[1];
const strip = (f) => fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/, "\n"));
strip(dir + "/web-tree-sitter.js");
const dts = dir + "/web-tree-sitter.d.ts";
let lines = fs.readFileSync(dts, "utf8").replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/, "\n").split("\n");
if (/^declare module .web-tree-sitter. \{/.test(lines[0])) {
  lines.shift();
  while (lines.length && lines.at(-1).trim() === "") lines.pop();
  if (lines.at(-1).trim() === "}") lines.pop();
  lines = lines.map((l) => (l.startsWith("\t") ? l.slice(1) : l));
}
fs.writeFileSync(dts, lines.join("\n") + "\n");
' "$dest"

echo "vendored web-tree-sitter@${version} (glue + engine wasm + types + LICENSE) into vendor/web-tree-sitter/"
