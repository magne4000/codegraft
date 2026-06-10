# Bati migration — handoff prompt

Paste everything below the line into a Claude Code session running **in the Bati repo**. It is
self-contained (assume that session has no prior context) and states the codemod facts so the session
needn't re-derive them; Bati's pipeline internals are left for it to explore and plan.

---

# Task: migrate Bati's boilerplate transformers to the codegraft codemods

Bati currently transforms boilerplate files with several engines: an ESLint-based linter
(`packages/core/src/parse/linters/*`), SquirrellyJS (`parse/squirelly.ts`), a YAML pass
(`parse/yaml.ts`), magicast (`magicast.ts` + `loaders.ts`, used by the `$vite.config.ts.ts` dynamic
files), and a `.d.ts` merge (`packages/build/src/operations/merge-dts.ts`).

These have been **re-authored as codegraft codemods** and are already installed in this repo at
**`packages/core/src/codemods/`** (with `@codegraft/*@beta` and `tree-sitter-*` as `dependencies` of
`@batijs/core`). **Your job: wire the codemods into Bati's transform pipeline, replace the old engines,
and migrate the boilerplate source files to the new `$$`-namespaced syntax.** Do **not** reinstall or
re-author the codemods.

## The codemods (exported from `packages/core/src/codemods/index.js`)

- **`batiCodemod`** — if/else-if/else collapse, ternaries (incl. JSX `{… ? <C/> : undefined}`),
  `//`/`//#` `$$` comment gates (statements, imports, array/object/arg-list elements, JSX attributes;
  supports `… || "remove-comments-only"`), `x as $$.Any`, `$$.If` / `$$.IfAsUnknown<{…}>` conditional
  types, `$$.includeIfImported`, and the whole-file `$$.keepFileIf(<cond>)`.
- **`batiBlocks`** — comment-delimited `/* $$.if(cond) */ … /* $$.elif(cond) */ … /* $$.else */ …
  /* $$.endif */` blocks (for CSS and other non-JS files).
- **`batiYaml`** — `# $$.BATI.…` line gating (target `'yaml'`).
- **`batiImports`** — rewrites `@batijs/<pkg>/<rest>` specifiers to a relative path (from
  `ctx.filename`) and records surviving relative imports into `ctx.imports`. Run it **after**
  `batiCodemod`.
- **`addVitePlugin(root, { from, constructor, named?, options? })`**, **`mergeObject(object, source)`**,
  **`defineConfigArg(root)`** — compose these inside a `defineCodemod` body to edit `vite.config.ts`
  (the magicast `addVitePlugin`/`deepMergeObject` replacements).
- **`mergeDts`** — merge `.d.ts` files: **concatenate them and transform the concatenation** (target
  `'typescript'`). Replaces `merge-dts.ts`.
- Also available: **`removeUnusedImports`** from `@codegraft/rules` (post-pass), **`vueSplitter`** from
  `@codegraft/vue` (the target for `.vue`), and the type **`BatiContext`** from the codemods' `index`.

### API shape
```ts
import { batiCodemod, batiImports, type BatiContext } from "./codemods/index.js";
import { removeUnusedImports } from "@codegraft/rules";
import { vueSplitter } from "@codegraft/vue";

// forTarget(...) is async (loads WASM once) — build + cache one transformer per target.
const collapse = await batiCodemod.forTarget("tsx");        // or "typescript" | "javascript" | vueSplitter
const rewrite  = await batiImports.forTarget("tsx");
const prune    = await removeUnusedImports.forTarget("tsx");

const ctx: BatiContext = { ...meta, filename, imports: new Set<string>() };
let out = collapse.transform(source, ctx);   // 1. collapse conditionals/types (drops gated imports)
out = rewrite.transform(out, ctx);           // 2. @batijs → relative; fills ctx.imports
out = prune.transform(out, {});              // 3. drop now-unused imports
// 4. then Prettier (keep Bati's existing format step — codemods leave residual whitespace it cleans)
// read ctx.imports / ctx.includeIfImported afterwards for the include-if-imported graph
```

## Per-grammar pipeline

| File | Pipeline |
|---|---|
| `.ts` / `.mts` / `.cts` | `batiCodemod('typescript')` → `batiImports('typescript')` → `removeUnusedImports('typescript')` → Prettier |
| `.tsx` / `.jsx` | same, target `'tsx'` |
| `.js` / `.mjs` / `.cjs` | same, target `'javascript'` |
| `.vue` | same, target `vueSplitter` — transforms the `<script>` zone fully and the `<template>` zone for `<!-- $$.BATI.has(…) -->` element gating (see Vue note below) |
| `.html` | `batiCodemod('html')` — `<!-- $$.BATI.has(…) -->` element gating |
| `.css` | `batiBlocks('css')` then `batiCodemod('css')` (the latter only for `$$.keepFileIf`/comment gates) → Prettier |
| `.yml` / `.yaml` | `batiYaml('yaml')` (output is already clean; no Prettier needed) |
| `vite.config.ts` (the `$vite.config.ts.ts` dynamic files) | a codemod composing `addVitePlugin` / `mergeObject(defineConfigArg(root), …)` |
| `.d.ts` merge (build op) | concatenate the files, `mergeDts('typescript').transform(joined, {})` |

Order matters: collapse first (so a falsy-gated import is gone before the graph is recorded — mirrors
Bati's `deleteImport`), then `batiImports`, then `removeUnusedImports`.

## `ctx` contract
`BatiContext` = `{ BATI, BATI_TEST?, filename?, includeIfImported?, imports? }`. Bati's `meta` already
carries `BATI` (a `BatiSet`) and `BATI_TEST`, so pass `{ ...meta, filename, imports: new Set() }`.
Conditions resolve `$$` to this object, so `$$.BATI.has("x")` evaluates `meta.BATI.has("x")` and
`$$.BATI.hasDatabase` evaluates `meta.BATI.hasDatabase`. After the run, read `ctx.includeIfImported`
and `ctx.imports`.

## The `$$` global typings
Boilerplate source authored against `$$` must type-check. Find Bati's current ambient `BATI` global
declaration (likely `packages/core/global.d.ts` or a `types` entry) and replace/augment it:
```ts
declare global {
  const $$: { BATI: import("@batijs/features").BatiSet; BATI_TEST: boolean };
  namespace $$ {            // merged namespace for the type constructs (erased at build)
    type Any = unknown;
    type If<T> = T;
    type IfAsUnknown<T> = T;
  }
}
export {};
```

## Boilerplate syntax migration (old Bati → new `$$`)

| old | new |
|---|---|
| `BATI.has("x")`, `BATI.hasD1`, `it.BATI.…` | `$$.BATI.has("x")`, `$$.BATI.hasD1`, `$$.BATI.…` |
| `BATI_TEST` | `$$.BATI_TEST` |
| `// BATI.has(…)` / `//# BATI.has(…)` | `// $$.BATI.has(…)` / `//# $$.BATI.has(…)` |
| `x as BATI.Any` | `x as $$.Any` |
| `BATI.If<{ 'BATI.has("x")': T; _: F }>` | `$$.If<{ '$$.BATI.has("x")': T; _: F }>` |
| `BATI.IfAsUnknown<{…}>` | `$$.IfAsUnknown<{…}>` |
| `/*# BATI include-if-imported #*/` | `/*# $$.includeIfImported #*/` |
| squirrelly whole-file: `/*{ @if (it.BATI.has("x")) }*/ …entire file… /*{ /if }*/` | first line `// $$.keepFileIf($$.BATI.has("x"))` |
| squirrelly inline block (CSS): `/*{ @if (…) }*/ … /*{ #else }*/ … /*{ /if }*/` | `/* $$.if($$.BATI.has("x")) */ … /* $$.else */ … /* $$.endif */` |
| YAML `# BATI.has("x")` | `# $$.BATI.has("x")` |
| Vue/html template element gate `<!-- BATI.has("x") -->` | `<!-- $$.BATI.has("x") -->` |
| magicast `$vite.config.ts.ts` (`addVitePlugin`, `deepMergeObject`) | a codemod using `addVitePlugin` / `mergeObject` |

## Known gaps / out of scope (don't assume coverage)
- **Vue `<template>` is partly covered.** Via `vueSplitter` the codemod runs over the template's
  `html` zone too, so **`<!-- $$.BATI.has("x") -->` element gating works** (the comment-gate drops/keeps
  the next element). What's **not** covered: `{{ $$.BATI.has() ? a : b }}` interpolations and
  `v-if`/binding expressions — tree-sitter leaves those as raw text, so a `$$` condition inside them
  isn't seen. Rewrite those few spots as element gates / move them into `<script>`, or flag for a
  later codegraft enhancement (a Vue-template splitter that extracts interpolation/directive
  expressions as JS sub-zones). (React/Solid JSX is fully covered — it's TSX.)
- **JSON is not ported** — `package.json`/`tsconfig.json` edits (`PackageJsonTransformer`,
  `loadAsJson`) are plain object manipulation, not AST; keep Bati's existing approach.
- **`mergeDts`** merges two files exactly; with three or more, a declaration absent from the first file
  but repeated in later ones is left as a duplicate for TypeScript's own declaration merging.

## How to proceed
1. **Explore first**: map every place Bati invokes a transform engine (`parse.ts` /
   `transformAndFormat`, `parse/linters/*`, `parse/squirelly.ts`, `parse/yaml.ts`, `magicast.ts` +
   `loaders.ts`, `build/operations/{transform,merge-dts}.ts`) and inventory every boilerplate syntax in
   use (`boilerplates/**`). Keep the ESLint/Biome `*-disable`/`*-ignore` comment-stripping and the
   Prettier format step — those aren't part of this migration.
2. **Use plan mode** and present a phased plan before editing — this touches the pipeline plus ~40
   boilerplates.
3. **Behavioral oracle**: `packages/core/tests/transform-*.spec.ts` define the expected outputs. Migrate
   their fixture *inputs* from `BATI` to `$$`, keep the expected outputs unchanged, and make them pass
   against the new codemod pipeline. Keep `bun run test`, `bun run check-types`, and `bun run lint` green
   throughout.
4. **Work incrementally**: wire the pipeline + migrate one feature area, validate, then roll through the
   rest. `@codegraft/*` is beta/unstable — pin versions.
