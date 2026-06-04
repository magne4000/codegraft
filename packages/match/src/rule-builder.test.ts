import { describe, it, expect } from 'vitest'
import { remove } from '@trast/core'
import { match } from './rule-builder.js'

const noop = () => remove

describe('match builder', () => {
  it('expr produces a RawRule with the pattern string and expr context', () => {
    const r = match.tsx.expr`if (BATI.has($f)) { $$$then }`.rewrite(noop)
    expect(r).toEqual({
      language: 'tsx',
      patternString: 'if (BATI.has($f)) { $$$then }',
      patternContext: 'expr',
      nodeType: null,
      guard: null,
      commentRegex: null,
      rewrite: noop,
    })
  })

  it('maps short namespace names to full grammar ids', () => {
    expect(match.ts.expr`x`.rewrite(noop).language).toBe('typescript')
    expect(match.js.expr`x`.rewrite(noop).language).toBe('javascript')
    expect(match.tsx.expr`x`.rewrite(noop).language).toBe('tsx')
    expect(match.css.expr`x`.rewrite(noop).language).toBe('css')
    expect(match.html.expr`x`.rewrite(noop).language).toBe('html')
  })

  it('type sets the type context (TS/TSX only)', () => {
    const r = match.ts.type`BATI.If<{ $$$branches }>`.rewrite(noop)
    expect(r.patternContext).toBe('type')
    expect(r.patternString).toBe('BATI.If<{ $$$branches }>')
  })

  it('node sets nodeType with a null pattern string', () => {
    const r = match.js.node('if_statement').rewrite(noop)
    expect(r).toMatchObject({ language: 'javascript', patternString: null, nodeType: 'if_statement' })
  })

  it('any produces a language-agnostic rule', () => {
    const r = match.any().rewrite(noop)
    expect(r).toMatchObject({ language: 'any', patternString: null, nodeType: null })
  })

  it('where and whenLeadingComment attach a guard and a comment regex, in any order', () => {
    const guard = () => true
    const re = /@if/
    const r = match.tsx.expr`if ($c) {}`.whenLeadingComment(re).where(guard).rewrite(noop)
    expect(r.guard).toBe(guard)
    expect(r.commentRegex).toBe(re)
  })

  it('interpolates values into the pattern string', () => {
    const t = 'if_statement'
    const r = match.tsx.expr`match ${t} here`.rewrite(noop)
    expect(r.patternString).toBe('match if_statement here')
  })

  it('match.<lang> namespaces are objects, not callable', () => {
    expect(typeof (match.tsx as unknown)).toBe('object')
    expect(typeof match.any).toBe('function')
  })
})
