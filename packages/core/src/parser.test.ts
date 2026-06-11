import { describe, it, expect } from 'vitest'
import { Parser } from './parser.js'

describe('Parser', () => {
  it('init() is idempotent', async () => {
    await Parser.init()
    await expect(Parser.init()).resolves.toBeUndefined()
  })

  // [grammar, source, expected root node type]
  const cases: Array<[string, string, string]> = [
    ['javascript', 'const x = 1', 'program'],
    ['typescript', 'const x: number = 1', 'program'],
    ['tsx', 'const x = <div/>', 'program'],
    ['html', '<div>hi</div>', 'document'],
    ['css', 'a { color: red }', 'stylesheet'],
    ['yaml', 'a: 1\nb:\n  - x\n', 'stream'],
  ]
  it.each(cases)('parses %s to the correct root with no errors', async (id, src, root) => {
    await Parser.loadGrammar(id)
    const tree = Parser.parse(src, id)
    expect(tree.rootNode.type).toBe(root)
    expect(tree.rootNode.hasError).toBe(false)
  })

  it('folds the JS/TS/TSX family onto the tsx grammar at runtime', async () => {
    const family = ['javascript', 'typescript', 'tsx'] as const
    for (const id of family) await Parser.loadGrammar(id)
    // Every id routes to the one tsx superset, so JSX *and* TS syntax parse under all three.
    for (const id of family) {
      expect(Parser.parse('const x = <div/>', id).rootNode.hasError).toBe(false) // JSX
      expect(Parser.parse('const x = y as Foo', id).rootNode.hasError).toBe(false) // TS cast
    }
    // The lone construct the tsx grammar can't read: the JSX-ambiguous angle-bracket cast (use `as`).
    expect(Parser.parse('const x = <Foo>y', 'typescript').rootNode.hasError).toBe(true)
  })

  it('does not preload grammars — parsing an unloaded grammar asserts', () => {
    expect(() => Parser.parse('whatever', 'never-loaded')).toThrow(/not loaded/)
  })

  it('rejects an unknown grammar given no wasmPath', async () => {
    await expect(Parser.loadGrammar('totally-unknown')).rejects.toThrow(/not built in/)
  })
})
