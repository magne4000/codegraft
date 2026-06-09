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
    expect(transform.transform("import { a } from 'm'\nb()", {})).toBe('\nb()')
  })
})

describe('removeUnusedImports — whole-statement removal', () => {
  it('drops a fully-unused named import', async () => {
    const t = await on('tsx')
    expect(t.transform("import { foo } from 'm'\nbar()", {})).toBe('\nbar()')
  })

  it('drops an unused default import', async () => {
    const t = await on('tsx')
    expect(t.transform("import foo from 'm'\nbar()", {})).toBe('\nbar()')
  })

  it('drops an unused namespace import', async () => {
    const t = await on('tsx')
    expect(t.transform("import * as ns from 'm'\nbar()", {})).toBe('\nbar()')
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
    expect(t.transform("import type { Foo } from 'm'\nbar()", {})).toBe('\nbar()')
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
