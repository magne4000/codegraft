import { describe, it, expect } from 'vitest'
import type { Collection } from '@trast/core'
import { defineCodemod } from './codemod.js'

// Rename the binding located by `locate` (a declaration's name) and all its references to `to`,
// abstaining (no-op) when the resolver can't be sure. Exercises references().
const rename = (locate: (root: Collection) => Collection, to: string) =>
  defineCodemod((root) => {
    const refs = locate(root).references()
    if (refs) refs.replaceWith(to)
  })

const firstDeclName = (root: Collection) => root.find('variable_declarator').first().field('name')

describe('scope — references() (rename)', () => {
  it('renames a simple binding and all its references', async () => {
    const t = await rename(firstDeclName, 'y').forTarget('tsx')
    expect(t.transform('const x = 1\nuse(x)\nx + x', {})).toBe('const y = 1\nuse(y)\ny + y')
  })

  it('respects shadowing — the inner binding is untouched', async () => {
    const t = await rename(firstDeclName, 'y').forTarget('tsx')
    const src = 'const x = 1\n{\n  const x = 2\n  inner(x)\n}\nouter(x)'
    expect(t.transform(src, {})).toBe('const y = 1\n{\n  const x = 2\n  inner(x)\n}\nouter(y)')
  })

  it('handles var hoisting (reference before declaration)', async () => {
    const t = await rename(firstDeclName, 'y').forTarget('tsx')
    expect(t.transform('function f() {\n  use(v)\n  var v = 1\n}', {})).toBe('function f() {\n  use(y)\n  var y = 1\n}')
  })

  it('renames a function parameter within its body', async () => {
    const t = await rename((r) => r.find('formal_parameters').first().find('identifier').first(), 'y').forTarget('tsx')
    expect(t.transform('function f(a) {\n  return a + a\n}', {})).toBe('function f(y) {\n  return y + y\n}')
  })

  it('resolves imported bindings', async () => {
    const t = await rename((r) => r.find('import_specifier').first().field('name'), 'bar').forTarget('tsx')
    expect(t.transform("import { foo } from 'm'\nfoo()", {})).toBe("import { bar } from 'm'\nbar()")
  })

  it('renames a destructured alias', async () => {
    const t = await rename((r) => r.find('pair_pattern').first().field('value'), 'c').forTarget('tsx')
    expect(t.transform('const { a: b } = obj\nuse(b)', {})).toBe('const { a: c } = obj\nuse(c)')
  })

  it('renames the name of a TS enum and its references', async () => {
    const t = await rename((r) => r.find('enum_declaration').first().field('name'), 'Hue').forTarget('tsx')
    expect(t.transform('enum Color { Red, Green }\nconst c = Color.Red', {})).toBe(
      'enum Hue { Red, Green }\nconst c = Hue.Red',
    )
  })

  it('still renames a normal binding in a file that also contains an enum (no blanket abstain)', async () => {
    const t = await rename(firstDeclName, 'y').forTarget('tsx')
    const src = 'const x = 1\nenum E { A }\nuse(x, E.A)'
    expect(t.transform(src, {})).toBe('const y = 1\nenum E { A }\nuse(y, E.A)')
  })
})

describe('scope — definition()', () => {
  it('resolves a reference to its declaration', async () => {
    const cm = defineCodemod((root) => {
      root.find('call_expression', { function: 'use' }).forEach((call) => {
        const arg = call.find('identifier').filter((id) => id.text === 'x').first()
        arg.definition()?.replaceWith('DEF')
      })
    })
    const t = await cm.forTarget('tsx')
    expect(t.transform('const x = 1\nuse(x)', {})).toBe('const DEF = 1\nuse(x)')
  })
})

describe('scope — confident-or-abstain (rename is a no-op)', () => {
  const renameFirst = rename(firstDeclName, 'y')

  it('abstains on `with`', async () => {
    const t = await renameFirst.forTarget('tsx')
    const src = 'const x = 1\nwith (o) {\n  use(x)\n}'
    expect(t.transform(src, {})).toBe(src)
  })

  it('abstains on eval', async () => {
    const t = await renameFirst.forTarget('tsx')
    const src = 'const x = 1\neval("x")\nuse(x)'
    expect(t.transform(src, {})).toBe(src)
  })

  it('abstains on an object shorthand referencing the binding', async () => {
    const t = await renameFirst.forTarget('tsx')
    const src = 'const x = 1\nconst o = { x }'
    expect(t.transform(src, {})).toBe(src)
  })
})
