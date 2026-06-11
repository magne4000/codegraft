#!/usr/bin/env bash
# Regenerate wasm/tree-sitter-tsx.wasm at the ABI web-tree-sitter needs, plus the vendored
# node-types.json for both typescript and tsx.
#
# The npm `tree-sitter-typescript` ships an ABI-14 wasm (no supertype metadata, so
# `find('expression')` etc. can't expand). Its grammar source *does* declare supertypes, so
# regenerating with a current CLI (ABI 15) recovers them. We vendor the result here, the same way
# `@codegraft/vue` vendors its grammar. Only tsx is built to wasm — the whole JS/TS/TSX family parses
# with it at runtime (see packages/core/src/parser.ts); typescript's node-types.json is still vendored
# so the TypescriptNodeType union keeps narrowing `find`/`type`. Needs network: downloads the grammar
# tarball and, on first run, the wasi-sdk the CLI builds with.
#
#   pnpm --filter @codegraft/core regen-ts-wasm [git-ref]   # ref defaults to the pinned version
set -euo pipefail

ref="${1:-v0.23.2}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wasm="$root/wasm"
vendor="$root/vendor"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "https://codeload.github.com/tree-sitter/tree-sitter-typescript/tar.gz/refs/tags/${ref}" \
  | tar -xz -C "$tmp"
cd "$tmp"/tree-sitter-typescript-*

# Pin the CLI to the web-tree-sitter line @codegraft/core targets (grammar ABI must match). Regenerate
# parser.c from the committed grammar.json (no JS toolchain needed) so it carries ABI-15 supertypes.
# `generate` finds the repo-root tree-sitter.json (required for ABI 15). Vendor each grammar's
# node-types.json (both type the unions); build only tsx to wasm (the runtime grammar for the family).
for grammar in typescript tsx; do
  (cd "$grammar" && npx --yes tree-sitter-cli@0.26.9 generate src/grammar.json)
  cp "$grammar/src/node-types.json" "$vendor/tree-sitter-${grammar}.node-types.json"
done
npx --yes tree-sitter-cli@0.26.9 build --wasm tsx -o "$wasm/tree-sitter-tsx.wasm"
echo "wrote tsx wasm + node-types.json for typescript and tsx"
echo "now run: pnpm --filter @codegraft/core regen-node-types"
