import { describe, it, expect } from 'vitest'
import { createTransformer } from './create-transformer.js'
import { Parser } from './parser.js'
import { remove } from './types.js'
import type { CaptureArg, CompiledRule, PatternNode, RichNode, ZoneSplitter } from './types.js'

// Pattern parsing lives in @trast/match; here we hand-build CompiledRule data.
function rule(
  language: CompiledRule['language'],
  pattern: PatternNode,
  rewrite: CompiledRule['rewrite'],
  commentRegex: RegExp | null = null,
): CompiledRule {
  return { language, pattern, commentRegex, rewrite }
}

// Stub two-zone splitter (ts + css) — core has no Vue dependency.
const MARKER = '\n///---\n'
const stub: ZoneSplitter = {
  id: 'stub',
  grammars: ['typescript', 'css'],
  async init() {
    await Parser.loadGrammar('typescript')
    await Parser.loadGrammar('css')
  },
  split(source) {
    const idx = source.indexOf(MARKER)
    const cssStart = idx + MARKER.length
    return [
      { language: 'typescript', source: source.slice(0, idx), startOffset: 0 },
      { language: 'css', source: source.slice(cssStart), startOffset: cssStart },
    ]
  },
}

describe('createTransformer', () => {
  it('returns source unchanged with no rules (GrammarId target)', async () => {
    const t = await createTransformer('tsx', []).init()
    const src = 'export const x = <div/>\n'
    expect(t.transform(src, {})).toBe(src)
  })

  it('returns source unchanged with no rules (ZoneSplitter target)', async () => {
    const t = await createTransformer(stub, []).init()
    const src = 'const x = 1' + MARKER + 'a { color: red }'
    expect(t.transform(src, {})).toBe(src)
  })

  it('init() is idempotent (same Transformer instance)', async () => {
    const lazy = createTransformer('typescript', [])
    expect(await lazy.init()).toBe(await lazy.init())
  })

  it('replaces a matched node with a string result', async () => {
    const t = await createTransformer(
      'typescript',
      [rule('typescript', { kind: 'node', nodeType: 'lexical_declaration' }, () => 'REPLACED')],
    ).init()
    expect(t.transform('const x = 1', {})).toBe('REPLACED')
  })

  it('deletes a matched node when the rewrite returns remove', async () => {
    const t = await createTransformer(
      'typescript',
      [rule('typescript', { kind: 'node', nodeType: 'debugger_statement' }, () => remove)],
    ).init()
    expect(t.transform('debugger;\nconst x = 1', {})).toBe('\nconst x = 1')
  })

  it('re-emits a single captured RichNode by its own text', async () => {
    // lexical_declaration > variable_declarator > [identifier, number]; capture the value
    const pattern: PatternNode = {
      kind: 'exact',
      nodeType: 'lexical_declaration',
      children: [
        {
          kind: 'exact',
          nodeType: 'variable_declarator',
          children: [{ kind: 'capture', name: 'name' }, { kind: 'capture', name: 'value' }],
        },
      ],
    }
    const t = await createTransformer(
      'typescript',
      [rule('typescript', pattern, (caps: CaptureArg) => caps.value as RichNode)],
    ).init()
    expect(t.transform('const x = 1', {})).toBe('1')
  })

  it('re-emits a RichNode[] spread as the source span (separators preserved, not joined)', async () => {
    // match a statement_block and return its body statements; the span keeps the "; "
    const pattern: PatternNode = {
      kind: 'exact',
      nodeType: 'statement_block',
      children: [{ kind: 'spread', name: 'body' }],
    }
    const t = await createTransformer(
      'typescript',
      [rule('typescript', pattern, (caps: CaptureArg) => caps.body as RichNode[])],
    ).init()
    // the block `{ a(); b() }` collapses to its body; "; " between statements survives
    expect(t.transform('function f() { a(); b() }', {})).toBe('function f() a(); b()')
  })

  it('outer-wins: the first matching rule claims the node and its subtree is skipped', async () => {
    const t = await createTransformer(
      'typescript',
      [rule('typescript', { kind: 'node', nodeType: 'call_expression' }, () => 'CALL')],
    ).init()
    // outer call f(g()) matches first; inner g() is never visited
    expect(t.transform('f(g())', {})).toBe('CALL')
  })

  it('filters rules to each zone by language', async () => {
    const t = await createTransformer(stub, [
      rule('css', { kind: 'node', nodeType: 'declaration' }, () => '/*css*/'),
      rule('typescript', { kind: 'node', nodeType: 'lexical_declaration' }, () => 'TS'),
    ]).init()
    const out = t.transform('const x = 1' + MARKER + 'a { color: red }', {})
    expect(out).toBe('TS' + MARKER + 'a { /*css*/ }')
  })

  it('an "any" rule runs on every zone of a split target', async () => {
    // 'any' matches the first node visited — each zone's root — so each zone collapses
    const t = await createTransformer(stub, [rule('any', { kind: 'any' }, () => 'X')]).init()
    const out = t.transform('const x = 1' + MARKER + 'a { color: red }', {})
    expect(out).toBe('X' + MARKER + 'X')
  })

  it('comment-gated rule fires only on a matching leading comment and consumes it', async () => {
    const t = await createTransformer(
      'typescript',
      [rule('typescript', { kind: 'node', nodeType: 'lexical_declaration' }, () => remove, /@kill/)],
    ).init()
    // only the @kill-tagged declaration (and its comment) is removed
    expect(t.transform('// @kill\nconst x = 1\nconst y = 2', {})).toBe('\nconst y = 2')
  })
})
