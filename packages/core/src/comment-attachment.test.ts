import { describe, it, expect, beforeAll } from 'vitest'
import { Parser } from './parser.js'
import { wrapNode } from './rich-node.js'
import { attachComments } from './comment-attachment.js'
import type { GrammarId, RichNode } from './types.js'

beforeAll(async () => {
  await Parser.loadGrammar('typescript')
  await Parser.loadGrammar('tsx')
  await Parser.loadGrammar('html')
})

async function prepared(source: string, language: GrammarId): Promise<RichNode> {
  const root = wrapNode(Parser.parse(source, language).rootNode, language, 0)
  attachComments(root)
  return root
}

function find(node: RichNode, pred: (n: RichNode) => boolean): RichNode | null {
  if (pred(node)) return node
  for (const c of node.allChildren) {
    const hit = find(c, pred)
    if (hit) return hit
  }
  return null
}

const byType = (type: string) => (n: RichNode) => n.type === type
const text = (cs: RichNode[]) => cs.map((c) => c.text)

describe('attachComments', () => {
  it('attaches a comment on the line directly above as leading', async () => {
    const r = await prepared('// hi\nconst x = 1', 'typescript')
    const decl = find(r, byType('lexical_declaration'))!
    expect(text(decl.leadingComments)).toEqual(['// hi'])
  })

  it('does not attach a comment separated by a blank line — it floats to inner', async () => {
    const r = await prepared('// hi\n\nconst x = 1', 'typescript')
    const decl = find(r, byType('lexical_declaration'))!
    expect(decl.leadingComments).toEqual([])
    expect(text(r.innerComments)).toContain('// hi')
  })

  it('attaches a same-line comment between siblings as trailing of the preceding one', async () => {
    // The comment sits between the two array elements on the same row, so it is a
    // sibling of both (not absorbed) — the case the trailing branch is built for.
    const r = await prepared('const a = [1, /* c */ 2]', 'typescript')
    const first = find(r, byType('array'))!.children[0]
    expect(first.type).toBe('number')
    expect(text(first.trailingComments)).toEqual(['/* c */'])
  })

  it('a same-line trailing comment absorbed into the preceding node lands as its inner', async () => {
    // tree-sitter extends the declaration to include `// tail`, so the comment is the
    // declaration's last child (no following sibling) → inner, per §6.
    const r = await prepared('const x = 1 // tail\nconst y = 2', 'typescript')
    const declX = r.children[0]
    expect(declX.type).toBe('lexical_declaration')
    expect(text(declX.innerComments)).toEqual(['// tail'])
  })

  it('attaches a comment with no following sibling as inner of its parent', async () => {
    const r = await prepared('function f() {\n  g()\n  // last\n}', 'typescript')
    const block = find(r, byType('statement_block'))!
    expect(text(block.innerComments)).toEqual(['// last'])
  })

  it('JSX: a comment between attributes is leading of the following attribute', async () => {
    const r = await prepared('const e = <div\n  a={1}\n  // mid\n  b={2}\n>hi</div>', 'tsx')
    const opening = find(r, byType('jsx_opening_element'))!
    const attrB = opening.children.find((c) => c.type === 'jsx_attribute' && c.text.startsWith('b'))!
    expect(text(attrB.leadingComments)).toEqual(['// mid'])
  })

  it('JSX: a comment after the last attribute is inner of the element (v1 limitation)', async () => {
    const r = await prepared('const e = <div\n  a={1}\n  // after\n/>', 'tsx')
    const el = find(r, byType('jsx_self_closing_element'))!
    expect(text(el.innerComments)).toEqual(['// after'])
  })

  it('HTML: a comment on the line above an element is its leading comment', async () => {
    const r = await prepared('<!-- c -->\n<div></div>', 'html')
    const el = find(r, byType('element'))!
    expect(text(el.leadingComments)).toEqual(['<!-- c -->'])
  })
})
