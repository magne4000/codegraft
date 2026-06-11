#!/usr/bin/env bash
# Vendor the html/css grammar wasm into wasm/ from their npm packages, so @codegraft/core ships them
# and a consumer needs no native `tree-sitter-*` peer. Unlike tree-sitter-typescript (ABI-14, no
# supertype metadata — rebuilt by regen-ts-wasm.sh), these bare-package wasm already carry the ABI
# and supertype metadata web-tree-sitter needs, so they are copied verbatim — the same bytes codegraft
# used to `require.resolve` from the peer. Pinned to the versions in package.json devDependencies.
#
#   pnpm --filter @codegraft/core regen-builtin-wasm
set -euo pipefail
wasm="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/wasm"

for grammar in css html; do
  src="$(node -e "process.stdout.write(require.resolve('tree-sitter-${grammar}/tree-sitter-${grammar}.wasm'))")"
  version="$(node -e "process.stdout.write(require('tree-sitter-${grammar}/package.json').version)")"
  cp "$src" "$wasm/tree-sitter-${grammar}.wasm"
  echo "vendored tree-sitter-${grammar}.wasm from tree-sitter-${grammar}@${version}"
done
