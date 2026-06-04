import { describe, it, expect, beforeAll } from 'vitest'
import { Parser } from './parser.js'
import { splitAndParse } from './zone-splitter.js'
import type { ZoneSplitter } from './types.js'

// A stub two-zone splitter standing in for @trast/vue: core has no Vue dependency, so
// its own tests exercise the pipeline through an inline splitter. The source is split
// at a marker into a typescript zone and a css zone.
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

beforeAll(async () => {
  await Parser.loadGrammar('typescript')
  await stub.init()
})

describe('splitAndParse', () => {
  it('a GrammarId produces one synthetic zone at offset 0', () => {
    const src = 'const x = 1'
    const zones = splitAndParse(src, 'typescript')
    expect(zones).toHaveLength(1)
    expect(zones[0].language).toBe('typescript')
    expect(zones[0].startOffset).toBe(0)
    expect(zones[0].source).toBe(src)
    expect(zones[0].tree.type).toBe('program')
  })

  it('a ZoneSplitter produces one parsed zone per section', () => {
    const src = 'const x = 1' + MARKER + 'a { color: red }'
    const zones = splitAndParse(src, stub)
    expect(zones.map((z) => z.language)).toEqual(['typescript', 'css'])
    expect(zones[0].tree.type).toBe('program')
    expect(zones[1].tree.type).toBe('stylesheet')
  })

  it('each zone.source is exactly the outer slice at its startOffset (no off-by-one)', () => {
    const src = 'const x = 1' + MARKER + 'a { color: red }'
    for (const z of splitAndParse(src, stub)) {
      expect(z.source).toBe(src.slice(z.startOffset, z.startOffset + z.source.length))
    }
  })

  it('document offsets fold in the zone startOffset', () => {
    const src = 'const x = 1' + MARKER + 'a { color: red }'
    const css = splitAndParse(src, stub)[1]
    // the css root starts at index 0 within its zone → documentStartIndex is the offset
    expect(css.tree.documentStartIndex).toBe(css.startOffset)
    expect(css.tree.documentEndIndex).toBe(css.startOffset + css.source.length)
  })
})
