# @codegraft/bati-codemods

> [!NOTE]
> **Private, not published.** This package re-authors [Bati](https://batijs.dev/)'s boilerplate
> transformers (the ESLint-based one, the SquirrellyJS templating, and the YAML pass) as Codegraft
> codemods, to validate the new `$$`-namespaced syntax. The codemods are meant to be **lifted into
> Bati's own codebase**; this package is the development + test harness.

## Syntax mapping (Bati → Codegraft)

The unifying change: Bati's `BATI` global becomes the `$$` namespace (Codegraft's configurable
build-time marker, also the parse scan-gate). `BATI.has(...)` → `$$.BATI.has(...)`, `BATI_TEST` →
`$$.BATI_TEST`. Conditions are evaluated without `eval` by `@codegraft/core`'s `evaluate`.

| Capability | Bati | Codegraft |
|---|---|---|
| if / else-if / else | `if (BATI.has("a")) {…} else {…}` | `if ($$.BATI.has("a")) {…} else {…}` |
| ternary (+ JSX `{… ? <C/> : undefined}`) | `BATI.has("a") ? x : y` | `$$.BATI.has("a") ? x : y` |
| comment gate (stmt / import / list elem / JSX attr) | `// BATI.has("a")` or `//# BATI.has("a")` | `// $$.BATI.has("a")` or `//# $$.BATI.has("a")` (`$$` is the anchor; `#` optional) |
| keep-comments sentinel | `… \|\| "remove-comments-only"` | `… \|\| "remove-comments-only"` (unchanged) |
| `BATI_TEST` | `BATI_TEST` | `$$.BATI_TEST` |
| cast escape hatch | `x as BATI.Any` | `x as $$.Any` |
| conditional type | `BATI.If<{ 'BATI.has("a")': T; _: F }>` | `$$.If<{ '$$.BATI.has("a")': T; _: F }>` |
| conditional type (unknown) | `BATI.IfAsUnknown<{…}>` | `$$.IfAsUnknown<{…}>` |
| file flag | `/*# BATI include-if-imported #*/` | `/*# $$.includeIfImported #*/` (also `// $$.includeIfImported`) |
| whole-file suppression | `/*{ @if (it.BATI.has("x")) }*/ …file… /*{ /if }*/` | `// $$.keepFileIf($$.BATI.has("x"))` (first line) |
| conditional block (CSS / non-JS) | `/*{ @if (it.BATI.has("x")) }*/ … /*{ #else }*/ … /*{ /if }*/` | `/* $$.if($$.BATI.has("x")) */ … /* $$.elif(…) */ … /* $$.else */ … /* $$.endif */` |
| YAML line gate | `# BATI.has("x")` (mapping pair / seq item) | `# $$.BATI.has("x")` |
| `@batijs/…` import rewrite + graph | automatic | `batiImports` codemod (→ `ctx.imports`) |
| remove unused imports | automatic | `@codegraft/rules` `removeUnusedImports` |

Conditions can use any BatiSet member — `$$.BATI.has("x")`, derived properties (`$$.BATI.hasDatabase`,
`$$.BATI.hasD1`), `$$.BATI_TEST` — composed with `!`, `&&`, `||`, comparisons.

Bati declares the namespace's shape once (so source files type-check with no import); for the type
constructs `$$` is a merged namespace:

```ts
// codegraft-env.d.ts
declare global {
  const $$: { BATI: { has(feature: string): boolean }; BATI_TEST: boolean }
  namespace $$ {
    type Any = unknown
    type If<T> = T // resolved at build time by the codemod
    type IfAsUnknown<T> = T
  }
}
export {}
```

## Codemods

- **`batiCodemod`** (`{ namespace: '$$' }`) — if/else, ternary, comment gate, `$$.Any`, `$$.If` /
  `$$.IfAsUnknown`, `$$.includeIfImported`, and the whole-file `$$.keepFileIf(…)`. One depth-first
  walk that *prunes* removed branches, so nested conditionals collapse in a single pass without
  overlapping edits. Works on `js/ts/tsx/css` (and `.vue` `<script>` via `vueSplitter`).
- **`batiBlocks`** (`{ namespace: '$$' }`) — comment-delimited `/* $$.if(…) */ … /* $$.elif(…) */ …
  /* $$.else */ … /* $$.endif */` blocks. Grammar-agnostic (keys off comment nodes), targets
  `css/html/js/ts/tsx`; same-container nesting supported.
- **`batiYaml`** (`{ namespace: '$$' }`, target `'yaml'`) — `# $$.BATI.…` line gating over the
  `tree-sitter-yaml` grammar. Works *positionally* (gates the next item by document order) because
  tree-sitter attaches YAML comments structurally, not by the line-above semantics the directive
  needs. Removes whole lines (and the blank-line separator above a dropped block), so output is clean
  with no residual blank lines — matching Bati's `yaml`-library output exactly.
- **`batiImports`** (no namespace) — `@batijs/…` → relative rewrite and the relative-import graph.
  Deliberately **not** scan-gated on `$$`, because a file can import from `@batijs/…` with no `$$`.

### Config edits (the magicast port)

`vite-config.ts` re-authors Bati's magicast helpers as functions over `Collection`, composed inside a
codemod body the way Bati composed magicast calls (these are programmatic edits, not `$$` directives):

```ts
import { addVitePlugin, mergeObject, defineConfigArg } from '@codegraft/bati-codemods'

defineCodemod((root) => {
  addVitePlugin(root, { from: '@vitejs/plugin-react', constructor: 'react' }) // → import + plugins.push, idempotent
  mergeObject(defineConfigArg(root), { build: { sourcemap: 'true' } })        // magicast deepMergeObject
}).forTarget('typescript')
```

- **`addVitePlugin(root, { from, constructor, named?, options? })`** — append `constructor(options?)` to
  `defineConfig`'s `plugins` array (idempotent) and `ensureImport` it.
- **`mergeObject(object, source)`** — deep-merge a `ConfigObject` (nested `{ key: codeText | nested }`,
  leaves are raw code) into an object literal; `defineConfigArg(root)` locates `defineConfig`'s argument.
- Import / statement injection (e.g. Bati's `imports.$prepend` + `builders.functionCall`) needs no helper
  — use core's `ensureImport` and `insertBefore`.

### `.d.ts` merge

- **`mergeDts`** (target `typescript`) — Bati's `merge-dts`. A 2-input merge re-cast as single-source:
  **concatenate** the files and run it. Same-named `declare global` / `declare module` / `namespace`
  blocks fold into the first **recursively**; same-named `interface`s union their members (deduped);
  imports are hoisted + deduped; `export {}` / other statements dedupe by text.

  ```ts
  const t = await mergeDts.forTarget('typescript')
  const merged = t.transform(`${fileA}\n${fileB}`, {}) // then format with Prettier
  ```

  Two files merge exactly; with three or more, a declaration absent from the first file but repeated in
  later ones is left as a duplicate for TypeScript's own declaration merging.

Not ported: `package.json`/`tsconfig` edits (`PackageJsonTransformer`/`loadAsJson` are JSON-object
manipulation, not AST — codegraft has no JSON grammar).

### Run order

```ts
import { batiCodemod, batiImports } from '@codegraft/bati-codemods'
import { removeUnusedImports } from '@codegraft/rules'

const collapse = await batiCodemod.forTarget('tsx')
const imports  = await batiImports.forTarget('tsx')
const prune    = await removeUnusedImports.forTarget('tsx')

const ctx = { BATI, BATI_TEST, filename, imports: new Set<string>() }
let out = collapse.transform(source, ctx)  // 1. collapse conditionals (drops gated imports)
out = imports.transform(out, ctx)          // 2. rewrite + record surviving imports
out = prune.transform(out, {})             // 3. remove now-unused imports
// then format with Prettier — Codegraft leaves whitespace cleanup to it (see below)
```

Order matters: collapsing first means an import removed by a false condition is gone before
`batiImports` records the graph (mirroring Bati's `deleteImport`). `removeUnusedImports` runs last.
`.vue` SFCs: pass `vueSplitter` as the target (the `<script>` zone is transformed; template/style
are left to the HTML/CSS-side syntaxes, which are out of scope here).

## `ctx` out-channel

Codegraft codemods don't return data, but `ctx` is the live object passed to `transform(src, ctx)`,
so the codemods report through it: `batiCodemod` sets `ctx.includeIfImported`, `batiImports` fills
`ctx.imports`. Provide the `Set` yourself. See `BatiContext`.

## `@codegraft/core` changes this migration needed

1. **`remove({ separator: true })`** on `Collection` — drops a list element's trailing `,` so
   removing one from an array/object/argument list leaves no array hole or dangling comma.
2. **Contiguous-comment chaining** in `comment-attachment` — a *stack* of comments directly above a
   node now all attach as its leading comments (topmost first), so a directive sitting above another
   comment (a `///` reference, the `include-if-imported` flag) still attaches to the node it gates. A
   blank line still breaks the chain. (All pre-existing attachment tests still pass.)
3. **`Collection.findComments(pattern?)`** — selects comment nodes (which `find`/`children`
   deliberately skip) so the block + YAML codemods can operate on the directive markers themselves.
4. **`remove({ wholeLines, collapseBlankBefore })`** on `Collection` — deletes the whole lines a node
   occupies (optionally absorbing a blank-line separator above) so line-oriented removals (YAML
   entries, full-line comments) leave nothing blank behind.
5. **A `yaml` grammar** — `tree-sitter-yaml` (wasm vendored from
   `@tree-sitter-grammars/tree-sitter-yaml`, no peer dep), added to `GrammarId`, `COMMENT_TYPES`,
   `EXTENSION_GRAMMAR` (`.yml`/`.yaml`), and the node-type generator.

## Notes / not covered

- Output is **byte-exact edits**. The JS/CSS codemods leave residual blank lines / a leftover trailing
  comma for **Prettier**, exactly as Bati relies on; the YAML codemod removes whole lines so its output
  is already clean.
- A `$$`-rooted condition that isn't statically decidable (a runtime variable, an unsupported
  operator) makes `evaluate` throw, naming the node — same loud-failure contract as Bati.
- Block limitation: a block nested across a *different* container (e.g. inside `@media`) inside a
  *dead* branch isn't handled; same-container nesting is. Bati's boilerplates don't nest blocks.
- Still out of scope: HTML-template element gating (`<!-- BATI.has -->`) beyond what the generic
  block form covers, and Bati's `setComposeEnvironment` helper (a non-conditional YAML edit).
