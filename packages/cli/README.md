# @codegraft/cli

The `codegraft` command line for [Codegraft](../../README.md).

```bash
# Apply a codemod to matched files (defaults to --dry-run). The codemod runs live — its helpers,
# imports, and deps work as written, with no build step. Each declared target handles its
# extensions (`tsx` → .tsx/.jsx, the vueSplitter → .vue, …).
codegraft run <glob...> --codemod <codemod-file> [--context <json>] \
  [--dry-run | --in-place | --out-dir <dir>]
```

The codemod file must be importable by the running Node, so a `.ts` codemod needs a loader
(Node's `--experimental-strip-types`, `tsx`, …) or ship it as `.js`.
