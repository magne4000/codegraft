import { describe, it, expect } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { GrammarId } from '@trast/core'
import type { RuleSetBuilder } from '@trast/match'
import batiRules from './integration/_rules.js'
import conflictRules from './integration/_conflict-rules.js'

const root = fileURLToPath(new URL('./integration', import.meta.url))
// Regenerate the expected fixtures: UPDATE_FIXTURES=1 pnpm test
const UPDATE = process.env.UPDATE_FIXTURES === '1'

interface IntegrationCase {
  dir: string
  target: GrammarId
  input: string
  rules: RuleSetBuilder<Record<string, unknown>>
  variants: Array<{ name: string; context: Record<string, unknown>; expected: string }>
}

const CASES: IntegrationCase[] = [
  {
    dir: 'bati-if-else',
    target: 'tsx',
    input: 'input.tsx',
    rules: batiRules,
    variants: [
      { name: 'feature on → keep then-branch', context: { features: ['auth'] }, expected: 'with.tsx' },
      { name: 'feature off → keep else-branch', context: { features: [] }, expected: 'without.tsx' },
    ],
  },
  {
    dir: 'bati-ternary',
    target: 'tsx',
    input: 'input.tsx',
    rules: batiRules,
    variants: [
      { name: 'feature on → consequent', context: { features: ['auth'] }, expected: 'with.tsx' },
      { name: 'feature off → alternate', context: { features: [] }, expected: 'without.tsx' },
    ],
  },
  {
    dir: 'bati-comment-gated',
    target: 'tsx',
    input: 'input.tsx',
    rules: batiRules,
    variants: [
      { name: 'feature on → keep, strip directive', context: { features: ['auth'] }, expected: 'with.tsx' },
      { name: 'feature off → remove decl + directive', context: { features: [] }, expected: 'without.tsx' },
    ],
  },
  {
    dir: 'bati-jsx-attr',
    target: 'tsx',
    input: 'input.tsx',
    rules: batiRules,
    variants: [
      { name: 'feature on → keep attribute', context: { features: ['auth'] }, expected: 'with.tsx' },
      { name: 'feature off → remove attribute', context: { features: [] }, expected: 'without.tsx' },
    ],
  },
  {
    dir: 'bati-html-comment',
    target: 'html',
    input: 'input.html',
    rules: batiRules,
    variants: [
      { name: 'feature on → keep element', context: { features: ['auth'] }, expected: 'with.html' },
      { name: 'feature off → remove element', context: { features: [] }, expected: 'without.html' },
    ],
  },
  {
    dir: 'nested-conditionals',
    target: 'tsx',
    input: 'input.tsx',
    rules: batiRules,
    variants: [
      { name: 'both on → inner then', context: { features: ['auth', 'admin'] }, expected: 'both.tsx' },
      { name: 'outer on, inner off → inner else', context: { features: ['auth'] }, expected: 'auth.tsx' },
      { name: 'outer off → outer else', context: { features: [] }, expected: 'none.tsx' },
    ],
  },
  {
    dir: 'conflict-first-wins',
    target: 'tsx',
    input: 'input.tsx',
    rules: conflictRules,
    variants: [{ name: 'first rule wins', context: {}, expected: 'out.tsx' }],
  },
  {
    dir: 'comment-blank-line',
    target: 'tsx',
    input: 'input.tsx',
    rules: batiRules,
    variants: [
      { name: 'blank-separated directive does not gate', context: { features: [] }, expected: 'out.tsx' },
    ],
  },
  {
    dir: 'comment-last-jsx-attr',
    target: 'tsx',
    input: 'input.tsx',
    rules: batiRules,
    variants: [
      { name: 'comment after last attr is inner, not a gate', context: { features: [] }, expected: 'out.tsx' },
    ],
  },
]

describe('integration fixtures', () => {
  for (const testCase of CASES) {
    for (const variant of testCase.variants) {
      it(`${testCase.dir}: ${variant.name}`, async () => {
        const transformer = await testCase.rules.forTarget(testCase.target)
        const input = await readFile(join(root, testCase.dir, testCase.input), 'utf8')
        const output = transformer.transform(input, variant.context)

        const expectedPath = join(root, testCase.dir, variant.expected)
        if (UPDATE) {
          await writeFile(expectedPath, output)
          return
        }
        expect(output).toBe(await readFile(expectedPath, 'utf8'))
      })
    }
  }
})
