import { describe, it, expect, beforeAll } from 'vitest'
import { Parser } from './parser.js'
import { wrapNode } from './rich-node.js'
import type { GrammarId, RichNode } from './types.js'

beforeAll(async () => {
  await Parser.loadGrammar('typescript')
  await Parser.loadGrammar('html')
})

function root(source: string, language: GrammarId, startOffset = 0): RichNode {
  return wrapNode(Parser.parse(source, language).rootNode, language, startOffset)
}

describe('RichNode', () => {
  it('children exclude anonymous tokens and comments; allChildren keep them', () => {
    const ifStmt = root('if (x) { y() } else { z() }', 'typescript').children[0]
    expect(ifStmt.type).toBe('if_statement')

    // children: named, comment-free structural nodes only
    expect(ifStmt.children.every((c) => c.isNamed)).toBe(true)
    expect(ifStmt.children.map((c) => c.type)).toEqual([
      'parenthesized_expression', // condition
      'statement_block', // consequence
      'else_clause', // alternative
    ])

    // allChildren: the full CST, including the anonymous `if` keyword
    expect(ifStmt.allChildren.map((c) => c.type)).toContain('if')
    expect(ifStmt.allChildren.some((c) => !c.isNamed)).toBe(true)
  })

  it('child(field) returns the correct named child, sharing the cached instance', () => {
    const ifStmt = root('if (x) { y() } else { z() }', 'typescript').children[0]
    expect(ifStmt.child('consequence')?.type).toBe('statement_block')
    expect(ifStmt.child('condition')?.type).toBe('parenthesized_expression')
    expect(ifStmt.child('nonexistent')).toBeNull()
    // same instance as the one in children (identity, so attached comments are shared)
    expect(ifStmt.child('consequence')).toBe(ifStmt.children[1])
  })

  it('text equals the source slice [startIndex, endIndex)', () => {
    const source = 'const x = 1'
    const decl = root(source, 'typescript').children[0]
    expect(decl.text).toBe(source.slice(decl.startIndex, decl.endIndex))
    expect(decl.text).toBe('const x = 1')
  })

  it('documentStartIndex/EndIndex add the zone startOffset', () => {
    const decl = root('const x = 1', 'typescript', 100).children[0]
    expect(decl.documentStartIndex).toBe(decl.startIndex + 100)
    expect(decl.documentEndIndex).toBe(decl.endIndex + 100)
  })

  it('comments are excluded from children in JS-family and HTML grammars', () => {
    const ts = root('// hi\nconst x = 1', 'typescript')
    expect(ts.children.map((c) => c.type)).toEqual(['lexical_declaration'])
    expect(ts.allChildren.map((c) => c.type)).toContain('comment')

    const html = root('<!-- c --><div></div>', 'html')
    expect(html.children.map((c) => c.type)).not.toContain('comment')
    expect(html.allChildren.map((c) => c.type)).toContain('comment')
  })
})
