# @trast/cli

The `trast` command line for [Trast](../../README.md).

```bash
# Imports the codemod file and emits one transformer module per target (+ a barrel),
# importing only @trast/core; prints the grammar packages the targets require.
trast build <codemod-file> --output <dir>

# Applies a compiled transformer to matched files (defaults to --dry-run).
trast run <glob> --transformer <dist/index.js> --context <json> \
  [--dry-run | --in-place | --out-dir <dir>]
```
