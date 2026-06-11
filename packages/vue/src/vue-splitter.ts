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
 *
 * The template additionally yields one `typescript` zone per embedded expression —
 * interpolation bodies, directive values, dynamic directive arguments — and `<style>` one per
 * `v-bind()` argument, so a codemod sees real JS nodes inside both (see
 * {@link templateExpressionZones} / {@link styleBindZones}). These overlap the structural `vue` /
 * `css` zone: structure edits land on those nodes, expression edits on the `typescript` ones.
 */
export const vueSplitter: ZoneSplitter = {
  id: 'vue',
  // `vue` is the splitter's own shell grammar (loaded by `init()` below) and doubles as the
  // `<template>` zone grammar; the transformer registers it before this list is preloaded.
  grammars: ['vue', 'typescript', 'tsx', 'javascript', 'css'],

  async init(): Promise<void> {
    await Parser.loadGrammar(VUE_GRAMMAR, VUE_WASM)
    // `split()` also parses `<style>` content with the css grammar to extract `v-bind()` expressions.
    await Parser.loadGrammar('css')
  },

  split(source: string): RawZone[] {
    const root = Parser.parse(source, VUE_GRAMMAR).rootNode
    const zones: RawZone[] = []
    for (const section of namedChildren(root)) {
      const zone = sectionZone(section, source)
      if (zone) zones.push(zone)
      if (section.type === 'template_element') zones.push(...templateExpressionZones(section, source))
      else if (section.type === 'style_element') zones.push(...styleBindZones(section))
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

/** Depth-first walk over named children; `visit` returns `false` to stop descending into a node. */
function walk(node: Node, visit: (n: Node) => boolean): void {
  if (visit(node)) for (const child of namedChildren(node)) walk(child, visit)
}

/**
 * Every JS expression embedded in the template — interpolation bodies, directive values, and dynamic
 * directive arguments (`:[expr]`) — as its own zone, so a codemod sees real `identifier` /
 * `member_expression` / … nodes (use-detection, `$$` collapse, migrations) instead of opaque text.
 * Offsets are document-absolute (this walk runs over the whole-SFC parse), so edits map straight back.
 *
 * Values are parsed as **TypeScript**: a superset for expressions, it accepts template `as` casts and
 * avoids the JSX ambiguity a `tsx` parse would give `a < b`. The classifier is deliberately small —
 * `v-for` (keep only the iterable; its alias introduces template-locals) and `v-slot` (a binding
 * pattern, no references) are the sole special cases; every other value is emitted whole. A value that
 * is a bare object literal (`:class="{ a: x }"`) parses in statement position as a block, not an
 * object — identifiers inside still surface, but structural edits targeting the object won't match.
 */
function templateExpressionZones(template: Node, source: string): RawZone[] {
  const zones: RawZone[] = []
  walk(template, (node) => {
    if (node.type === 'interpolation') {
      const body = childByType(node, 'raw_text')
      if (body) pushExpr(zones, body.text, body.startIndex)
      return false
    }
    if (node.type === 'directive_attribute') {
      collectDirective(node, source, zones)
      return false
    }
    return true
  })
  return zones
}

// `(item, i) in items` / `item of items` → capture the alias and the iterable separately; the lazy
// first group stops at the first ` in `/` of `, matching Vue's own `forAliasRE`.
const FOR_ALIAS_RE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/

function collectDirective(attr: Node, source: string, zones: RawZone[]): void {
  // `:[expr]` — the dynamic argument is itself a reference expression, regardless of the value.
  const dynamic = firstDescendant(attr, 'dynamic_directive_inner_value')
  if (dynamic) pushExpr(zones, dynamic.text, dynamic.startIndex)

  const value = firstDescendant(attr, 'attribute_value')
  if (!value) return // valueless directive (`v-else`, `v-pre`, `#default`, …)

  const kind = directiveKind(attr, source)
  if (kind === 'slot') return // `v-slot`/`#` value is a binding pattern — locals, not references
  if (kind === 'for') {
    const m = FOR_ALIAS_RE.exec(value.text) // keep only the iterable; the alias is a template-local
    if (m) pushExpr(zones, m[2], value.startIndex + (value.text.length - m[2].length))
    return
  }
  pushExpr(zones, value.text, value.startIndex)
}

/** `v-for` and `v-slot` need special value handling; every other directive's value is a plain
 *  expression. The vue CST collapses `:`/`@`/`#` shorthands to a bare `directive_value`, so the slot
 *  shorthand is recovered from the `#` sigil immediately preceding the argument. */
function directiveKind(attr: Node, source: string): 'for' | 'slot' | 'expr' {
  const name = childByType(attr, 'directive_name')
  if (name) {
    if (name.text === 'v-for') return 'for'
    if (name.text === 'v-slot') return 'slot'
    return 'expr'
  }
  const arg = childByType(attr, 'directive_value')
  if (arg && source[arg.startIndex - 1] === '#') return 'slot'
  return 'expr'
}

function pushExpr(zones: RawZone[], source: string, startOffset: number): void {
  if (source.trim() === '') return // empty `{{ }}` / `:x=""` — nothing to parse
  zones.push({ language: 'typescript', source, startOffset })
}

/** Depth-first search for the first descendant of `type` (the value/argument nodes sit a level or
 *  two below `directive_attribute`, under `quoted_attribute_value` / `dynamic_directive_value`). */
function firstDescendant(node: Node, type: string): Node | null {
  for (const child of namedChildren(node)) {
    if (child.type === type) return child
    const nested = firstDescendant(child, type)
    if (nested) return nested
  }
  return null
}

/**
 * Vue's `<style>` can reference a script binding through the special `v-bind()` css function
 * (`color: v-bind(themeColor)`). Parse the style with the css grammar and emit each `v-bind()`
 * argument — a bare `plain_value` (`themeColor`, `theme.color`) or a quoted `string_content` (a JS
 * expression) — as a `typescript` zone, so it reads as a real reference like a template expression.
 * Gated on a cheap substring so a style without `v-bind` skips the parse entirely.
 */
function styleBindZones(section: Node): RawZone[] {
  const body = childByType(section, 'raw_text')
  if (!body || !body.text.includes('v-bind(')) return []
  const zones: RawZone[] = []
  walk(Parser.parse(body.text, 'css').rootNode, (node) => {
    if (node.type !== 'call_expression' || childByType(node, 'function_name')?.text !== 'v-bind') return true
    const arg = firstDescendant(node, 'plain_value') ?? firstDescendant(node, 'string_content')
    if (arg) pushExpr(zones, arg.text, body.startIndex + arg.startIndex) // body offset is document-absolute
    return false
  })
  return zones
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
