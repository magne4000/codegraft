import { describe, it, expect } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { GrammarId, ZoneSplitter } from '@trast/core'
import type { RuleSetBuilder } from '@trast/match'
import { vueSplitter } from '@trast/vue'
import batiRules from './integration/_rules.js'
import conflictRules from './integration/_conflict-rules.js'

const root = fileURLToPath(new URL('./integration', import.meta.url))
// Regenerate the expected fixtures: UPDATE_FIXTURES=1 pnpm test
const UPDATE = process.env.UPDATE_FIXTURES === '1'

// The `$$` value the rules evaluate against: $$.BATI.has(f) ⇔ f is an enabled feature.
const bati = (...features: string[]): Record<string, unknown> => ({
  BATI: { has: (f: string) => features.includes(f) },
})

interface IntegrationCase {
  dir: string
  target: GrammarId | ZoneSplitter
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
      { name: 'feature on → keep then-branch', context: bati('auth'), expected: 'with.tsx' },
      { name: 'feature off → keep else-branch', context: bati(), expected: 'without.tsx' },
    ],
  },
  {
    dir: 'bati-ternary',
    target: 'tsx',
    input: 'input.tsx',
    rules: batiRules,
    variants: [
      { name: 'feature on → consequent', context: bati('auth'), expected: 'with.tsx' },
      { name: 'feature off → alternate', context: bati(), expected: 'without.tsx' },
    ],
  },
  {
    dir: 'bati-comment-gated',
    target: 'tsx',
    input: 'input.tsx',
    rules: batiRules,
    variants: [
      { name: 'feature on → keep, strip directive', context: bati('auth'), expected: 'with.tsx' },
      { name: 'feature off → remove decl + directive', context: bati(), expected: 'without.tsx' },
    ],
  },
  {
    dir: 'bati-jsx-attr',
    target: 'tsx',
    input: 'input.tsx',
    rules: batiRules,
    variants: [
      { name: 'feature on → keep attribute', context: bati('auth'), expected: 'with.tsx' },
      { name: 'feature off → remove attribute', context: bati(), expected: 'without.tsx' },
    ],
  },
  {
    dir: 'bati-html-comment',
    target: 'html',
    input: 'input.html',
    rules: batiRules,
    variants: [
      { name: 'feature on → keep element', context: bati('auth'), expected: 'with.html' },
      { name: 'feature off → remove element', context: bati(), expected: 'without.html' },
    ],
  },
  {
    dir: 'nested-conditionals',
    target: 'tsx',
    input: 'input.tsx',
    rules: batiRules,
    variants: [
      { name: 'both on → inner then', context: bati('auth', 'admin'), expected: 'both.tsx' },
      { name: 'outer on, inner off → inner else', context: bati('auth'), expected: 'auth.tsx' },
      { name: 'outer off → outer else', context: bati(), expected: 'none.tsx' },
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
      { name: 'blank-separated directive does not gate', context: bati(), expected: 'out.tsx' },
    ],
  },
  {
    dir: 'comment-last-jsx-attr',
    target: 'tsx',
    input: 'input.tsx',
    rules: batiRules,
    variants: [
      { name: 'comment after last attr is inner, not a gate', context: bati(), expected: 'out.tsx' },
    ],
  },
  {
    dir: 'bati-ts-type',
    target: 'typescript',
    input: 'input.ts',
    rules: batiRules,
    variants: [
      { name: 'feature on → its branch type', context: bati('auth'), expected: 'with.ts' },
      { name: 'feature off → default branch type', context: bati(), expected: 'without.ts' },
    ],
  },
  {
    dir: 'vue-sfc',
    target: vueSplitter,
    input: 'input.vue',
    rules: batiRules,
    variants: [
      { name: 'transforms the <script> zone, feature on', context: bati('auth'), expected: 'with.vue' },
      { name: 'transforms the <script> zone, feature off', context: bati(), expected: 'without.vue' },
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
