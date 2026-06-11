# @codegraft/rules

Ready-made codemods — ESLint-rule-style transforms authored with [`@codegraft/codemod`](../codemod) and the `@codegraft/core` scope resolver.

Each rule lives in its own module, is re-exported by name from the barrel, and the package is `"sideEffects": false` — so a consumer that imports one rule tree-shakes the rest. Every rule runs live via `forTarget` — directly, through `@codegraft/unplugin`, or `codegraft run`.

## Rules

### `removeUnusedImports`

Removes imports whose local binding is never referenced, and rewrites value imports used only in type positions into type imports — the analogue of `eslint-plugin-unused-imports` plus the import half of `@typescript-eslint/consistent-type-imports`. Syntactic, single-file, and **confident-or-abstain**: it keeps anything it can't prove unused and never emits invalid code.

Per binding, three outcomes:

- **value-used** → kept as-is (a value import already serves type positions);
- **type-used only** → rewritten as a type import — inline `import { type X }` next to a surviving value specifier, or a whole `import type …` when the entire statement becomes type-only (covers default and `* as ns` too);
- **unused** → removed, including unused `import type …` and inline `{ type X }`; the whole statement goes when every binding is unused, otherwise the clause is rebuilt from the survivors.

Safety, always erring towards code that still compiles:

- never touches a side-effect import (`import 'x'`);
- abstains on the whole file when the scope resolver can't model it (`with` / `eval` / a TS `namespace` / ambient `module`);
- value-use detection is scope-aware (a use shadowed in an inner scope doesn't keep an outer import alive), and `typeof X` counts as a value use;
- a type-only default/namespace that shares a statement with a surviving value binding is kept as a value import rather than split across two statements (safe, just not erasable).

```ts
import { removeUnusedImports } from '@codegraft/rules'

const transform = await removeUnusedImports.forTarget('tsx')
transform.transform("import { used, unused } from 'm'\nused()", {})
// → "import { used } from 'm'\nused()"
transform.transform("import { Foo } from 'm'\nlet v: Foo", {})
// → "import type { Foo } from 'm'\nlet v: Foo"
```

It works on every JS-family grammar (JS / JSX / TS / TSX) and, through a `ZoneSplitter`, a Vue SFC — pruning the `<script>` while keeping a binding used only from a sibling zone: a component `<Tag>`, a custom `v-directive`, an interpolation/binding expression, a `<style> v-bind()`, or a second `<script>`.

The rule module is also a ready codemod (default export + `targets: ['javascript', 'typescript', 'tsx']`), so the CLI runs it directly — `.vue` `<script>` included, via the cli's built-in splitter:

```bash
codegraft run "src/**/*.{ts,tsx,vue}" --codemod @codegraft/rules/remove-unused-imports --in-place
```

See the root [README](../../README.md#ready-made-rules-codegraftrules) for how to wire a rule into a bundler or `codegraft run`.

## Adding a rule

1. Add `src/<rule-name>.ts` exporting a `defineCodemod(...)` result.
2. Re-export it from `src/index.ts`.
3. Add `src/<rule-name>.test.ts`, covering each grammar you support plus the `vueSplitter` path and the abstain cases.
