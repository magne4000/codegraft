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

  it('loads tree-sitter-typescript once for both typescript and tsx', async () => {
    await Parser.loadGrammar('typescript')
    await Parser.loadGrammar('tsx')
    // Distinct grammars from one package: tsx parses JSX that typescript rejects.
    expect(Parser.parse('const x = <div/>', 'tsx').rootNode.hasError).toBe(false)
    expect(Parser.parse('const x = <div/>', 'typescript').rootNode.hasError).toBe(true)
  })

  it('does not preload grammars — parsing an unloaded grammar asserts', () => {
    expect(() => Parser.parse('whatever', 'never-loaded')).toThrow(/not loaded/)
  })

  it('rejects an unknown grammar given no wasmPath', async () => {
    await expect(Parser.loadGrammar('totally-unknown')).rejects.toThrow(/not built in/)
  })
})
