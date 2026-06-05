# @codegraft/cli

The `codegraft` command line for [Codegraft](../../README.md).

```bash
# Imports the codemod file and emits one transformer module per target (+ a barrel),
# importing only @codegraft/core; prints the grammar packages the targets require.
codegraft build <codemod-file> --output <dir>

# Applies a compiled transformer to matched files (defaults to --dry-run).
codegraft run <glob> --transformer <dist/index.js> --context <json> \
  [--dry-run | --in-place | --out-dir <dir>]
```
