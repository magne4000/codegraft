# Codemod API expansion — plan

Close the greenlit jscodeshift gaps **within Trast's paradigm**: text edits over a read-only
CST, every author-facing method hanging off `root`/`node` (so `trast build` serialisation keeps
working), edits routed through the existing `EditCollector` (no new primitives), and
confident-or-abstain for anything resolution-related. No new runtime dependencies.

Greenlit: construction (§1), querying (§2), navigation + scope (§3), mutation (§4), comments
(§9). **Deferred** to a later step: print / formatting options (§5) — see the end.

**Order** (most authoring leverage first): mutation → construction → querying → navigation/scope
→ comments → docs.

**Per-phase conventions**: new surface lives on `Collection`; each phase adds unit tests plus one
compiled-mode parity check for any new author-facing method; the suite stays green; one commit per
phase. Rough size: ~350–590 LOC source + tests, ~35–55 kB all-in.

---

## Phase 1 — Functional mutation API (§4)

New `Collection` edit methods, each compiling to existing collector ops:

- `replaceWith(text | (c: Collection) => string)` — add the callback form (today string-only);
  applied per selected node, the callback receives a single-node `Collection`.
- `insertBefore` / `insertAfter` — same callback form.
- `mapText((text: string) => string)` — overwrite each node with `fn(node.text)`.
- `setField(name, text | (cur: string) => string)` — overwrite the field child's range; no-op when
  the field is absent (mirrors `field()` returning an empty selection).
- `wrap(before: string, after: string)` — `insertLeft(start, before)` + `insertRight(end, after)`.
- `moveBefore(target) / moveAfter(target)` — capture `node.text`, `remove()` the source, insert the
  captured text at `target`. Assert source/target disjoint.

Decisions: callbacks return `string` (no node values exist — keeps bodies serialisable); no new
`EditCollector` primitives; multi-node selections apply the op per node.

Tests: callback replace; `mapText`; `setField` (present + absent); `wrap`; `move` (reorder two
statements); compiled-mode parity for a codemod using `mapText` + `wrap`.

## Phase 2 — `code` validated builder (§1)

`Collection.code` — a tagged template returning a grammar-validated string:

```ts
node.replaceWith(code`${name}()`)
```

- Interpolation: a `string` inlines; a `RichNode` / `Collection` contributes its `.text`.
- Validation: parse the produced string with the grammar of the (first) selected node — reuse the
  already-loaded `Parser`; assert `!rootNode.hasError`, naming the snippet on failure.
- Returns `string`, so it composes with every insert/replace method and stays param-rooted.

Decisions: a `Collection` method (not a free import) so it can read the node's language and remain
serialisable; validation grammar = the selected node's language, falling back to the target's first
grammar for an empty/root-spanning selection.

Tests: interpolates a name; rejects a malformed snippet (asserts); round-trips through `append`;
compiled-mode parity.

## Phase 3 — Richer querying (§2)

**3a (certain):**
- Nested field matchers — `AttrMatcher` gains a recursive object form:
  `find('call_expression', { function: { object: 'foo' } })`, descending via `node.child(key)`.
- `isOfType(type)` / `getTypes()` helpers.

**3b (supertypes — feasible via web-tree-sitter 0.26 `Language.supertypes` / `subtypes(id)`):**
- `find(type)` where `type` is a grammar supertype (e.g. `expression`, `declaration`) expands to its
  concrete subtypes.
- Add a `Parser` helper `subtypesOf(grammar, typeName): string[]` using `language.supertypes`,
  `language.subtypes(id)`, and the id↔name mapping; cache per grammar.

Tests: nested filter match/non-match; `isOfType` / `getTypes`; supertype query matching several
concrete types.

## Phase 4 — Navigation + scope helpers (§3)

**Navigation (structural, certain):** `siblings()`, `nextSibling()`, `prevSibling()`,
`ancestors(type?)`, `descendants(type?)`, `closestScope()` (nearest scope-boundary ancestor:
program / statement_block / function-like / for / catch / class body).

**Scope queries (confident-or-abstain, JS/TS/TSX; layered on the existing resolver):** extend the
internal `Resolver` with `bindingsInScope(node)` and `lookup(node, name)`; expose as
`Collection.bindingsInScope()` / `lookup(name)`.

Decisions: `closestScope` is structural (no resolver dependency) so it works regardless of
abstention; scope queries return `null` on abstention, same contract as `references`/`definition`.

Tests: sibling/ancestor/descendant navigation; `closestScope`; `lookup` resolves a binding and
abstains inside `with`/`eval`.

## Phase 5 — Comment helpers (§9)

Text-edit helpers over the attached comment data:
- `addLeadingComment(text)` — insert before the node's start (with newline/indent).
- `addTrailingComment(text)`.
- `removeComments()` — remove the node's leading + trailing comment ranges.
- `mapLeadingComment((text) => string)` — rewrite the first leading comment.

Tests: add leading/trailing; remove; map. (Generalises the existing `dropDirective`.)

## Phase 6 — Docs

- Extend the README codemod section with the new methods (construction, mutation, querying,
  navigation, comments).
- Revise "Compared to other tools": mark the now-closed gaps (callback/derived mutation, nested +
  supertype queries, comment manipulation, validated construction) while keeping the honest
  remainders (typed AST builders, full programmable scope, cross-file).

---

## Deferred — print / formatting options (§5)

Not in this plan; revisit later. Trast emits text and leaves formatting to Prettier, so
print-option control (quote style, trailing commas, wrap column) fights the byte-exact model. If
wanted, it's a separate, larger step — a formatting pass over emitted ranges, or a Prettier
hand-off API.
