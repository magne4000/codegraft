import { describe, it, expect, beforeAll } from 'vitest'
import { Parser } from '@trast/core/internal'
import { parsePattern } from './pattern-parser.js'

beforeAll(async () => {
  await Parser.loadGrammar('tsx')
  await Parser.loadGrammar('typescript')
  await Parser.loadGrammar('css')
})

describe('parsePattern', () => {
  it('builds exact/text/capture, unwrapping the top-level expression_statement', () => {
    expect(parsePattern('BATI.has($feature)', 'tsx', 'expr')).toEqual({
      kind: 'exact',
      nodeType: 'call_expression',
      children: [
        {
          kind: 'exact',
          nodeType: 'member_expression',
          children: [
            { kind: 'text', nodeType: 'identifier', text: 'BATI' },
            { kind: 'text', nodeType: 'property_identifier', text: 'has' },
          ],
        },
        { kind: 'exact', nodeType: 'arguments', children: [{ kind: 'capture', name: 'feature' }] },
      ],
    })
  })

  it('lifts a spread out of its expression_statement so it sits directly under the block', () => {
    expect(parsePattern('{ $$$body }', 'tsx', 'expr')).toEqual({
      kind: 'exact',
      nodeType: 'statement_block',
      children: [{ kind: 'spread', name: 'body' }],
    })
  })

  it('keeps the else clause as a real container in an if/else pattern', () => {
    const p = parsePattern('if (BATI.has($f)) { $$$then } else { $$$otherwise }', 'tsx', 'expr')
    expect(p).toMatchObject({ kind: 'exact', nodeType: 'if_statement' })
    const kinds = (p as { children: { nodeType?: string }[] }).children.map((c) => c.nodeType)
    expect(kinds).toEqual(['parenthesized_expression', 'statement_block', 'else_clause'])
    // the else clause is preserved (not collapsed into a spread that swallows it)
    expect(p).toMatchObject({
      children: [
        {},
        { kind: 'exact', nodeType: 'statement_block', children: [{ kind: 'spread', name: 'then' }] },
        {
          kind: 'exact',
          nodeType: 'else_clause',
          children: [
            { kind: 'exact', nodeType: 'statement_block', children: [{ kind: 'spread', name: 'otherwise' }] },
          ],
        },
      ],
    })
  })

  it('extracts the type-alias value and lifts a spread out of its property_signature', () => {
    const p = parsePattern('BATI.If<{ $$$branches }>', 'typescript', 'type')
    expect(p).toMatchObject({ kind: 'exact', nodeType: 'generic_type' })
    // navigate generic_type > type_arguments > object_type([spread branches])
    expect(p).toMatchObject({
      children: [
        { kind: 'exact', nodeType: 'nested_type_identifier' },
        {
          kind: 'exact',
          nodeType: 'type_arguments',
          children: [{ kind: 'exact', nodeType: 'object_type', children: [{ kind: 'spread', name: 'branches' }] }],
        },
      ],
    })
  })

  it('detects a CSS capture by text, not node type (plain_value, not identifier)', () => {
    const p = parsePattern('a { color: $value }', 'css', 'expr') as {
      nodeType: string
      children: unknown[]
    }
    expect(p.nodeType).toBe('rule_set')
    // somewhere under the rule there is a `capture` named value
    const json = JSON.stringify(p)
    expect(json).toContain('"kind":"capture","name":"value"')
  })

  it('throws on a reserved capture name', () => {
    expect(() => parsePattern('$node', 'tsx', 'expr')).toThrow(/reserved/)
    expect(() => parsePattern('$commentMatch', 'tsx', 'expr')).toThrow(/reserved/)
  })

  it('throws on a non-terminal spread', () => {
    expect(() => parsePattern('[$$$rest, $last]', 'tsx', 'expr')).toThrow(/spread/)
  })
})
