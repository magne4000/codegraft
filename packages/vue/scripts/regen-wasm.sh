#!/usr/bin/env bash
# Regenerate wasm/tree-sitter-vue.wasm from the maintained grammar.
#
# WASI build via tree-sitter-cli's bundled wasi-sdk (no Docker/emscripten). Needs
# network: downloads the grammar tarball and, on first run, wasi-sdk.
#
#   pnpm --filter @trast/vue regen-wasm [git-ref]   # git-ref defaults to "main"
set -euo pipefail

ref="${1:-main}"
out="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/wasm/tree-sitter-vue.wasm"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "https://codeload.github.com/tree-sitter-grammars/tree-sitter-vue/tar.gz/refs/heads/${ref}" \
  | tar -xz -C "$tmp"
cd "$tmp"/tree-sitter-vue-*

# Pin the CLI to the web-tree-sitter line @trast/core targets (grammar ABI must match).
npx --yes tree-sitter-cli@0.26.9 build --wasm . -o "$out"
echo "wrote ${out}"
