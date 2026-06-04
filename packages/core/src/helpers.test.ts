import { describe, it, expect, beforeAll } from 'vitest'
import { Parser } from './parser.js'
import { wrapNode } from './rich-node.js'
import { getPropertySignatures, getPropertyName, getConditionalBranches } from './helpers.js'
import type { RichNode } from './types.js'

beforeAll(async () => {
  await Parser.loadGrammar('typescript')
})

// parse `type __x__ = <src>` and return the object_type value
function objectType(src: string): RichNode {
  const root = wrapNode(Parser.parse(`type __x__ = ${src}`, 'typescript').rootNode, 'typescript', 0)
  return root.children[0].child('value')!
}

describe('navigation helpers', () => {
  it('getPropertySignatures returns the object type members', () => {
    const sigs = getPropertySignatures(objectType('{ auth: number; admin: string }'))
    expect(sigs.map((s) => s.type)).toEqual(['property_signature', 'property_signature'])
  })

  it('getPropertyName returns the property name', () => {
    const [sig] = getPropertySignatures(objectType('{ auth: number }'))
    expect(getPropertyName(sig)).toBe('auth')
  })

  it('getConditionalBranches pairs names with the unwrapped (colon-stripped) type', () => {
    const branches = getConditionalBranches(objectType('{ auth: { user: User }; default: number }'))
    expect(branches.map((b) => b.name)).toEqual(['auth', 'default'])
    expect(branches[0].type.text).toBe('{ user: User }')
    expect(branches[1].type.text).toBe('number')
  })
})
