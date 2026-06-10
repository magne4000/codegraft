import { describe, it, expect, beforeAll } from 'vitest'
import { Parser } from './parser.js'
import { wrapNode } from './rich-node.js'
import { evaluate } from './evaluate.js'

// A BATI-style context: $$ resolves to this object, so `$$.BATI.has("x")` is `BATI.has("x")`.
const ctx = (...features: string[]) => ({
  BATI: { has: (f: string) => features.includes(f) },
  mode: 'dev',
})

/** Parse a bare expression to the condition node a captured `if (...)` would yield. */
const condition = (src: string) => {
  const root = wrapNode(Parser.parse(src, 'typescript').rootNode, 'typescript', 0)
  return root.children[0].children[0]
}

beforeAll(async () => {
  await Parser.init()
  await Parser.loadGrammar('typescript')
})

describe('evaluate', () => {
  it('resolves the namespace root to the context (call + member access)', () => {
    expect(evaluate(condition('$$.BATI.has("auth")'), ctx('auth'))).toBe(true)
    expect(evaluate(condition('$$.BATI.has("auth")'), ctx())).toBe(false)
    expect(evaluate(condition('$$.mode'), ctx())).toBe('dev')
  })

  it('calls a method on its object, preserving the receiver', () => {
    // Bati's `meta.BATI` is a real Set subclass; `Set.prototype.has` throws on a detached receiver.
    expect(evaluate(condition('$$.BATI.has("x")'), { BATI: new Set(['x']) })).toBe(true)
    expect(evaluate(condition('$$.BATI.has("y")'), { BATI: new Set(['x']) })).toBe(false)
  })

  it('asserts on a call that is not a method on the context', () => {
    expect(() => evaluate(condition('$$("x")'), ctx())).toThrow(/only method calls are supported/)
  })

  it('composes !, &&, ||, parentheses, and comparisons', () => {
    expect(evaluate(condition('$$.BATI.has("auth") && !$$.BATI.has("admin")'), ctx('auth'))).toBe(true)
    expect(evaluate(condition('$$.BATI.has("auth") && $$.BATI.has("admin")'), ctx('auth'))).toBe(false)
    expect(evaluate(condition('$$.BATI.has("a") || $$.BATI.has("b")'), ctx('b'))).toBe(true)
    expect(evaluate(condition('!($$.BATI.has("a") || $$.BATI.has("b"))'), ctx())).toBe(true)
    expect(evaluate(condition('$$.mode === "dev"'), ctx())).toBe(true)
    expect(evaluate(condition('$$.mode !== "prod"'), ctx())).toBe(true)
  })

  it('accepts a string (a directive comment), parsing it as an expression', () => {
    expect(evaluate('$$.BATI.has("auth")', ctx('auth'))).toBe(true)
    expect(evaluate('$$.BATI.has("auth") && $$.mode === "dev"', ctx())).toBe(false)
  })

  it('short-circuits && / || (never touches the unreached branch)', () => {
    let touched = false
    const probe = { BATI: { has: () => false }, boom: () => ((touched = true), true) }
    expect(evaluate(condition('$$.BATI.has("x") && $$.boom()'), probe)).toBe(false)
    expect(touched).toBe(false)
  })

  it('asserts on anything outside the pure-over-context subset', () => {
    expect(() => evaluate(condition('$$.BATI.has("a") & 1'), ctx())).toThrow(/unsupported operator/)
    expect(() => evaluate(condition('typeof $$.BATI'), ctx())).toThrow(/unsupported unary operator/)
  })
})
