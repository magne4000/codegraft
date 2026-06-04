# Trast Codemod API — Implementation Plan

Replace `match.<lang>.expr\`…\`` (exact structural templates) as the **primary** authoring
surface with a **jscodeshift-style collection codemod API**, to gain **insertion** and a
broader, navigational feature set — including **lexical scope/binding resolution for
JS/TS/TSX** — while keeping Trast's foundation (tree-sitter CST, `RichNode`, comment
attachment, zone splitting, magic-string edits, source maps) and **all** of Trast's languages.

This is a large change to the authoring model. It is phased so each phase is independently
green; the existing declarative engine keeps working until the canonical examples are migrated.

Scope of this plan:
- **In:** the collection API, insertion, lexical scope (JS/TS/TSX), compiled mode, migrating the
  canonical examples, multi-language collection.
- **Out (but designed-for):** cross-file resolution — only the `Resolver` interface and a
  non-committal codemod signature are reserved now.
- **Out (separate plan):** the jscodeshift → trast **migration script** lives in its own plan.

---

## 1. Goal & motivation

- **Insertion is first-class** — add an import, append to an array/block, wrap a node. The
  template model has no insert, only range replacement.
- **Broader features** — find-by-type+attribute, navigation (`closest`/`parent`/descendants),
  idempotency, file-level edits, and **safe rename/unused-binding via CST-derived scope**.
- **All Trast languages** — the collection API is uniform across js/ts/tsx/css/html (+ Vue
  zones). (Scope is the one per-language capability; JS/TS/TSX only — see §5.)
- **Keep what works** — formatting-preserving text edits + source maps, multi-zone SFC handling,
  comment attachment, compiled mode (`trast build`).

---

## 2. Design principles (these shape every decision)

1. **Read-only CST → text edits, not tree mutation.** Every op lowers to a magic-string edit on
   `RichNode` document offsets. "Builders" are **code strings**, optionally syntax-checked by a
   `code\`…\`` tagged template that interpolates captured nodes. No typed node builders (§11).
2. **Param-rooted API → clean serialization.** A codemod is `(root, ctx) => void`; every
   operation hangs off `root` / node / `ctx` (methods, not imported free functions), so the
   function's `.toString()` is self-contained and round-trips through `trast build` regardless
   of loader. (This is also why `evaluate` becomes `node.evaluate(...)`.)
3. **No parser ships to consumers.** Compiled-mode ops must not need the pattern parser at
   runtime. → the **primary query is `find(type, predicate)`** (pure CST inspection, no parser),
   compiled-safe. Structural-template search (`findPattern`) is an **interpreted-mode-only**
   power tool (§6).
4. **tree-sitter-native vocabulary, no alias table.** Node types and field names are the
   grammar's own (`call_expression`, field `function`, …). The Babel↔tree-sitter mapping lives
   in the migration script (separate plan), never in the runtime API. A docs cheatsheet helps
   humans; the API stays pure.
5. **Preserve precise nesting collapse.** `unwrap(keep)` (today's narrow-delete: drop the
   wrapper, keep + re-process the inner subtree) is an explicit op, so collapsing an outer node
   doesn't freeze inner edits.
6. **Scope is confident-or-abstain.** The resolver returns references/definitions **only when it
   fully modelled the surrounding constructs**; otherwise it returns `null` and the codemod bails
   rather than guess. A guessing resolver corrupts code on a rename; an abstaining one is safe.
7. **Resolution behind an interface, single-file now, cross-file-ready.** `node.references()` /
   `node.definition()` delegate to a per-language `Resolver`; a future project-wide impl
   satisfies the same interface (§5.4).
8. **Reuse the engine.** Parser, `RichNode`, comment attachment, zone splitter, `EditCollector`,
   and the structural matcher are reused; the codemod is a new surface on top, not a new engine.

---

## 3. The API surface

```ts
import { defineCodemod } from '@trast/codemod'

export default defineCodemod<Ctx>({ namespace: '$$' }, (root, ctx) => {
  // collapse a build-time conditional (Bati), nesting-safe:
  root.find('if_statement').forEach((node) => {
    const cond = node.field('condition')
    if (!cond.text.includes('$$')) return
    node.unwrap(node.evaluate(cond, ctx) ? node.field('consequence') : node.elseBranch())
  })

  // add a vite plugin — insertion + idempotency the template model can't do:
  const plugins = root.find('call_expression', { function: 'defineConfig' })
    .find('pair', { key: 'plugins' }).find('array').first()
  if (plugins && plugins.find('call_expression', { function: 'myPlugin' }).size() === 0) {
    plugins.append('myPlugin()')
    root.ensureImport("import myPlugin from 'my-plugin'")
  }

  // safe rename via CST scope (JS/TS/TSX), abstains when unsure:
  root.find('identifier', { text: 'oldName' }).forEach((id) => {
    const refs = id.references()                 // RichNode[] | null
    if (refs) refs.forEach((r) => r.replaceWith('newName'))
  })
})
```

### 3.1 Collection / query (no parser — compiled-safe)
- `find(type, attrs?)` — descendant search by node type + optional field predicates.
- `filter(node => bool)`, `closest(type)`, `parent()`, `children()`, `first()`, `at(i)`,
  `size()`, `forEach`, `map`, `nodes()`.
- **Field predicates** `attrs`: keys are grammar field names; values are `string` (field text
  equals), `RegExp`, or `(node) => bool`.
- Node accessors: `field(name)`, `text`, `type`, `parent`, plus convenience (`elseBranch()`, …).

### 3.2 Edits (lower to `EditCollector` / magic-string)
- `replaceWith(text)`, `remove()`, `unwrap(keep)` (narrow-delete; enables nested collapse).

### 3.3 Insertion (the headline)
- `insertBefore(text)` / `insertAfter(text)`.
- `append(text)` / `prepend(text)` into a container (array/object/block/argument list) — inside
  the delimiter, separators + empty-container handled.
- File/zone level: `root.ensureImport(stmt)` (idempotent), `root.prependToFile(text)`.

### 3.4 Conditions & directives
- `node.evaluate(condition | string, ctx)` — the interpreter, as a **method** (serializes).
- `root.directives(re)` — Collection of (comment, gated-node) pairs (built on `RichNode`'s
  attached comments) for the cross-language comment-instruction model.

### 3.5 Scope (JS/TS/TSX only — see §5)
- `node.references(): RichNode[] | null` — all references to the binding `node` declares (or
  that a reference resolves to); `null` = not confidently resolvable (abstain).
- `node.definition(): RichNode | null` — the declaration a reference resolves to.

### 3.6 Snippets & structural patterns
- `` code`log(${capturedNode})` `` — string builder that interpolates `RichNode.text` and
  parse-validates the result (catches syntax errors at author time).
- `root.findPattern(\`if ($cond) { $$$then }\`)` — **optional, interpreted-only** structural
  search reusing the matcher; build-time error if used in a compiled codemod (§6).

---

## 4. Execution model & engine reuse

Per file/target (single grammar or a `ZoneSplitter`):

1. `splitAndParse` → zones (reused). 2. `attachComments` per zone (reused). 3. Build **one
`root` Collection** spanning all zones; nodes carry `.language` + absolute document offsets, so
cross-zone queries/edits work. 4. Run `(root, ctx) => void`; ops record into one
`EditCollector`. 5. `toString()` + `generateMap()` (reused).

- **Scan-gate**: `defineCodemod({ namespace })` keeps the `source.includes(namespace)`
  short-circuit before parsing.
- **Conflict policy**: overlapping edits default to **outer-wins / first-write-wins** (today's
  `EditCollector`) and are **logged**; a strict mode (throw) is opt-in.
- **Nesting**: `unwrap(keep)` leaves `keep`'s range editable, so the same pass continues to edit
  inside it — nested collapse composes exactly as today.

---

## 5. Scope / `Resolver` (JS/TS/TSX)

Lexical binding resolution is syntactic — derivable from the CST without types — because the
type-dependent cases are excluded by construction: **property access** is `property_identifier`
(never treated as a binding reference) and **cross-file** is out of scope. Within a file,
`var`/`let`/`const`/`function`/`class`/params/destructuring/`catch`/`for` bindings + shadowing +
hoisting are a scope-chain algorithm.

### 5.1 Interface
```ts
interface Resolver {
  definition(ref: RichNode): RichNode | null      // null = abstain
  references(decl: RichNode): RichNode[] | null    // null = abstain
}
```
`node.references()` / `definition()` delegate to the active zone language's `Resolver`. **Only
js/ts/tsx ship one**; css/html return `null` (no scope) — uniform, honest behavior.

### 5.2 Confident-or-abstain
The resolver models a defined set of constructs; for anything outside it (`with`, `eval`, a
destructuring/default-param-scope interaction it doesn't model, a construct introduced by a
grammar bump) it returns `null`. Codemods treat `null` as "do not proceed." This is the core
safety property — a rename never fires on a guess.

### 5.3 Build approach & accuracy backbone
- **Hand-written scope-chain resolver**, seeded by each grammar's `locals.scm` construct list
  (web-tree-sitter exposes queries for the *captures*; the resolution stack is ours).
- **TS value/type namespaces** handled by classifying identifiers as value- vs type-position
  syntactically; ambiguous/unmodelled → abstain.
- **Differential-test harness (dev-only):** run the resolver and a reference binder
  (`@babel/traverse` scope and/or the TS binder) over a large corpus; every divergence is either
  fixed or converted into an explicit abstention case. This empirically bounds accuracy and
  catches grammar drift — it is the maintenance spine of this component.

### 5.4 Cross-file later (designed-for, not built)
- The single-file `Resolver` impl now; a future project-wide impl (file graph + import
  resolution) satisfies the **same interface**, so `references()` only widens its answer set.
- Keep `root` a *file view* and reserve a `project` concept; a future project driver runs the
  codemod over a file set (index pass → transform pass). The authoring surface is unchanged.

---

## 6. Serialization & compiled mode (`trast build`)

- A codemod serializes via `fn.toString()`; param-rooted (§2.2) → no imported free helpers → it
  round-trips under any loader. Emitted: `export const transform =
  createCodemodTransformer(target, <fn-source>, { namespace })`.
- `find` / navigation / edits / insertion / `evaluate` / `references` are all reached through
  `root`/node/`ctx` → all survive serialization (the scope binder is core runtime, invoked via
  the node method).
- `findPattern` needs the parser → **disallowed in compiled codemods** (build-time error). This
  is why `find` is primary.

---

## 7. Package layout & disposition of `@trast/match`

- **`@trast/core`** gains the Collection runtime (`Collection` + edit/insert ops on
  `EditCollector` + `createCodemodTransformer`), `node.evaluate`, and the JS/TS/TSX `Resolver`.
- **`@trast/codemod`** (new) is the authoring entry: `defineCodemod`, types, `code\`\``, config.
- **`@trast/cli` / `@trast/unplugin`** accept a codemod the way they accept a `RuleSetBuilder`
  today (interpreted via a `forTarget`-equivalent; compiled via the emitted module).
- **`@trast/match` (`defineRules`/`expr`)**: kept through migration, then the **public surface is
  removed**; the matcher survives internally as the interpreted-only `findPattern`.

---

## 8. Phased implementation (each phase ends green)

Phases 1–5 are interpreted-mode; compiled mode is Phase 6.

- **Phase 0 — spike & shape.** `Collection` + `find` + `replaceWith`/`remove` over the existing
  internals; a few tests. Validate the param-rooted shape + edit composition.
- **Phase 1 — query core.** `find(type, attrs)`, `filter`, `first`/`at`/`size`/`forEach`/`map`,
  node accessors, field-predicate resolution. Tests across all languages.
- **Phase 2 — navigation.** `closest`, `parent`, `children`, chained descendant `find`.
- **Phase 3 — edits.** `replaceWith`, `remove`, `unwrap` (port narrow-delete); conflict policy;
  a nested-collapse fixture proving `unwrap` re-processing.
- **Phase 4 — insertion.** `insertBefore/After`, `append/prepend`, `ensureImport`,
  `prependToFile`, `code\`\``; the vite.config fixture as proof.
- **Phase 5 — scope (JS/TS/TSX).** The `Resolver` interface + the hand-written resolver
  (confident-or-abstain) + `node.references()/definition()` + the **differential-test harness**.
  css/html return `null`. Rename + unused-binding fixtures, incl. abstention cases.
- **Phase 6 — compiled mode.** `createCodemodTransformer` + serialize the codemod fn; emit via
  `trast build`; parity tests (compiled === interpreted); build-time error if `findPattern` used.
- **Phase 7 — migrate canonical examples.** Re-author the Bati set as a codemod (conditionals via
  `evaluate`+`unwrap`; the three comment directives; the `$$.If` type case); port integration
  fixtures + cli/unplugin samples; add the vite.config flagship; rework READMEs around
  `defineCodemod`.
- **Phase 8 — disposition of `@trast/match`.** Remove the public `defineRules`/`match` surface;
  keep the matcher as `findPattern`. Final docs pass.

---

## 9. Migration of canonical examples

- Collapse: `find('if_statement') → evaluate → unwrap(branch)`.
- Directives: `root.directives(/\$\$.*/) → evaluate(text) ? keep : remove`.
- Fixtures move from rule sets to codemod modules; golden inputs/outputs unchanged, regenerated
  via the existing `UPDATE_FIXTURES` harness.
- New **vite.config** fixture: append plugin + `ensureImport` + idempotency (the flagship).
- The **jscodeshift → trast migration script** is a **separate plan** — out of scope here.

---

## 10. Settled decisions

1. **Codemod replaces `expr` as primary.** Matcher kept internally as interpreted-only
   `findPattern`; public `defineRules`/`match` removed after migration (Phase 8).
2. **Conflict policy:** outer-wins + log; strict (throw) opt-in.
3. **Packages:** `@trast/codemod` authoring; Collection runtime + `Resolver` in `@trast/core`.
4. **`evaluate` is a node method** (`node.evaluate(...)`) for serialization.
5. **Vocabulary:** tree-sitter-native, no alias table (mapping lives in the migration script's
   separate plan).
6. **Scope:** JS/TS/TSX only, **in the first cut** (Phase 5), confident-or-abstain, differential
   tests. css/html → `null`.
7. **Cross-file:** designed-for via the `Resolver` interface + a reserved `project` concept;
   **not built** now.

---

## 11. Risks & non-goals

- **No typed node builders.** Inserted/replaced code is a string; `code\`\`` parse-checks it, but
  there's no typed builder (tree-sitter can't print a synthesized node). Mitigate with docs +
  the validator.
- **Scope tail risk → abstention.** The danger of CST scope is a wrong resolution corrupting a
  rename; mitigated by confident-or-abstain + the differential harness. Accept reduced coverage
  (abstain) over wrong answers.
- **Scope is JS/TS/TSX only** for now; other languages have no binding resolution.
- **Cross-file is deferred**; the execution model only handles one file at a time until the
  project driver lands.
- **Imperative footguns** (overlapping edits, non-idempotent codemods) — mitigated by the
  conflict policy, `find().size()` idempotency patterns, and examples.
- **Scope creep** — Phases 1–5 define a deliberate v1 surface; everything else is added when a
  real codemod needs it.
