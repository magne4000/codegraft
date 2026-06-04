import { describe, it, expect } from 'vitest'
import { matchPattern, matchVisitor } from './pattern-matcher.js'
import type { PatternNode, RichNode } from './types.js'

// The matcher touches only type/text/children, so lightweight stubs keep this a true
// unit test with no parser dependency.
function n(type: string, text = '', children: RichNode[] = []): RichNode {
  return { type, text, children } as unknown as RichNode
}

describe('matchPattern', () => {
  it('any matches any node with no captures', () => {
    expect(matchPattern({ kind: 'any' }, n('whatever'))).toEqual({})
  })

  it('node matches by type only', () => {
    const p: PatternNode = { kind: 'node', nodeType: 'if_statement' }
    expect(matchPattern(p, n('if_statement'))).toEqual({})
    expect(matchPattern(p, n('call_expression'))).toBeNull()
  })

  it('text matches type and literal text', () => {
    const p: PatternNode = { kind: 'text', nodeType: 'identifier', text: 'BATI' }
    expect(matchPattern(p, n('identifier', 'BATI'))).toEqual({})
    expect(matchPattern(p, n('identifier', 'OTHER'))).toBeNull()
    expect(matchPattern(p, n('property_identifier', 'BATI'))).toBeNull()
  })

  it('capture binds the node by name', () => {
    const node = n('string', '"auth"')
    expect(matchPattern({ kind: 'capture', name: 'feature' }, node)).toEqual({ feature: node })
  })

  it('exact recurses positionally and collects captures', () => {
    const pattern: PatternNode = {
      kind: 'exact',
      nodeType: 'member_expression',
      children: [
        { kind: 'text', nodeType: 'identifier', text: 'BATI' },
        { kind: 'capture', name: 'prop' },
      ],
    }
    const prop = n('property_identifier', 'has')
    const node = n('member_expression', 'BATI.has', [n('identifier', 'BATI'), prop])
    expect(matchPattern(pattern, node)).toEqual({ prop })
  })

  it('exact returns null on type mismatch', () => {
    const pattern: PatternNode = { kind: 'exact', nodeType: 'member_expression', children: [] }
    expect(matchPattern(pattern, n('call_expression'))).toBeNull()
  })

  it('exact returns null on child-count mismatch (too few and too many)', () => {
    const pattern: PatternNode = {
      kind: 'exact',
      nodeType: 'array',
      children: [{ kind: 'any' }, { kind: 'any' }],
    }
    expect(matchPattern(pattern, n('array', '', [n('number')]))).toBeNull()
    expect(matchPattern(pattern, n('array', '', [n('a'), n('b'), n('c')]))).toBeNull()
  })

  it('spread captures the rest of the sibling list, including empty', () => {
    const pattern: PatternNode = {
      kind: 'exact',
      nodeType: 'statement_block',
      children: [{ kind: 'spread', name: 'body' }],
    }
    const a = n('s', 'a()')
    const b = n('s', 'b()')
    expect(matchPattern(pattern, n('statement_block', '', [a, b]))).toEqual({ body: [a, b] })
    expect(matchPattern(pattern, n('statement_block', '', []))).toEqual({ body: [] })
  })

  it('spread captures only the tail after fixed leading patterns', () => {
    const pattern: PatternNode = {
      kind: 'exact',
      nodeType: 'block',
      children: [
        { kind: 'text', nodeType: 'kw', text: 'first' },
        { kind: 'spread', name: 'rest' },
      ],
    }
    const first = n('kw', 'first')
    const x = n('s', 'x')
    const y = n('s', 'y')
    expect(matchPattern(pattern, n('block', '', [first, x, y]))).toEqual({ rest: [x, y] })
    // leading pattern must still match
    expect(matchPattern(pattern, n('block', '', [n('kw', 'other'), x]))).toBeNull()
  })

  it('matchVisitor binds the pattern and matches per node', () => {
    const visit = matchVisitor({ kind: 'node', nodeType: 'if_statement' })
    expect(visit(n('if_statement'))).toEqual({})
    expect(visit(n('call_expression'))).toBeNull()
  })
})
