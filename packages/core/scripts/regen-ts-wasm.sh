#!/usr/bin/env bash
# Regenerate wasm/tree-sitter-{typescript,tsx}.wasm at the ABI web-tree-sitter needs.
#
# The npm `tree-sitter-typescript` ships an ABI-14 wasm (no supertype metadata, so
# `find('expression')` etc. can't expand). Its grammar source *does* declare supertypes, so
# regenerating with a current CLI (ABI 15) recovers them. We vendor the result here, the same way
# `@codegraft/vue` vendors its grammar. Needs network: downloads the grammar tarball and, on first
# run, the wasi-sdk the CLI builds with.
#
#   pnpm --filter @codegraft/core regen-ts-wasm [git-ref]   # ref defaults to the pinned version
set -euo pipefail

ref="${1:-v0.23.2}"
wasm="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/wasm"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "https://codeload.github.com/tree-sitter/tree-sitter-typescript/tar.gz/refs/tags/${ref}" \
  | tar -xz -C "$tmp"
cd "$tmp"/tree-sitter-typescript-*

# Pin the CLI to the web-tree-sitter line @codegraft/core targets (grammar ABI must match). Regenerate
# parser.c from the committed grammar.json (no JS toolchain needed) so it carries ABI-15 supertypes,
# then compile to wasm. `generate` finds the repo-root tree-sitter.json (required for ABI 15).
for grammar in typescript tsx; do
  (cd "$grammar" && npx --yes tree-sitter-cli@0.26.9 generate src/grammar.json)
  npx --yes tree-sitter-cli@0.26.9 build --wasm "$grammar" -o "$wasm/tree-sitter-${grammar}.wasm"
done
echo "wrote $wasm/tree-sitter-typescript.wasm and tree-sitter-tsx.wasm"
