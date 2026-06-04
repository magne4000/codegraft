# Trast — Implementation Plan

## 1. Package Structure

**Dependency graph:** `@trast/core ← @trast/match ← @trast/cli`, and
`@trast/core ← @trast/vue` (the Vue SFC splitter ships as its own package, parallel to a
future `@trast/astro`).

### `@trast/core` — runtime

Goes into `dependencies` of every tool that ships compiled Trast transforms. The language
grammars are **optional peer dependencies** (§2) — core drives whichever are installed; the
consumer installs only the ones its targets need.

**Owns:** web-tree-sitter init, grammar loading, `RichNode` wrapper, comment attachment
pass, the generic SFC zone-splitting pipeline (`splitAndParse`) and the `ZoneSplitter`
interface, the runtime pattern matcher (`matchPattern`/`matchVisitor`) and comment-predicate
factory (`leadingCommentPredicate`), edit collection and application, `createTransformer`.

The matcher and comment-predicate factory live here, not in `@trast/match`, because they run
at transform time inside compiled transforms — which depend only on `@trast/core`.
`@trast/match` compiles a rule down to plain *data* (a `PatternNode` tree and a `RegExp`);
`@trast/core` turns that data into runtime behaviour. One matcher implementation serves both
dev and compiled modes, so the two cannot drift.

**Public API:** `createTransformer`, `RichNode`, `GrammarId`, `ZoneSplitter`, `Zone`,
`Edit`, `PatternNode`, `CompiledRule`, `CaptureArg`, `Transformer`, `LazyTransformer`,
`remove`, `getPropertySignatures`, `getPropertyName`, `getConditionalBranches`.

`matchPattern`, `matchVisitor`, and `leadingCommentPredicate` are internal — compiled
transforms reach them only indirectly, by handing `createTransformer` the `PatternNode` and
`RegExp` data it constructs them from.

### `@trast/match` — rule API and compilation

Goes into `devDependencies` of distributed tools that use `trast build`. Goes into
`dependencies` only when interpreted mode runs at production runtime.

**Owns:** `match.*` fluent rule builder, template-literal pattern parser (`parsePattern`:
pattern string → `PatternNode`), `defineRules`, `RuleSetBuilder`. Pure build-time
machinery: it produces the `PatternNode`/`RegExp` data that `@trast/core` executes. It never
matches a node itself.

`RuleSetBuilder` exposes two methods:
- `forTarget(target: GrammarId | ZoneSplitter): Promise<Transformer>` — interpreted
  mode; for dev and tests.
- `compiledRulesFor(target: GrammarId | ZoneSplitter): Promise<CompiledRule[]>` —
  consumed by `@trast/cli`.

### `@trast/vue` — Vue SFC splitter

Ships in `dependencies` of any tool that distributes a compiled Vue transform — the
generated `vue.js` imports `vueSplitter` from it — and in `devDependencies` for
`trast build`. Owns `vueSplitter`; hard-depends on `@trast/core` and `tree-sitter-vue`, with
the `<script>` grammars as optional peers (§2). Core stays ignorant of Vue: `vueSplitter` loads its own grammar through `@trast/core`'s
`Parser` and implements the `ZoneSplitter` interface. A future `@trast/astro` is added the
same way, with no change to core.

### `@trast/cli` — tooling

**Commands:**
- `trast build <rules-file> --output <dir>` — imports the rule file, calls
  `compiledRulesFor()` for each active target, serialises to per-target ES modules.
- `trast run <glob> --transformer <dist/index.js> --context <json> [--dry-run]
  [--in-place] [--out-dir <dir>]` — applies a compiled transformer to matched files.

---

## 2. Monorepo Setup

```
trast/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   ├── match/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   ├── vue/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   └── cli/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
└── fixtures/
    ├── tsx/
    ├── typescript/
    ├── javascript/
    ├── html/
    ├── css/
    └── vue/
```

### `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

### Per-package invariants

- `"type": "module"` in every `package.json`
- `"sideEffects": false` — required for tree-shaking of barrel re-exports in bundlers
- `"exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } }`
- Built with `tsup --format esm --dts --external web-tree-sitter`
- Each `tsconfig.json` extends `../../tsconfig.base.json` and sets `"references"` to
  its upstream packages

### `@trast/core` dependencies

```json
"dependencies": {
  "web-tree-sitter": "^0.22.x"
},
"peerDependencies": {
  "tree-sitter-javascript": "*",
  "tree-sitter-typescript": "*",
  "tree-sitter-html": "*",
  "tree-sitter-css": "*"
},
"peerDependenciesMeta": {
  "tree-sitter-javascript": { "optional": true },
  "tree-sitter-typescript": { "optional": true },
  "tree-sitter-html": { "optional": true },
  "tree-sitter-css": { "optional": true }
}
```

The grammar packages are **optional peer dependencies**, not hard deps. Core is the engine;
the set of languages is a deployment choice — a consumer installs only the grammars its
targets use, so a TS-only tool never pulls `tree-sitter-html`/`-css`. `web-tree-sitter`
(the engine itself) stays a hard dependency. `trast build` reports the exact grammar
packages a build's `targets` require (§8), so the install set is never guesswork.

(`tree-sitter-typescript` supplies both the `typescript` and `tsx` `.wasm` files. The Vue
grammar is **not** here — it moved to `@trast/vue`.)

Grammar `.wasm` files are resolved at runtime via
`import.meta.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm')`. No copying or
repackaging. When a target's grammar peer is absent, `loadGrammar` fails with an actionable
message naming the package to install (§3), never a raw module-not-found.

### `@trast/match` dependencies

```json
"dependencies": { "@trast/core": "workspace:*" }
```

### `@trast/vue` dependencies

```json
"dependencies": { "@trast/core": "workspace:*", "tree-sitter-vue": "*" },
"peerDependencies": {
  "tree-sitter-javascript": "*",
  "tree-sitter-typescript": "*"
},
"peerDependenciesMeta": {
  "tree-sitter-javascript": { "optional": true },
  "tree-sitter-typescript": { "optional": true }
}
```

`tree-sitter-vue` is a **hard dependency** — it is the package's sole purpose, so it is
never optional here. The `<script>` grammars (`tree-sitter-typescript` for `lang="ts"`,
else `tree-sitter-javascript`) come from core's menu and depend on the SFC's `lang`, so
`@trast/vue` re-declares them as its own optional peers, mirroring core.

### `@trast/cli` dependencies

```json
"dependencies": { "@trast/match": "workspace:*" },
"bin": { "trast": "./dist/cli.js" }
```

---

## 3. Implementation Order

### Phase 1 — `@trast/core`

Each step must type-check and pass its unit tests before starting the next.

1. **`src/types.ts`** — All interfaces and type aliases (`GrammarId`, `RichNode`, `Zone`,
   `Edit`, `PatternNode`, `CompiledRule`, `CaptureArg`, `Transformer`, …). No imports. The
   contract every other file in the system implements against.

2. **`src/parser.ts`** — `Parser` singleton: `init()` (async, idempotent, loads WASM once
   globally), `loadGrammar(id, wasmPath)` (lazy, idempotent per `id`; built-in `GrammarId`s
   resolve their own `wasmPath` from an internal registry via `import.meta.resolve`, external
   grammars such as Vue pass theirs in). Because grammars are optional peer deps (§2), a
   missing built-in package surfaces here as an actionable assertion — `grammar 'css'
   requires the optional peer 'tree-sitter-css'; add it to your dependencies` — not a raw
   module-not-found. `parse(source, id) → SyntaxTree`. All web-tree-sitter concerns are
   confined to this file — including the parsing `vueSplitter` needs, which it performs by
   calling this `Parser`.

3. **`src/rich-node.ts`** — `RichNode` class wrapping `SyntaxNode`. Lazy: reads
   type/text/positions directly from the backing node on each access. `allChildren` (full
   CST) and `children` (named children with comment nodes removed — see §4) are computed
   once and cached per instance. Comment arrays start empty and are written by the
   attachment pass.

4. **`src/comment-attachment.ts`** — `attachComments(root: RichNode): void`. Mutates
   every node's comment arrays in place. Pure tree traversal; no parser dependency.
   Algorithm in §6.

5. **`src/zone-splitter.ts`** — Defines the `ZoneSplitter` interface and exports
   `splitAndParse(source, target: GrammarId | ZoneSplitter): Zone[]`, the single pipeline
   that turns *any* target into parsed `Zone[]`: a `GrammarId` becomes one synthetic zone
   (`startOffset: 0`), a `ZoneSplitter` is `init()`-ed then `split()`. Either way each raw
   zone is parsed and wrapped. `vueSplitter` itself lives in `@trast/vue`, not here — adding
   a new SFC format (Vue, Astro, …) requires only a new `ZoneSplitter` value in its own
   package; this file and the rest of the pipeline do not change.

6. **`src/edit-collector.ts`** — `EditCollector`: `add(edit)` silently drops
   overlapping edits (first-wins), `apply(source)` applies edits in reverse-offset
   order.

7. **`src/pattern-matcher.ts`** — `matchPattern(pattern: PatternNode, node) → captures |
   null` and `matchVisitor(pattern) → (node) => captures | null`. Pure; no I/O. Algorithm
   in §5.

8. **`src/comment-predicate.ts`** — `leadingCommentPredicate(re): (node) → { comment, match
   } | null`. Single implementation; gates both `.whenLeadingComment` and the HTML
   directive case.

9. **`src/create-transformer.ts`** — `createTransformer(target, rules: CompiledRule[]):
   LazyTransformer`. Builds each rule's visitor (`matchVisitor(rule.pattern)`) and comment
   predicate (`rule.commentRegex && leadingCommentPredicate(rule.commentRegex)`) once at
   `init()`. Described in §7.

**Done when:** `createTransformer('tsx', []).init()` returns a `Transformer` whose
`transform(src, {})` returns `src` unchanged, and the same holds for a stub `ZoneSplitter`
over a two-zone fixture (core has no dependency on `@trast/vue`, so its tests use an inline
splitter).

### Phase 2 — `@trast/match`

1. **`src/types.ts`** — `RawRule`. Internal only. (`PatternNode` and `CompiledRule` are
   imported from `@trast/core`.)

2. **`src/pattern-parser.ts`** — `parsePattern(raw, lang, ctx): PatternNode`. Algorithm
   in §5.

3. **`src/rule-builder.ts`** — The `match` object and builder chain. API in §5.

4. **`src/define-rules.ts`** — `defineRules(factory) → RuleSetBuilder`.

5. **`src/rule-set-builder.ts`** — `forTarget(target)` and `compiledRulesFor(target)`. Both
   compile `RawRule[]` → `CompiledRule[]` (data: a `PatternNode` and a `RegExp | null` per
   rule) via the pattern parser. `forTarget` additionally passes the result to
   `createTransformer`.

**Done when:** dev-mode integration tests pass for all Bati transformation types (§9).

### Phase 3 — `@trast/cli`

1. **`src/serialise.ts`** — `serialiseRules(target, rules): string`. Emits an ES module
   source string. Algorithm in §8.

2. **`src/build.ts`** — `trast build` command.

3. **`src/run.ts`** — `trast run` command.

**Done when:** parity test passes — dev mode and compiled mode produce identical output
for the same input and context.

---

## 4. Data Structures

### `GrammarId` and `Point`

```ts
type GrammarId = 'javascript' | 'typescript' | 'tsx' | 'html' | 'css'
type Point     = { row: number; column: number }
```

`GrammarId` identifies an actual tree-sitter grammar. It is the language assigned to
every `RichNode` and `CompiledRule`. There is no grammar ID for SFC file formats — they
are handled by `ZoneSplitter`.

### `ZoneSplitter`

The open extension point for multi-zone file formats. The only value today is
`vueSplitter`, exported from `@trast/vue`. A future `astroSplitter` would be exported from
`@trast/astro` the same way, with no changes to core.

```ts
interface ZoneSplitter {
  readonly id: string             // output file stem: 'vue' → dist/vue.js
  readonly grammars: GrammarId[]  // which grammars this format can produce
  init(): Promise<void>           // idempotent; loads the splitter's own parsing grammar
  split(source: string): Array<{ language: GrammarId; source: string; startOffset: number }>
}

const vueSplitter: ZoneSplitter  // exported from @trast/vue
```

`init()` lets a splitter load whatever grammar it parses with (Vue loads `tree-sitter-vue`
through `@trast/core`'s `Parser`), so `split()` stays synchronous. The pipeline calls
`init()` once, before the first `split()`.

`ZoneSplitter.split` returns raw zone descriptors only — it does not parse zone *contents*
(that is the pipeline's job). It parses the SFC shell with the `tree-sitter-vue` grammar
(loaded by `init()`) to locate section boundaries reliably, not by regex.

**`vueSplitter` zone mapping:**

| SFC section       | Grammar       |
|-------------------|---------------|
| `<template>`      | `html`        |
| `<script>`        | `typescript`  |
| `<script setup>`  | `typescript`  |
| `<style>`         | `css`         |

A rule whose `language` is `'typescript'` runs on the `<script>` zone of a Vue file
**and** on standalone `.ts` files — the same rule covers both. `match.any()` rules run
on every zone of every format.

### `RichNode`

```ts
interface RichNode {
  readonly type: string
  readonly isNamed: boolean
  readonly text: string
  readonly startIndex: number        // byte offset in zone source
  readonly endIndex: number
  readonly startPosition: Point
  readonly endPosition: Point
  readonly parent: RichNode | null
  readonly children: RichNode[]      // named structural children: no punctuation, no comments
  readonly allChildren: RichNode[]   // full CST: every child, incl. punctuation and comments
  child(field: string): RichNode | null
  childrenForField(field: string): RichNode[]
  readonly leadingComments: RichNode[]
  readonly trailingComments: RichNode[]
  readonly innerComments: RichNode[]
  readonly language: GrammarId
  readonly documentStartIndex: number  // startIndex + zone.startOffset
  readonly documentEndIndex: number
}
```

`children` is the surface pattern matching (§5) walks, so comments never perturb a match.
Comments are reached two other ways: interleaved among siblings via `allChildren` (how the
attachment pass in §6 finds them) and, after that pass, via the `leadingComments` /
`trailingComments` / `innerComments` arrays.

The backing `Tree` is held alive by the `TransformContext` (one per `transform()` call)
for the full transform duration.

### `Zone`

```ts
interface Zone {
  language: GrammarId
  source: string      // exact slice: outerSource.slice(startOffset, endOffset)
  startOffset: number
  tree: RichNode
}
```

Produced by `splitAndParse(source, splitter)`. For a single-grammar file, the pipeline
creates one synthetic zone with `startOffset: 0`; the rest of the pipeline is identical.

### `Edit`

```ts
interface Edit {
  start: number        // document offset, inclusive
  end: number          // document offset, exclusive
  replacement: string  // '' for deletion
}
```

### `CaptureArg`

The object passed as the first argument to every rewrite callback. `node` and the named
captures are always `RichNode`/`RichNode[]`; `commentMatch` is present only for
comment-gated rules. The index signature is widened to admit `commentMatch` so the type is
sound (an intersection with `Record<string, RichNode | RichNode[]>` is not — it would reject
`commentMatch`):

```ts
type CaptureArg = {
  node: RichNode
  commentMatch?: RegExpExecArray
  [capture: string]: RichNode | RichNode[] | RegExpExecArray | undefined
}
```

### `CompiledRule`

A `CompiledRule` is **plain data plus the user's rewrite function** — no library-generated
closures. `@trast/core` turns `pattern` into a visitor (`matchVisitor`) and `commentRegex`
into a predicate (`leadingCommentPredicate`) at `init()`. This is what lets a rule serialise
(§8): the only function emitted via `.toString()` is the user-authored `rewrite`; everything
else is a `PatternNode` literal and a `RegExp` literal.

```ts
interface CompiledRule {
  language: GrammarId | 'any'
  pattern: PatternNode          // {kind:'any'} for match.any(); {kind:'node',…} for .node(type)
  commentRegex: RegExp | null
  rewrite: (captures: CaptureArg, context: Record<string, unknown>) => RewriteResult
}

type RewriteResult = RichNode | RichNode[] | string | typeof remove
export declare const remove: unique symbol
```

The visitor `matchVisitor(pattern)` produces returns structural captures only (not `node` or
`commentMatch`); the visitor walk (§7) adds those before calling `rewrite`.

One comment predicate per rule. Multiple predicate chaining is not supported in v1.

### `Transformer` and `LazyTransformer`

```ts
interface Transformer {
  transform(source: string, context: Record<string, unknown>): string
}
interface LazyTransformer {
  readonly target: GrammarId | ZoneSplitter
  init(): Promise<Transformer>  // idempotent; WASM loaded at most once per process
}
```

### `PatternNode` (internal to `@trast/match`)

```ts
type PatternNode =
  | { kind: 'exact';   nodeType: string; children: PatternNode[] }  // type + recurse children
  | { kind: 'text';    nodeType: string; text: string }            // leaf: type + literal text
  | { kind: 'node';    nodeType: string }                          // type only (match.<lang>.node)
  | { kind: 'capture'; name: string }   // $feature
  | { kind: 'spread';  name: string }   // $$$body — must be terminal in its sibling list
  | { kind: 'any' }                     // match.any(): any node, no captures
```

Every rule kind reduces to one `PatternNode`, so a single matcher covers them all:
`match.any()` → `{kind:'any'}`, `match.<lang>.node(t)` → `{kind:'node',nodeType:t}`, and a
pattern string compiles to an `exact`/`text` tree.

### `RawRule` (internal to `@trast/match`)

```ts
interface RawRule {
  language: GrammarId | 'any'
  patternString: string | null    // null for match.any() and match.<lang>.node()
  patternContext: 'expr' | 'type'
  nodeType: string | null         // set by .node(type), null otherwise
  commentRegex: RegExp | null
  rewrite: Function
}
```

`compiledRulesFor` lowers `RawRule` → `CompiledRule`: `patternString` is parsed to a
`PatternNode` (§5); `nodeType` becomes `{kind:'node',nodeType}`; both null becomes
`{kind:'any'}`; `commentRegex` passes through unchanged.

---

## 5. Pattern Matching

### The `match` API

```ts
match.tsx.expr`...`        // TSX expression-position structural pattern
match.tsx.type`...`        // TSX type-position structural pattern
match.ts.expr`...`         // TypeScript expression-position structural pattern
match.ts.type`...`         // TypeScript type-position structural pattern
match.js.expr`...`         // JavaScript structural pattern
match.html.expr`...`       // HTML structural pattern
match.css.expr`...`        // CSS structural pattern
match.<lang>.node(type)    // node-type match, scoped to one grammar
match.any()                // language-agnostic; matches any node of any grammar
```

`match` is a plain object of plain namespace objects. No callable namespaces.

Each builder exposes:
- `.whenLeadingComment(re: RegExp): this` — gates on a matching leading comment. HTML
  directive comments are leading comments too (§6), so this one method covers them; there is
  no separate `.htmlComment`.
- `.rewrite(fn): RawRule` — finalises the chain

### Template literal → `PatternNode`

Executed during `init()` / `compiledRulesFor()`, not at rule-definition time.

**Step 1 — Extract captures.** Scan the raw pattern string with
`/\$\$\$([A-Za-z_][A-Za-z0-9_]*)|(\$[A-Za-z_][A-Za-z0-9_]*)/g`. Build a registry
`{ placeholder, name, spread }[]`. Assert that no capture uses the reserved names
`node` or `commentMatch`.

**Step 2 — Substitute.** Replace each capture with a unique mangled identifier
(`__TRAST_0__`, `__TRAST_1__`, …). These are valid identifiers in all grammars and
parse as `identifier` nodes.

**Step 3 — Context wrap (`type` only).** When `patternContext === 'type'`, prepend
`type __trast_p__ = ` to the substituted string before parsing. This forces
tree-sitter to interpret `<…>` as generic brackets, not comparison operators.

**Step 4 — Parse.** `Parser.parse(substituted, lang)`.

**Step 5 — Build `PatternNode` tree.** Recursive descent over `children` (named,
comment-free). For `patternContext === 'type'`, first extract the inner type node from the
`type_alias_declaration` wrapper. Then `build(node)`:

```
build(node):
  if isPlaceholder(node):                  // 1. bare placeholder (expression position)
    return placeholderNode(node)           //    → capture | spread
  if node.children.length === 0:           // 2. leaf → match type + literal text
    return { kind: 'text', nodeType: node.type, text: node.text }
  children = node.children.map(child =>     // 3. structural → match type, recurse,
    liftArtifact(child) ?? build(child))    //    lifting placeholders out of parse artifacts
  assert no spread in children except the last
  return { kind: 'exact', nodeType: node.type, children }

liftArtifact(child):
  // A bare placeholder in statement / type-member position is wrapped by the parser in a
  // transparent node the author never wrote. Collapse exactly that ONE wrapper, so the
  // capture/spread becomes a direct child here — never a replacement for the real container.
  if isArtifactWrapper(child) && child.children.length === 1 && isPlaceholder(child.children[0]):
    return placeholderNode(child.children[0])
  return null

isArtifactWrapper(node):
  node.type === 'expression_statement'                                  // { $$$body }, { $stmt }
  || (patternContext === 'type' && node.type === 'property_signature')  // { $$$branches }

isPlaceholder(node):                       // grammar-agnostic: by text, not node type
  node.children.length === 0 && /^__TRAST_\d+__$/.test(node.text)

placeholderNode(node):                     // registry lookup by node.text → capture | spread
```

Two things this gets right:

- **Capture detection is by text, not by `node.type`.** A bare placeholder parses as
  `identifier` in JS/TS but `plain_value`/`tag_name`/`text` in CSS/HTML, so keying on
  `'identifier'` would silently miss CSS/HTML captures. `isPlaceholder` checks the leaf's
  text, so it works in every grammar.

- **Placeholders are lifted out of the *artifact* wrapper only — never out of the real
  container.** `{ $$$body }` parses as `block → expression_statement → identifier`; the lift
  collapses the `expression_statement` so the block's children become `[spread(body)]`, while
  the `block` (the `{ }` the author wrote) is kept as an `exact` node — giving the §9 fixture
  `body: [return_statement]`. Likewise `BATI.If<{ $$$branches }>` lifts the spread out of its
  `property_signature` up to the `object_type`. The lift is deliberately **one wrapper deep
  and restricted to artifact node types**: a recursive collapse would swallow the `block`
  itself, turning `if (…) { $$$then } else { … }` into a spread that consumes the `else`
  clause. A single capture in statement position (`{ $stmt }`) likewise binds the statement
  itself, not its `expression_statement` shell.

The terminal-spread assertion runs *after* lifting, on the final `children` array.

### Pattern matching

```ts
function matchPattern(
  pattern: PatternNode,
  node: RichNode
): Record<string, RichNode | RichNode[]> | null
```

```
match(p, node):
  'any':     {}
  'node':    node.type === p.nodeType ? {} : null
  'text':    node.type === p.nodeType && node.text === p.text ? {} : null
  'exact':   node.type !== p.nodeType → null
             else matchChildren(p.children, node.children)
  'capture': { [p.name]: node }
  'spread':  assert — handled by matchChildren only

matchChildren(patterns, nodes):
  caps = {}; pi = ni = 0
  while pi < patterns.length:
    p = patterns[pi]
    if p.kind === 'spread':
      caps[p.name] = nodes.slice(ni)
      return caps
    if ni >= nodes.length: return null
    sub = match(p, nodes[ni])
    if sub is null: return null
    Object.assign(caps, sub); pi++; ni++
  if ni < nodes.length: return null
  return caps
```

`node.children` here is the comment-free named list from §4 — the same surface `build`
walked — so patterns and targets are compared like-for-like.

---

## 6. Comment Attachment

`attachComments(root)` visits every parent node bottom-up (children before parent)
and classifies each named comment node among its siblings.

```
for each parent in post-order traversal:
  named = parent.allChildren.filter(n => n.isNamed)
  for i, child of named:
    if child.type not in COMMENT_TYPES[child.language]: continue
    prev = last non-comment named node before i   (null if none)
    next = first non-comment named node after i   (null if none)

    if next is null:                                            → inner of parent
    elif prev is not null
         && child.startPosition.row === prev.endPosition.row:  → trailing of prev
    elif next.startPosition.row − child.endPosition.row === 1: → leading of next
    else:                                                       → inner of parent
```

`COMMENT_TYPES` is a constant in `src/comment-attachment.ts`, also imported by
`rich-node.ts` to keep comments out of `children` (one source of truth for "what is a
comment node"):
`{ javascript: {'comment'}, typescript: {'comment'}, tsx: {'comment'}, html: {'comment'}, css: {'comment'} }`.

The adjacent-line condition (`row diff === 1`) means exactly zero blank lines between
comment and target node. A blank line (diff ≥ 2) makes the comment float — it does not
gate the following node.

### JSX attributes

`jsx_opening_element` contains `jsx_attribute` and `comment` nodes as named children.
A comment between two attributes satisfies the adjacent-line condition with the
following attribute and becomes its **leading comment**. This is the mechanism behind
`match.tsx.node('jsx_attribute').whenLeadingComment(re)`.

A comment after the last `jsx_attribute` (before `/>`) has no following named
non-comment sibling and becomes an **inner comment of `jsx_opening_element`**. v1 does
not expose a `.whenInnerComment()` predicate. This is a documented v1 limitation:
directive comments must appear before the attribute they gate, never after the last one.

### Edit range for comment-predicated rules

When a comment predicate fires, the edit must consume both the comment and the target
node so the directive comment is never left as a dangling orphan:

```
editStart = min(comment.documentStartIndex, node.documentStartIndex)
editEnd   = node.documentEndIndex
replacement = result === remove ? '' : resolvedNodeText
```

---

## 7. Transform Pipeline

### `splitAndParse(source, target): Zone[]`

Exported from `zone-splitter.ts`; `create-transformer.ts` imports it. Reduces
single-grammar and SFC targets to the same representation so the rest of the pipeline has
one code path. The splitter's `init()` (grammar load) happens in `createTransformer.init`,
so by the time `split()` runs here the grammar is ready and the call is synchronous.

```
if typeof target === 'string':          // GrammarId
  rawZones = [{ language: target, source, startOffset: 0 }]
else:                                   // ZoneSplitter
  rawZones = target.split(source)

return rawZones.map(z => {
  tree = Parser.parse(z.source, z.language)
  root = wrapNode(tree.rootNode, z.language, z.startOffset)
  return { language: z.language, source: z.source, startOffset: z.startOffset, tree: root }
})
```

### `createTransformer(target, rules: CompiledRule[]): LazyTransformer`

`init()`:
1. `Parser.init()` — idempotent
2. Load grammars: `typeof target === 'string' ? [target] : target.grammars`; if `target` is
   a `ZoneSplitter`, also `await target.init()` (loads its own parsing grammar)
3. Compile each rule's data once into the runtime rule the visitor walk consumes:
   `visitor = matchVisitor(rule.pattern)` and
   `commentPredicate = rule.commentRegex ? leadingCommentPredicate(rule.commentRegex) : null`
4. Returns a `Transformer` closed over `target` and these compiled rules

### `Transformer.transform(source, context)`

```
zones = splitAndParse(source, target)
coll  = new EditCollector()
for zone of zones:
  attachComments(zone.tree)
  zoneRules = rules.filter(r => r.language === zone.language || r.language === 'any')
  visit(zone.tree, zoneRules, coll, context, source)
return coll.apply(source)
```

All `RichNode` offsets are document offsets (`documentStartIndex = startIndex + zone.startOffset`), so edits are always in document space and require no further remapping.

### Visitor

```
visit(node, rules, collector, context, source):
  for rule of rules:                     // already filtered to this zone's language + 'any'
    caps = rule.visitor(node)
    if caps is null: continue

    cm = null
    if rule.commentPredicate:
      cm = rule.commentPredicate(node)
      if cm is null: continue

    captureArg = { node, ...caps }
    if cm: captureArg.commentMatch = cm.match

    editStart = cm ? min(cm.comment.documentStartIndex, node.documentStartIndex)
                   : node.documentStartIndex
    editEnd   = node.documentEndIndex

    replacement = resolveResult(rule.rewrite(captureArg, context), source)
    collector.add({ start: editStart, end: editEnd, replacement })
    return  // outer-wins: subtree skipped after first match

  for child of node.children:
    visit(child, rules, collector, context, source)
```

```
resolveResult(result, source):
  result === remove          → ''
  typeof result === 'string' → result
  Array.isArray(result)      → result.length
                                 ? source.slice(result[0].documentStartIndex,
                                                result.at(-1).documentEndIndex)
                                 : ''
  'text' in result           → result.text
  assert false
```

A `RichNode[]` result (e.g. a `$$$body` spread that is kept) re-emits as the **source span**
from the first node's start to the last node's end — not `node.text` joined. Joining would
drop everything *between* the nodes: newlines and indentation (so `return a` + `return b`
would mash into `return areturn b`), trailing semicolons, and comments (which are excluded
from `children`). Slicing the original source preserves all of it. The nodes are assumed
contiguous in source, which a spread capture always guarantees.

No whitespace synthesis beyond that. Callers run Prettier.

### `EditCollector`

```
add(edit):
  for e of this.edits:
    if e.start < edit.end && edit.start < e.end: return  // overlap — first-wins, silent
  insert edit in order by start

apply(source):
  for edit of this.edits.toReversed():
    source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end)
  return source
```

---

## 8. Code Generation (`trast build`)

### What `trast build` does

The rule file declares its targets explicitly — grammar ids and/or splitter values:

```ts
export default defineRules(({ context }) => [ … ])
export const targets = ['tsx', 'typescript', 'css', vueSplitter]  // vueSplitter from @trast/vue
```

1. Imports the compiled rule file (user runs `tsc`/`tsup` first, or `trast build` does it
   internally via a bundler API), reading its default `RuleSetBuilder` and `targets`.
2. For each `target` in `targets`, calls `compiledRulesFor(target)` and emits
   `dist/<stem>.js`, where `stem` is the `GrammarId` string or the splitter's `id`.
3. Writes `dist/index.js` barrel and a `dist/package.json` with `"sideEffects": false`.
4. Prints the grammar packages the chosen `targets` require — derived from each target's
   `GrammarId`(s) — so the shipping tool knows exactly which optional peers (§2) to add to
   its own `dependencies`. Explicit `targets` makes this exact, never a guess.

Explicit `targets` is what lets a splitter live outside core: there is no hard-coded list of
"known splitters" to enumerate. `compiledRulesFor` collects rules whose `language` matches
the target — `=== grammarId` for a `GrammarId`, `∈ splitter.grammars` for a `ZoneSplitter` —
plus every `'any'` rule.

### Emitted file shape

A compiled rule is emitted as **data plus one user function**: the `PatternNode` as a JSON
literal, the comment gate as a `RegExp` literal, and only the user-authored `rewrite` via
`.toString()`. `createTransformer` (from core) turns the data into the runtime visitor and
predicate at load time — the emitted file never names `matchVisitor`,
`leadingCommentPredicate`, or any `PatternNode`-walking code.

Single-grammar file (`dist/tsx.js`):

```js
// generated by trast build
import { createTransformer, remove } from '@trast/core'
export const transform = createTransformer('tsx', [
  {
    language: 'tsx',
    pattern: { kind: 'exact', nodeType: 'if_statement', children: [ /* … */ ] },
    commentRegex: null,
    rewrite: (caps, context) => /* user source */,
  },
  // …
])
```

SFC file (`dist/vue.js`) — same shape; `vueSplitter` is imported from `@trast/vue` and
passed as target:

```js
// generated by trast build
import { createTransformer, remove } from '@trast/core'
import { vueSplitter } from '@trast/vue'
export const transform = createTransformer(vueSplitter, [
  { language: 'typescript', pattern: …, commentRegex: …, rewrite: … },
  { language: 'html',       pattern: …, commentRegex: …, rewrite: … },
  { language: 'any',        pattern: …, commentRegex: …, rewrite: … },
  // …
])
```

The only `.toString()` of a function is the user-authored `rewrite`, which is sound because
it references only its arguments, `remove`, any navigation helper it calls, and `RichNode`
property accesses (`trast build` adds `remove` and any referenced helper to the import line —
see below). `pattern` and `commentRegex` are plain serialisable data, so the matcher and
predicate cannot drift between dev and compiled modes — both are built by the same
`@trast/core` functions.

### Emitted file structure

```
dist/
  tsx.js           ← createTransformer('tsx', …)
  typescript.js    ← createTransformer('typescript', …)
  javascript.js    ← createTransformer('javascript', …)
  html.js          ← createTransformer('html', …)
  css.js           ← createTransformer('css', …)
  vue.js           ← createTransformer(vueSplitter, …)
  index.js         ← barrel
  package.json     ← "sideEffects": false
```

```js
// dist/index.js
export { transform as tsx }        from './tsx.js'
export { transform as typescript } from './typescript.js'
export { transform as javascript } from './javascript.js'
export { transform as html }       from './html.js'
export { transform as css }        from './css.js'
export { transform as vue }        from './vue.js'
```

Callers import only the targets they use. With `sideEffects: false`, bundlers
tree-shake unused grammar WASM files.

### Constraint on rewrite callbacks

Rewrite callbacks must be self-contained. The only external references allowed are the
function arguments (`captureArg`, `context`), the `remove` sentinel, the `@trast/core`
navigation helpers (`getPropertySignatures`, `getPropertyName`, `getConditionalBranches`),
and property accesses on `RichNode` captures. `trast build` resolves the imports for the
emitted file by scanning each `rewrite` source for these names: `createTransformer` and
`remove` are always imported, and any referenced helper is added to the import line — so
`css.js` never imports the TypeScript-type helpers, and `tsx.js` imports only what it uses.
References to anything else (a variable or helper defined outside `defineRules`) serialise as
dangling identifiers and fail at runtime with `ReferenceError`; `trast build` does not
validate for that.

**Alternatives considered for helper access.** (A) the scan-and-import above — chosen, no
authoring ceremony and minimal imports; (B) always import every helper and rely on
tree-shaking — simpler build, but noisier generated files; (C) pass the helpers as a third
`rewrite` argument (`(caps, ctx, helpers) => …`) so nothing needs importing — the most
self-contained-by-construction, kept in reserve if the helper set grows large enough that
scanning feels fragile.

### Dev mode (no build step)

```ts
import { defineRules, match } from '@trast/match'
import { vueSplitter } from '@trast/vue'

const rules = defineRules(({ context }) => [ … ])

const tsx = await rules.forTarget('tsx')        // for .tsx files
const vue = await rules.forTarget(vueSplitter)  // for .vue files — same rule set

tsx.transform(tsxSource, context)  // sync after init
vue.transform(vueSource, context)  // zone-splits internally, same interface
```

`forTarget` calls `compiledRulesFor` internally and passes the result to
`createTransformer`. The `Transformer` interface is identical across all targets.

---

## 9. Test Strategy

### `@trast/core`

**`parser.test.ts`:** `init()` is idempotent; `parse` returns correct root type per
grammar; grammar loading is lazy (no tsx grammar loaded if only typescript is parsed).

**`rich-node.test.ts`:** `children` excludes anonymous tokens for an `if_statement`;
`child('consequence')` returns the correct named child;
`text === source.slice(startIndex, endIndex)`;
`documentStartIndex === startIndex + zone.startOffset`.

**`comment-attachment.test.ts`** — parameterised over source fixtures:

```
fixtures/comment-attachment/
  leading-adjacent.ts      // comment immediately before node → leading
  leading-blank-line.ts    // blank line between comment and node → inner
  trailing-same-line.ts    // comment on same line as preceding node → trailing
  inner-last-in-block.ts   // comment at end of block → inner
  jsx-between-attrs.tsx    // comment between attrs → leading of next attr
  jsx-after-last-attr.tsx  // comment after last attr → inner of element
  html-before-element.html // HTML comment before element → leading
```

Each fixture has a companion `.json` describing expected associations as
`{ nodePath, attachmentKind, commentText }[]`.

**`zone-splitter.test.ts`:** `splitAndParse` over a stub two-zone `ZoneSplitter` produces
`Zone[]` where each `zone.tree` root type matches the grammar, and over a `GrammarId`
produces one zone with `startOffset: 0`. Explicit offset assertion:
`zone.source === outerSource.slice(zone.startOffset, zone.startOffset + zone.source.length)`.
(`vueSplitter`'s own boundary-finding is tested in `@trast/vue` — core has no Vue
dependency.)

**`edit-collector.test.ts`:** Non-overlapping edits applied in reverse order;
overlapping edit silently dropped; identity on empty set.

**`pattern-matcher.test.ts`:** `matchPattern` over hand-built `PatternNode`s — `exact`
recurse, `text` type+text, `node` type-only, `any`, `capture`, and `spread` capturing the
rest of a sibling list; null on type mismatch and on child-count mismatch.

**`comment-predicate.test.ts`:** `leadingCommentPredicate(re)` returns the matching leading
comment + `RegExpExecArray`, and `null` when no leading comment matches.

### `@trast/match`

**`pattern-parser.test.ts`:** Given pattern + lang + context, assert `PatternNode` tree
shape. Cover: single capture; spread capture **lifted** out of its `expression_statement`
wrapper so it sits directly under the block; leaf → `text` (e.g. `BATI`, `has`); structural
→ `exact`; type-wrapper extraction; a CSS/HTML capture (placeholder detected by text, not
`node.type`); reserved name throws; non-terminal spread throws.

**End-to-end matching** is covered by the integration fixtures below (and `matchPattern` unit
tests live in `@trast/core`). The canonical case:
```
source:   'if (BATI.has("auth")) { return true }'
pattern:  'if (BATI.has($feature)) { $$$body }'
expected: { feature: string("auth"), body: [return_statement] }
```

**Integration tests** — each is `(ruleFactory, inputFixture, contextFixture) → expectedFixture`:

```
fixtures/integration/
  bati-if-else/              input.tsx, {with,without}-feature.{json,expected.tsx}
  bati-ternary/
  bati-comment-gated/
  bati-jsx-attr/
  bati-html-comment/
  bati-ts-type/              BATI.If<> collapsing
  nested-conditionals/       outer if wraps inner if, both BATI.has
  comment-last-jsx-attr/     comment after last attr → inner of element, not attr
  comment-blank-line/        blank-separated comment → not leading, no gate fires
  conflict-first-wins/       two rules match same range → first rule wins
  vue-sfc/                   .vue file, rules applied to template and script zones
```

Test shape:
```ts
it('description', async () => {
  const t = await defineRules(ruleFactory).forTarget('tsx')
  expect(t.transform(readFixture('input.tsx'), loadContext('context.json')))
    .toBe(readFixture('expected.tsx'))
})
```

### `@trast/vue`

**`vue-splitter.test.ts`:** `vueSplitter.split(basicVueSrc)` returns 3 raw zone descriptors
with correct `language`, `startOffset`, `source`. Explicit assertion:
`zone.source === outerSource.slice(zone.startOffset, zone.startOffset + zone.source.length)`
— the place an off-by-one would hide (§10.4). A `<script>` whose body contains the text
`'</script>'` inside a string still splits correctly (boundaries come from the
`tree-sitter-vue` CST, not a regex).

### `@trast/cli`

**`build.test.ts`:** `trast build fixtures/rules/bati-rules.ts --output tmp/` emits
`tmp/tsx.js` and `tmp/vue.js`. `tsx.js` imports only from `@trast/core` (no `@trast/match`,
no `@trast/vue`). `vue.js` imports `vueSplitter` from `@trast/vue`. Each emitted file's rules
are plain data (`pattern`/`commentRegex`) plus a `rewrite` arrow. Parity assertion: importing
the emitted transformer and calling `transform(input, context)` produces the same string as
the matching dev-mode integration fixture.

**`run.test.ts`:** `--dry-run` writes no files; `--in-place` modifies files in a temp
directory; `--context` JSON is parsed and threaded through.

---

## 10. Known Hard Problems

### 1. TypeScript type-position patterns

`match.ts.type\`BATI.If<{ $$$branches }>\`` wraps the pattern in `type __trast_p__ =
<pattern>` before parsing so `<` and `>` are read as generic brackets. After parsing,
the inner type node is extracted from the `type_alias_declaration` wrapper.

`$$$branches` inside `{ … }` in type position parses as a `property_signature` with no type
annotation. The lone-placeholder lift (§5) raises the spread out of that `property_signature`
to the `object_type`'s sibling list, where it captures all of the type's named children.
`@trast/core` exports three helpers for navigating the captured nodes in rewrite callbacks —
thin wrappers over `node.child(fieldName)`: `getPropertySignatures`, `getPropertyName`,
`getConditionalBranches` (imported into the emitted file by `trast build`, §8). These spare
the caller from needing to know tree-sitter TypeScript field names.

### 2. Pattern parser bootstrapping

`defineRules()` runs at module import time. WASM is not yet loaded. Pattern strings are
stored raw in `RawRule` and compiled to `PatternNode` trees only inside `init()` /
`compiledRulesFor()`. Pattern syntax errors surface at `init()` time. `trast build`
catches them at build time; dev-mode tests catch them in `beforeAll`.

### 3. JSX comment after last attribute

The comment attachment algorithm correctly classifies the comment as an inner comment
of `jsx_opening_element` — this is the right result, not a defect. The v1 rule builder
has no `.whenInnerComment()` predicate, so this case cannot be gated in v1. The
documented constraint: directive comments must appear before the attribute they gate,
never after the last attribute. A fixture (`jsx-after-last-attr`) and guide note make
this explicit.

### 4. SFC zone offset remapping

Zone `source` must be exactly `outerSource.slice(startOffset, endOffset)` — never
trimmed, never padded. `vueSplitter` uses the `tree-sitter-vue` CST to locate
boundaries, which avoids false matches on `<script>` in template string content. The
test `zone.source === outerSource.slice(zone.startOffset, zone.startOffset + zone.source.length)`
must be explicit; it is the most likely place for an off-by-one to hide.

### 5. `.toString()` scope

`function.toString()` captures source text only. A rewrite that closes over a helper
defined outside `defineRules()` serialises with a dangling reference and fails at
runtime with `ReferenceError`. This is a documented authoring constraint, not a
guarded code path. No detection at build time.

### 6. `match.any()` duplication in emitted modules

`match.any()` rules are emitted into every output file including `vue.js`. At Bati
scale (a few rules, five grammars plus vue) this is negligible. If it becomes a
concern, extract language-agnostic rules to a shared `common.js` that each output file
imports — a localised change to the serialiser with no API impact.
