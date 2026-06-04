import type { GrammarId, PatternNode, RichNode } from '@trast/core'
import { Parser, wrapNode, assert } from '@trast/core/internal'

type PatternContext = 'expr' | 'type'

/** A `$name` or `$$$name` occurrence, mangled to a parser-safe identifier. */
interface Capture {
  name: string
  spread: boolean
}

// $$$name (spread) is tried before $name (single) so the triple form wins.
const CAPTURE_SCAN = /\$\$\$([A-Za-z_][A-Za-z0-9_]*)|\$([A-Za-z_][A-Za-z0-9_]*)/g
const PLACEHOLDER = /^__TRAST_\d+__$/
const RESERVED = new Set(['node', 'commentMatch'])

/**
 * Compile a template-literal pattern string into a {@link PatternNode} tree (§5). Run
 * lazily (the grammar must already be loaded), so it is synchronous.
 *
 * 1. Scan for `$`/`$$$` captures, asserting reserved names are not used.
 * 2. Substitute each with a unique mangled identifier that parses as a leaf in every
 *    grammar.
 * 3. In `type` context, wrap as `type __trast_p__ = …` so `<…>` reads as generics.
 * 4. Parse, then locate the real pattern root (unwrap the program / type-alias shell).
 * 5. Recursively `build` the tree, lifting captures out of parser artifacts.
 */
export function parsePattern(raw: string, lang: GrammarId, ctx: PatternContext): PatternNode {
  const registry = new Map<string, Capture>()
  let n = 0
  let substituted = raw.replace(CAPTURE_SCAN, (_match, spreadName?: string, captureName?: string) => {
    const spread = spreadName !== undefined
    const name = (spread ? spreadName : captureName)!
    assert(!RESERVED.has(name), `capture name '${name}' is reserved`)
    const placeholder = `__TRAST_${n++}__`
    registry.set(placeholder, { name, spread })
    return placeholder
  })

  if (ctx === 'type') substituted = `type __trast_p__ = ${substituted}`

  const root = wrapNode(Parser.parse(substituted, lang).rootNode, lang, 0)
  const patternRoot = ctx === 'type' ? extractTypeAlias(root) : extractExpr(root)
  return build(patternRoot, registry, ctx)
}

/** The single top-level construct, unwrapping the `expression_statement` artifact that
 *  the parser adds around an expression pattern so it roots at the expression itself. */
function extractExpr(root: RichNode): RichNode {
  assert(root.children.length === 1, 'a pattern must contain exactly one top-level construct')
  const first = root.children[0]
  if (first.type === 'expression_statement' && first.children.length === 1) return first.children[0]
  return first
}

/** The `value` of the `type __trast_p__ = …` shell wrapped around a type pattern. */
function extractTypeAlias(root: RichNode): RichNode {
  assert(
    root.children.length === 1 && root.children[0].type === 'type_alias_declaration',
    'type pattern did not parse to a type alias',
  )
  const value = root.children[0].child('value')
  assert(value, 'type pattern alias has no value')
  return value
}

function build(node: RichNode, registry: Map<string, Capture>, ctx: PatternContext): PatternNode {
  if (isPlaceholder(node)) return placeholderNode(node, registry)
  if (node.children.length === 0) return { kind: 'text', nodeType: node.type, text: node.text }

  const children = node.children.map(
    (child) => liftArtifact(child, registry, ctx) ?? build(child, registry, ctx),
  )
  const spreadAt = children.findIndex((c) => c.kind === 'spread')
  assert(
    spreadAt === -1 || spreadAt === children.length - 1,
    'a spread capture ($$$) must be the last child in its sibling list',
  )
  return { kind: 'exact', nodeType: node.type, children }
}

/**
 * A bare placeholder in statement / type-member position is wrapped by the parser in a
 * transparent node the author never wrote. Collapse exactly that ONE wrapper, so the
 * capture/spread becomes a direct child of the real container (block, object_type, …)
 * rather than replacing it. A recursive collapse would swallow the container itself.
 */
function liftArtifact(
  child: RichNode,
  registry: Map<string, Capture>,
  ctx: PatternContext,
): PatternNode | null {
  if (isArtifactWrapper(child, ctx) && child.children.length === 1 && isPlaceholder(child.children[0])) {
    return placeholderNode(child.children[0], registry)
  }
  return null
}

function isArtifactWrapper(node: RichNode, ctx: PatternContext): boolean {
  return (
    node.type === 'expression_statement' || // { $$$body }, { $stmt }
    (ctx === 'type' && node.type === 'property_signature') // BATI.If<{ $$$branches }>
  )
}

/** Grammar-agnostic: a placeholder is a leaf whose text is a mangled identifier — so it
 *  is detected by text, not node type (it is `identifier` in JS, `plain_value` in CSS, …). */
function isPlaceholder(node: RichNode): boolean {
  return node.children.length === 0 && PLACEHOLDER.test(node.text)
}

function placeholderNode(node: RichNode, registry: Map<string, Capture>): PatternNode {
  const capture = registry.get(node.text)
  assert(capture, `placeholder ${node.text} has no registry entry`)
  return capture.spread ? { kind: 'spread', name: capture.name } : { kind: 'capture', name: capture.name }
}
