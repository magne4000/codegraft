import { describe, it, expect, beforeAll } from 'vitest'
import type { CompiledRule, RichNode, ZoneSplitter } from '@trast/core'
import { Parser } from '@trast/core/internal'
import { serialiseRules } from './serialise.js'

beforeAll(async () => {
  await Parser.loadGrammar('typescript')
})

// Assert the emitted module is syntactically valid JS/TS.
function expectValid(source: string) {
  expect(Parser.parse(source, 'typescript').rootNode.hasError).toBe(false)
}

function rule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    language: 'tsx',
    pattern: { kind: 'node', nodeType: 'if_statement' },
    guard: null,
    commentRegex: null,
    rewrite: (caps) => caps.node,
    ...overrides,
  }
}

const stub: ZoneSplitter = {
  id: 'stub',
  grammars: ['typescript'],
  importName: 'stubSplitter',
  importPath: '@trast/stub',
  async init() {},
  split: () => [],
}

describe('serialiseRules', () => {
  it('emits a valid module for a GrammarId target', () => {
    const out = serialiseRules('tsx', [rule()])
    expect(out).toContain("import { createTransformer, remove } from '@trast/core'")
    expect(out).toContain('createTransformer("tsx", [')
    expect(out).toContain('"kind":"node","nodeType":"if_statement"')
    expect(out).toContain('rewrite:')
    expectValid(out)
  })

  it('imports a ZoneSplitter by its declared name/path and uses it as the target', () => {
    const out = serialiseRules(stub, [rule({ language: 'typescript' })])
    expect(out).toContain("import { stubSplitter } from '@trast/stub'")
    expect(out).toContain('createTransformer(stubSplitter, [')
    expectValid(out)
  })

  it('throws when a splitter target lacks import metadata', () => {
    const bad: ZoneSplitter = { ...stub, importName: undefined, importPath: undefined }
    expect(() => serialiseRules(bad, [])).toThrow(/cannot be serialised/)
  })

  it('serialises guard and commentRegex (and null when absent)', () => {
    const withBoth = serialiseRules('tsx', [
      rule({ guard: (caps) => caps.node.type === 'if_statement', commentRegex: /@kill/g }),
    ])
    expect(withBoth).toContain('guard: (caps)')
    expect(withBoth).toContain('commentRegex: /@kill/g')
    expectValid(withBoth)

    const without = serialiseRules('tsx', [rule()])
    expect(without).toContain('guard: null')
    expect(without).toContain('commentRegex: null')
  })

  it('imports only the core helpers a rewrite actually references', () => {
    const getConditionalBranches = (x: RichNode): RichNode => x // stand-in so the source names it
    const out = serialiseRules('tsx', [rule({ rewrite: (caps) => getConditionalBranches(caps.node) })])
    expect(out).toContain("import { createTransformer, remove, getConditionalBranches } from '@trast/core'")
    // an unrelated helper is not imported
    expect(out).not.toContain('getPropertyName')
    expectValid(out)
  })

  it('emits one object literal per rule', () => {
    const out = serialiseRules('tsx', [rule(), rule({ language: 'typescript' })])
    expect(out).toContain('"tsx"')
    expect(out).toContain('"typescript"')
    expectValid(out)
  })
})
