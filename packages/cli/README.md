# @trast/cli

The `trast` command line for [Trast](../../README.md).

```bash
# Imports the rules file and emits one transformer module per target (+ a barrel),
# importing only @trast/core; prints the grammar packages the targets require.
trast build <rules-file> --output <dir>

# Applies a compiled transformer to matched files (defaults to --dry-run).
trast run <glob> --transformer <dist/index.js> --context <json> \
  [--dry-run | --in-place | --out-dir <dir>]
```
