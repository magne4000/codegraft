import { describe, it, expect } from 'vitest'
import { vueSplitter } from '@codegraft/vue'
import codemodDefault, { removeUnusedImports, targets } from './remove-unused-imports.js'

const on = (target: Parameters<typeof removeUnusedImports.forTarget>[0]) => removeUnusedImports.forTarget(target)

describe('removeUnusedImports — codegraft-run shape', () => {
  it('default-exports the codemod and declares JS-family targets', async () => {
    expect(codemodDefault).toBe(removeUnusedImports)
    expect(targets).toEqual(['javascript', 'typescript', 'tsx'])
    // the shape `codegraft run` consumes: forTarget(target) yields a working transformer
    const transform = await codemodDefault.forTarget('typescript')
    expect(transform.transform("import { a } from 'm'\nb()", {})).toBe('b()')
  })
})

describe('removeUnusedImports — whole-statement removal', () => {
  it('drops a fully-unused named import', async () => {
    const t = await on('tsx')
    expect(t.transform("import { foo } from 'm'\nbar()", {})).toBe('bar()')
  })

  it('drops an unused default import', async () => {
    const t = await on('tsx')
    expect(t.transform("import foo from 'm'\nbar()", {})).toBe('bar()')
  })

  it('drops an unused namespace import', async () => {
    const t = await on('tsx')
    expect(t.transform("import * as ns from 'm'\nbar()", {})).toBe('bar()')
  })

  it('drops a statement only when every binding is unused', async () => {
    const t = await on('tsx')
    expect(t.transform("import { a, b } from 'm'\nuse(a, b)", {})).toBe("import { a, b } from 'm'\nuse(a, b)")
  })
})

describe('removeUnusedImports — partial specifier removal', () => {
  it('keeps the used specifiers and rebuilds the clause', async () => {
    const t = await on('tsx')
    expect(t.transform("import { a, b, c } from 'm'\nuse(b)", {})).toBe("import { b } from 'm'\nuse(b)")
  })

  it('preserves an alias on a surviving specifier', async () => {
    const t = await on('tsx')
    expect(t.transform("import { a, b as c } from 'm'\nuse(c)", {})).toBe("import { b as c } from 'm'\nuse(c)")
  })

  it('keeps the trailing semicolon when it rewrites a pruned import', async () => {
    // The `;` is part of the import_statement node; rewriting the statement must carry it back.
    const t = await on('tsx')
    expect(t.transform('import { a, b } from "x";\nexport const z = a;', {})).toBe('import { a } from "x";\nexport const z = a;')
  })

  it('does not invent a semicolon when the original omits one (ASI)', async () => {
    const t = await on('tsx')
    expect(t.transform('import { a, b } from "x"\nexport const z = a', {})).toBe('import { a } from "x"\nexport const z = a')
  })

  it('removes an unused alias, keying off the local name', async () => {
    const t = await on('tsx')
    expect(t.transform("import { a as b, keep } from 'm'\nuse(keep)", {})).toBe("import { keep } from 'm'\nuse(keep)")
  })

  it('drops an unused default but keeps used named imports', async () => {
    const t = await on('tsx')
    expect(t.transform("import def, { x } from 'm'\nuse(x)", {})).toBe("import { x } from 'm'\nuse(x)")
  })

  it('drops unused named imports but keeps a used default', async () => {
    const t = await on('tsx')
    expect(t.transform("import def, { x } from 'm'\nuse(def)", {})).toBe("import def from 'm'\nuse(def)")
  })

  it('keeps a used default but drops a used-nowhere namespace', async () => {
    const t = await on('tsx')
    expect(t.transform("import def, * as ns from 'm'\nuse(def)", {})).toBe("import def from 'm'\nuse(def)")
  })
})

describe('removeUnusedImports — usage detection across the JS family', () => {
  it('counts a JSX element name as a use (tsx)', async () => {
    const t = await on('tsx')
    const src = "import { Foo } from 'm'\nconst x = <Foo />"
    expect(t.transform(src, {})).toBe(src)
  })

  it('counts a JSX member usage as a use (tsx)', async () => {
    const t = await on('tsx')
    const src = "import { Foo } from 'm'\nconst x = <Foo.Bar />"
    expect(t.transform(src, {})).toBe(src)
  })

  it('works on plain JavaScript', async () => {
    const t = await on('javascript')
    expect(t.transform("import { foo, bar } from 'm'\nbar()", {})).toBe("import { bar } from 'm'\nbar()")
  })

  it('works on TypeScript', async () => {
    const t = await on('typescript')
    expect(t.transform("import { foo, bar } from 'm'\nconst x = bar()", {})).toBe(
      "import { bar } from 'm'\nconst x = bar()",
    )
  })
})

describe('removeUnusedImports — type-aware (value↔type)', () => {
  it('rewrites a value import used only as a type into a type import', async () => {
    const t = await on('typescript')
    expect(t.transform("import { Foo } from 'm'\nlet v: Foo = nothing", {})).toBe(
      "import type { Foo } from 'm'\nlet v: Foo = nothing",
    )
  })

  it('rewrites only the type-used specifier inline, keeping a value-used sibling', async () => {
    const t = await on('typescript')
    expect(t.transform("import { A, B } from 'm'\nlet x: A = B()", {})).toBe("import { type A, B } from 'm'\nlet x: A = B()")
  })

  it('rewrites a default import used only as a type', async () => {
    const t = await on('typescript')
    expect(t.transform("import Foo from 'm'\nlet v: Foo", {})).toBe("import type Foo from 'm'\nlet v: Foo")
  })

  it('rewrites a namespace import used only as a qualified type', async () => {
    const t = await on('typescript')
    expect(t.transform("import * as NS from 'm'\nlet v: NS.Thing", {})).toBe(
      "import type * as NS from 'm'\nlet v: NS.Thing",
    )
  })

  it('keeps a value import that is used as a value, even if also used as a type', async () => {
    const t = await on('typescript')
    const src = "import { Foo } from 'm'\nlet v: Foo = new Foo()"
    expect(t.transform(src, {})).toBe(src)
  })

  it('treats `typeof X` as a value use (keeps the value import)', async () => {
    const t = await on('typescript')
    const src = "import { Val } from 'm'\nlet q: typeof Val"
    expect(t.transform(src, {})).toBe(src)
  })

  it('removes a type-only import that is unused', async () => {
    const t = await on('typescript')
    expect(t.transform("import type { Foo } from 'm'\nbar()", {})).toBe('bar()')
  })

  it('keeps a type-only import referenced only through `typeof`', async () => {
    const t = await on('typescript')
    // `typeof f` lexes its operand as a value `identifier`, not a `type_identifier`; an `import
    // type` binding scores `valueUsed === false`, so without the type-query scan it reads unused.
    expect(t.transform('import type { f, g } from "x"\ntype T = ReturnType<typeof f>', {})).toBe(
      'import type { f } from "x"\ntype T = ReturnType<typeof f>',
    )
  })

  it('keeps a type-only import referenced via a `typeof` member head', async () => {
    const t = await on('typescript')
    // The head of `typeof a.foo` is the imported name; `.foo` is a property, not the binding.
    expect(t.transform('import type { a, b } from "x"\ntype T = ReturnType<typeof a.foo>', {})).toBe(
      'import type { a } from "x"\ntype T = ReturnType<typeof a.foo>',
    )
  })

  it('drops the unused specifier of a type-only import, keeping the used one', async () => {
    const t = await on('typescript')
    expect(t.transform("import type { Foo, Bar } from 'm'\nlet x: Bar", {})).toBe("import type { Bar } from 'm'\nlet x: Bar")
  })

  it('removes an unused inline { type X } specifier, keeping a used value sibling', async () => {
    const t = await on('typescript')
    expect(t.transform("import { type Foo, bar } from 'm'\nbar()", {})).toBe("import { bar } from 'm'\nbar()")
  })

  it('keeps a used inline { type X } specifier', async () => {
    const t = await on('typescript')
    const src = "import { type Foo, bar } from 'm'\nlet x: Foo = bar()"
    expect(t.transform(src, {})).toBe(src)
  })

  it('detects a type reference on the right-hand side of a type alias', async () => {
    const t = await on('typescript')
    expect(t.transform("import { Foo } from 'm'\ntype Bar = Foo", {})).toBe("import type { Foo } from 'm'\ntype Bar = Foo")
  })
})

describe('removeUnusedImports — confident-or-abstain (no-op)', () => {
  it('never removes a side-effect import', async () => {
    const t = await on('tsx')
    const src = "import './styles.css'\nfoo()"
    expect(t.transform(src, {})).toBe(src)
  })

  it('abstains on a file containing `with`', async () => {
    const t = await on('typescript')
    const src = "import { foo } from 'm'\nwith (o) { bar() }"
    expect(t.transform(src, {})).toBe(src)
  })

  it('abstains on a file containing `eval`', async () => {
    const t = await on('tsx')
    const src = "import { foo } from 'm'\neval('foo')"
    expect(t.transform(src, {})).toBe(src)
  })
})

describe('removeUnusedImports — abstaining constructs (syntactic fallback)', () => {
  it('prunes around a TS namespace the resolver abstains on', async () => {
    const t = await on('typescript')
    // The nested `namespace` makes the resolver abstain; the scan still sees `dbSqlite` via `typeof`.
    const src = [
      'import { dbSqlite, dbD1 } from "x"',
      'declare global {',
      '  namespace V { interface C { db: ReturnType<typeof dbSqlite> } }',
      '}',
    ].join('\n')
    const out = t.transform(src, {})
    expect(out).toContain('import { dbSqlite } from "x"')
    expect(out).not.toContain('dbD1')
    expect(out).toContain('namespace V') // ambient block untouched
  })

  it('prunes around a `declare module` block', async () => {
    const t = await on('typescript')
    const src = 'import { used, unused } from "m"\ndeclare module "y" { export const z: ReturnType<typeof used> }'
    const out = t.transform(src, {})
    expect(out).toContain('import { used } from "m"')
    expect(out).not.toContain('unused')
  })

  it('counts a value-shorthand reference as a use under the fallback', async () => {
    const t = await on('typescript')
    // `kept` is used only via object shorthand (`{ kept }`); `gone` is genuinely unused.
    const src = 'import { kept, gone } from "m"\nnamespace V { export const z = 1 }\nconst o = { kept }'
    const out = t.transform(src, {})
    expect(out).toContain('import { kept } from "m"')
    expect(out).not.toContain('gone')
  })

  it('still abstains when `with` accompanies a namespace', async () => {
    const t = await on('typescript')
    const src = 'import { foo } from "m"\nnamespace V { export const z = 1 }\nwith (o) { bar() }'
    expect(t.transform(src, {})).toBe(src)
  })

  it('still abstains when `eval` accompanies a namespace', async () => {
    const t = await on('typescript')
    const src = 'import { foo } from "m"\nnamespace V { export const z = 1 }\neval("foo")'
    expect(t.transform(src, {})).toBe(src)
  })
})

describe('removeUnusedImports — Vue SFC (script only)', () => {
  it('removes an unused import from <script setup>, leaving the template untouched', async () => {
    const t = await on(vueSplitter)
    const sfc = [
      '<template>',
      '  <h1>{{ title }}</h1>',
      '</template>',
      '',
      '<script setup lang="ts">',
      "import { used, unused } from 'm'",
      'const title = used("App")',
      '</script>',
      '',
    ].join('\n')
    const out = t.transform(sfc, {})
    expect(out).toContain("import { used } from 'm'")
    expect(out).not.toContain('unused')
    expect(out).toContain('<h1>{{ title }}</h1>') // template untouched
  })
})

describe('removeUnusedImports — Vue SFC cross-zone use (kept, not pruned)', () => {
  const sfc = (template: string, script: string) =>
    ['<template>', template, '</template>', '<script setup lang="ts">', script, '</script>', ''].join('\n')

  it('keeps an import used only in an interpolation', async () => {
    const t = await on(vueSplitter)
    expect(t.transform(sfc('<p>{{ greet }}</p>', "import { greet } from 'm'"), {})).toContain("import { greet } from 'm'")
  })

  it('keeps an import used only in a binding expression', async () => {
    const t = await on(vueSplitter)
    const out = t.transform(sfc(`<b :class="ok ? cls : ''"/>`, "import { cls } from 'm'\nconst ok = true"), {})
    expect(out).toContain("import { cls } from 'm'")
  })

  it('keeps a component import used only as a kebab or PascalCase tag, as a value import', async () => {
    const t = await on(vueSplitter)
    for (const tag of ['<my-widget/>', '<MyWidget/>']) {
      const out = t.transform(sfc(tag, "import MyWidget from './MyWidget.vue'"), {})
      expect(out).toContain("import MyWidget from './MyWidget.vue'") // value import, not demoted to `import type`
    }
  })

  it('keeps a custom-directive import (`v-focus` → `vFocus`)', async () => {
    const t = await on(vueSplitter)
    expect(t.transform(sfc('<input v-focus>', "import { vFocus } from './directives'"), {})).toContain('vFocus')
  })

  it('keeps an import in <script> used only from <script setup>', async () => {
    const t = await on(vueSplitter)
    const two = ['<script lang="ts">', "import { A } from './a'", '</script>', '<script setup lang="ts">', 'A()', '</script>', ''].join('\n')
    expect(t.transform(two, {})).toContain("import { A } from './a'")
  })

  it('still drops a dead specifier from a statement whose other half is used in the template', async () => {
    const t = await on(vueSplitter)
    expect(t.transform(sfc('<div>{{ a }}</div>', "import { a, b } from 'm'"), {})).toContain("import { a } from 'm'")
  })

  it('does not let a native element keep a same-named import (the tag filter)', async () => {
    const t = await on(vueSplitter)
    // `<div>` is a native element, not a `Div` component — the import is genuinely unused.
    expect(t.transform(sfc('<div/>', "import { Div } from './div'"), {})).not.toContain('import')
  })

  it('keeps an import used only in a `<style> v-bind()`', async () => {
    const t = await on(vueSplitter)
    const withStyle = [
      '<template><div/></template>',
      '<script setup lang="ts">',
      "import { themeColor } from './theme'",
      '</script>',
      '<style>.box { color: v-bind(themeColor) }</style>',
      '',
    ].join('\n')
    expect(t.transform(withStyle, {})).toContain("import { themeColor } from './theme'")
  })

  it('still prunes a script import shadowed by a local — own-tree precision is not lost cross-zone', async () => {
    const t = await on(vueSplitter)
    // `foo` resolves to the param inside `g`, never the import, and the template does not use it; the
    // cross-zone scan must exclude these own-tree occurrences, not count them as a sibling use.
    const out = t.transform(sfc('<div/>', "import { foo } from 'm'\nfunction g(foo) { return foo }\ng(1)"), {})
    expect(out).not.toContain('import')
  })
})
