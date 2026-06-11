import { fileURLToPath } from 'node:url'
import type { GrammarId, ZoneSplitter } from '@codegraft/core'
import { Parser, assert, type Node } from '@codegraft/core/internal'

// The vue grammar wasm is vendored in this package (tree-sitter-vue ships no prebuilt
// wasm), so @codegraft/vue owns its grammar with no tree-sitter-vue dependency.
const VUE_WASM = fileURLToPath(new URL('../wasm/tree-sitter-vue.wasm', import.meta.url))
const VUE_GRAMMAR = 'vue' // the tree-sitter-vue grammar; also the GrammarId of the `<template>` zone

type RawZone = { language: GrammarId; source: string; startOffset: number }

/**
 * Splits a Vue SFC into its sections by walking the `tree-sitter-vue` CST (never by
 * regex, so `</script>`-like text inside the template can't confuse it). `<template>`
 * becomes a `vue` zone (its own grammar, so `interpolation`/`directive_attribute` nodes
 * stay structural), `<script>`/`<script setup>` a `typescript`/`tsx`/`javascript` zone
 * (by `lang`), and `<style>` a `css` zone — each carrying the exact document offset of
 * its content.
 */
export const vueSplitter: ZoneSplitter = {
  id: 'vue',
  // `vue` is the splitter's own shell grammar (loaded by `init()` below) and doubles as the
  // `<template>` zone grammar; the transformer registers it before this list is preloaded.
  grammars: ['vue', 'typescript', 'tsx', 'javascript', 'css'],

  async init(): Promise<void> {
    await Parser.loadGrammar(VUE_GRAMMAR, VUE_WASM)
  },

  split(source: string): RawZone[] {
    const root = Parser.parse(source, VUE_GRAMMAR).rootNode
    const zones: RawZone[] = []
    for (const section of namedChildren(root)) {
      const zone = sectionZone(section, source)
      if (zone) zones.push(zone)
    }
    return zones
  },
}

function sectionZone(section: Node, source: string): RawZone | null {
  switch (section.type) {
    case 'template_element': {
      const startTag = childByType(section, 'start_tag')
      const endTag = childByType(section, 'end_tag')
      assert(startTag && endTag, 'a <template> element must have start and end tags')
      // content lives between the tags; re-parsed with the vue grammar (not html) so template
      // expressions stay structural — `interpolation`, `directive_attribute`, component `tag_name`.
      return {
        language: 'vue',
        source: source.slice(startTag.endIndex, endTag.startIndex),
        startOffset: startTag.endIndex,
      }
    }
    case 'script_element': {
      const body = childByType(section, 'raw_text')
      if (!body) return null // empty <script>
      const startTag = childByType(section, 'start_tag')
      return { language: scriptLanguage(startTag?.text ?? ''), source: body.text, startOffset: body.startIndex }
    }
    case 'style_element': {
      const body = childByType(section, 'raw_text')
      if (!body) return null
      return { language: 'css', source: body.text, startOffset: body.startIndex }
    }
    default:
      return null
  }
}

function scriptLanguage(startTag: string): GrammarId {
  const lang = /\blang\s*=\s*["']([^"']+)["']/.exec(startTag)?.[1]
  if (lang === 'ts') return 'typescript'
  if (lang === 'tsx' || lang === 'jsx') return 'tsx'
  return 'javascript' // default, and lang="js"
}

function namedChildren(node: Node): Node[] {
  return node.namedChildren.filter((c): c is Node => c !== null)
}

function childByType(node: Node, type: string): Node | null {
  return namedChildren(node).find((c) => c.type === type) ?? null
}
