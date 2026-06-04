import { describe, it, expect } from 'vitest'
import type { RichNode } from '@trast/core'
import { defineCodemod } from './codemod.js'

describe('defineCodemod — query + edits', () => {
  it('finds by type + field predicate and replaces each match', async () => {
    const t = await defineCodemod((root) => {
      root.find('call_expression', { function: 'foo' }).replaceWith('bar()')
    }).forTarget('tsx')
    expect(t.transform('foo(); baz(); foo()', {})).toBe('bar(); baz(); bar()')
  })

  it('matches a node by its own text via the `text` pseudo-key', async () => {
    const t = await defineCodemod((root) => {
      root.find('identifier', { text: 'old' }).replaceWith('next')
    }).forTarget('tsx')
    expect(t.transform('const x = old + old.y', {})).toBe('const x = next + next.y')
  })

  it('filter + single-node accessors (text/field/evaluate) work inside forEach', async () => {
    const t = await defineCodemod<{ on: boolean }>((root, ctx) => {
      root.find('if_statement').forEach((node) => {
        const cond = node.field('condition')
        if (cond.text !== '(flag)') return
        node.replaceWith(ctx.on ? 'KEEP' : 'DROP')
      })
    }).forTarget('tsx')
    expect(t.transform('if (flag) { a() }', { on: true })).toBe('KEEP')
    expect(t.transform('if (other) { a() }', { on: true })).toBe('if (other) { a() }')
  })

  it('navigates with closest/parent and removes', async () => {
    const t = await defineCodemod((root) => {
      // remove the statement that contains a `debugger`
      root.find('debugger_statement').forEach((node) => {
        expect(node.type).toBe('debugger_statement')
        expect((node.node as RichNode).parent?.type).toBeTypeOf('string')
        node.remove()
      })
    }).forTarget('tsx')
    expect(t.transform('a()\ndebugger\nb()', {})).toBe('a()\n\nb()')
  })

  it('size() supports idempotency checks', async () => {
    const cm = defineCodemod((root) => {
      if (root.find('call_expression', { function: 'init' }).size() === 0) {
        root.find('identifier', { text: 'marker' }).replaceWith('init()')
      }
    })
    const t = await cm.forTarget('tsx')
    expect(t.transform('marker', {})).toBe('init()')
    expect(t.transform('init()', {})).toBe('init()') // already present → untouched
  })
})
