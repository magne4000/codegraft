# @codegraft/cli

The `codegraft` command line for [Codegraft](../../README.md).

```bash
# Apply a codemod to matched files (defaults to --dry-run). The codemod runs live — its helpers,
# imports, and deps work as written, with no build step. A grammar target handles its extensions
# (`tsx` → .tsx/.jsx, …); `.vue` is handled by the cli's built-in splitter (its <script>/<style>
# zones), so any codemod applies to .vue without declaring it.
codegraft run <glob...> --codemod <codemod-file> [--context <json>] \
  [--dry-run | --in-place | --out-dir <dir>]
```

`--codemod` takes a path (`./rule.ts`) or a package specifier (`@codegraft/rules/remove-unused-imports`).
The file must be importable by the running Node, so a `.ts` codemod needs a loader (Node's
`--experimental-strip-types`, `tsx`, …) or ship it as `.js`.
