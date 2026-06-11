import type {
  GrammarId,
  LazyTransformer,
  RichNode,
  Transformer,
  Zone,
  ZoneSplitter,
} from './types.js'
import type { FieldName, NodeTypeOf, NodeTypeAllOf, FieldNameOf } from './generated/node-types.js'
import { Parser } from './parser.js'
import { splitAndParse } from './zone-splitter.js'
import { attachComments, COMMENT_TYPES } from './comment-attachment.js'
import { EditCollector } from './edit-collector.js'
import { evaluate as evaluateNode } from './evaluate.js'
import { createResolver, type Resolver } from './resolver.js'
import { resolveStyle, type FormatOptions } from './format.js'
import { Formatter } from './formatter.js'
import { trailingSeparator } from './containers.js'
import { assert } from './assert.js'

/** Shared per-transform state a {@link Collection} records edits into. */
interface Session {
  collector: EditCollector
  /** The layout formatter every edit's rendering is delegated to (re-indent, container layout, line
   *  collapse). Always present — formatting is applied on every transform. */
  formatter: Formatter
  /** The binding resolver for `node`'s zone (JS/TS/TSX), or `null` if unsupported. */
  resolver(node: RichNode): Resolver | null
}

/** A field predicate in `find(type, attrs)`: equals a field's text (`string`), matches it
 *  (`RegExp`), recurses into the field child (a nested `{ … }` of more matchers), or is an
 *  escape-hatch predicate over the whole node (`function`). The pseudo-key `text` matches the
 *  node's own text rather than a field. */
type AttrMatcher<G extends GrammarId = GrammarId> = string | RegExp | ((node: RichNode) => boolean) | AttrMatchers<G>
/** Field-keyed matchers (the `text` pseudo-key matches the node's own text). The mapped type is a
 *  deferred position, so the recursion through {@link AttrMatcher} resolves rather than cycling. */
type AttrMatchers<G extends GrammarId = GrammarId> = { [K in FieldNameOf<G> | 'text']?: AttrMatcher<G> }

/** A replacement text, or a function deriving it from the (single-node) Collection being edited. */
type TextArg<G extends GrammarId = GrammarId> = string | ((node: Collection<G>) => string)

/**
 * A jscodeshift-style selection of CST nodes bound to one transform run. Query methods
 * (`find`/`filter`/`closest`/`parent`/`children`/`first`/`at`) return new Collections; edit
 * methods (`replaceWith`/`remove`/…) record magic-string edits and return `this`. Single-node
 * accessors (`node`/`text`/`type`/`field`/`evaluate`) assert the collection holds exactly one
 * node — the shape you get inside `forEach`, after `first()`/`at()`, or from `field()`.
 *
 * The grammar parameter `G` types the node-type and field-name strings (`NodeTypeOf<G>` etc.) and
 * is carried through navigation. It defaults to every built-in grammar — annotate `root` (e.g.
 * `(root: Collection<'tsx'>) => …`) to narrow `find`/`field` to one grammar's vocabulary.
 */
export class Collection<G extends GrammarId = GrammarId> {
  readonly #nodes: RichNode[]
  readonly #session: Session

  constructor(nodes: RichNode[], session: Session) {
    this.#nodes = nodes
    this.#session = session
  }

  // ---- query ----

  /** Descendants (not self) of node type `type` — a concrete type or a grammar supertype
   *  (e.g. `expression`), optionally filtered by field predicates. */
  find(type: NodeTypeOf<G>, attrs?: AttrMatchers<G>): Collection<G> {
    const out: RichNode[] = []
    const seen = new Set<RichNode>()
    const walk = (node: RichNode): void => {
      for (const child of node.children) {
        if (isType(child, type) && !seen.has(child) && matches(child, attrs)) {
          seen.add(child)
          out.push(child)
        }
        walk(child)
      }
    }
    for (const node of this.#nodes) walk(node)
    return this.#select(out)
  }

  /** Comment nodes in the subtree (which `find`/`children` omit), optionally only those matching
   *  `pattern` — the entry point for transforms that act on directive comments themselves. */
  findComments(pattern?: RegExp): Collection<G> {
    const out: RichNode[] = []
    const walk = (node: RichNode): void => {
      for (const child of node.allChildren) {
        if (COMMENT_TYPES[child.language].has(child.type) && (!pattern || pattern.test(child.text))) out.push(child)
        walk(child)
      }
    }
    for (const node of this.#nodes) walk(node)
    return this.#select(out)
  }

  filter(predicate: (node: Collection<G>) => boolean): Collection<G> {
    return this.#select(this.#nodes.filter((n) => predicate(new Collection<G>([n], this.#session))))
  }

  /** Nearest ancestor (not self) of `type` — concrete or a grammar supertype — per selected node. */
  closest(type: NodeTypeOf<G>): Collection<G> {
    return this.#select(dedupe(this.#nodes.map((n) => ancestorOfType(n, type)).filter(present)))
  }

  parent(): Collection<G> {
    return this.#select(dedupe(this.#nodes.map((n) => n.parent).filter(present)))
  }

  children(): Collection<G> {
    return this.#select(this.#nodes.flatMap((n) => n.children))
  }

  /** All named siblings of each selected node (excluding itself). */
  siblings(): Collection<G> {
    return this.#select(dedupe(this.#nodes.flatMap((n) => n.parent?.children.filter((c) => c !== n) ?? [])))
  }

  nextSibling(): Collection<G> {
    return this.#select(this.#nodes.map((n) => siblingAt(n, 1)).filter(present))
  }

  prevSibling(): Collection<G> {
    return this.#select(this.#nodes.map((n) => siblingAt(n, -1)).filter(present))
  }

  /** Every ancestor of each selected node (innermost first), optionally of node type `type`. */
  ancestors(type?: NodeTypeOf<G>): Collection<G> {
    const out: RichNode[] = []
    for (const n of this.#nodes) {
      for (let cur = n.parent; cur; cur = cur.parent) if (!type || isType(cur, type)) out.push(cur)
    }
    return this.#select(dedupe(out))
  }

  /** Nearest enclosing scope (ancestor-or-self): a function, block, loop, catch, or the program. */
  closestScope(): Collection<G> {
    return this.#select(dedupe(this.#nodes.map(scopeOf).filter(present)))
  }

  first(): Collection<G> {
    return this.#select(this.#nodes.slice(0, 1))
  }

  at(index: number): Collection<G> {
    const node = this.#nodes.at(index)
    return this.#select(node ? [node] : [])
  }

  size(): number {
    return this.#nodes.length
  }

  forEach(fn: (node: Collection<G>) => void): this {
    for (const node of this.#nodes) fn(new Collection<G>([node], this.#session))
    return this
  }

  map<T>(fn: (node: Collection<G>) => T): T[] {
    return this.#nodes.map((node) => fn(new Collection<G>([node], this.#session)))
  }

  nodes(): RichNode[] {
    return [...this.#nodes]
  }

  /** Whether every selected node is of `type` (concrete or supertype); false for an empty selection. */
  isOfType(type: NodeTypeOf<G>): boolean {
    return this.#nodes.length > 0 && this.#nodes.every((n) => isType(n, type))
  }

  /** The distinct node types in the selection. */
  getTypes(): string[] {
    return [...new Set(this.#nodes.map((n) => n.type))]
  }

  // ---- single-node accessors (assert exactly one) ----

  get node(): RichNode {
    return this.#single()
  }
  get text(): string {
    return this.#single().text
  }
  get type(): NodeTypeAllOf<G> {
    return this.#single().type as NodeTypeAllOf<G>
  }
  /** The field child as a (0-or-1) Collection, e.g. `node.field('condition')`. */
  field(name: FieldNameOf<G>): Collection<G> {
    const child = this.#single().child(name as FieldName)
    return this.#select(child ? [child] : [])
  }
  /** Evaluate this node as a build-time expression against `context` (see core `evaluate`). */
  evaluate(context: unknown): unknown {
    return evaluateNode(this.#single(), context)
  }

  // ---- scope (JS/TS/TSX; confident-or-abstain) ----

  /** Every occurrence (declaration + references) of the binding this node declares, or `null`
   *  when not confidently resolvable — the safe signal to skip a rename. */
  references(): Collection<G> | null {
    const node = this.#single()
    const refs = this.#session.resolver(node)?.references(node)
    return refs ? this.#select(refs) : null
  }

  /** The declaration this reference resolves to, or `null` for a global / when uncertain. */
  definition(): Collection<G> | null {
    const node = this.#single()
    const def = this.#session.resolver(node)?.definition(node)
    return def ? this.#select([def]) : null
  }

  /** The declaration `name` resolves to from this node's position; `null` for a global / abstain. */
  lookup(name: string): Collection<G> | null {
    const node = this.#single()
    const decl = this.#session.resolver(node)?.lookup(node, name)
    return decl ? this.#select([decl]) : null
  }

  /** Every binding visible at this node (inner shadows outer), or `null` when abstaining. */
  bindingsInScope(): Collection<G> | null {
    const node = this.#single()
    const bindings = this.#session.resolver(node)?.bindingsInScope(node)
    return bindings ? this.#select(bindings) : null
  }

  // ---- construction ----

  /** Build a code string, interpolating values (a `Collection` contributes its text), validated
   *  against the grammar of the first selected node — a syntax error asserts rather than emitting
   *  malformed code. Validates as a standalone snippet, so build whole expressions or statements
   *  and let `append`/`prepend` add separators. The result feeds any insert/replace. */
  code(strings: TemplateStringsArray, ...values: unknown[]): string {
    const built = strings.reduce((acc, s, i) => acc + s + (i < values.length ? snippet(values[i]) : ''), '')
    const language = this.#firstNode().language
    assert(!Parser.parse(built, language).rootNode.hasError, `code\`\`: invalid ${language} snippet: ${built}`)
    return built
  }

  // ---- edits ----

  /** Replace each selected node with `text`, or with the string a callback derives from it. */
  replaceWith(text: TextArg<G>): this {
    for (const node of this.#nodes) {
      const next = this.#session.formatter.reindent(this.#text(text, node), node.documentStartIndex)
      this.#session.collector.overwrite(node.documentStartIndex, node.documentEndIndex, next)
    }
    return this
  }

  /** Overwrite a field child's text (literal or derived from its current text); no-op where the
   *  field is absent, mirroring `field()` returning an empty selection. */
  setField(name: FieldNameOf<G>, text: string | ((current: string) => string)): this {
    for (const node of this.#nodes) {
      const field = node.child(name as FieldName)
      if (!field) continue
      const next = typeof text === 'function' ? text(field.text) : text
      this.#session.collector.overwrite(field.documentStartIndex, field.documentEndIndex, next)
    }
    return this
  }

  /**
   * Remove each selected node.
   * - `separator`: also drop the trailing `,` of a list element, leaving no array hole / dangling comma.
   * - `wholeLines`: remove the whole lines the node spans (a full-line comment, a YAML entry), so no
   *   blank line is left; `collapseBlankBefore` additionally absorbs a blank-line separator directly above.
   *
   * Under `format`, a node that owns its line(s) collapses that line automatically (no leftover blank),
   * while an inline element is left untouched around the hole — so `wholeLines` is only needed to force
   * whole-line removal where the codemod can't opt in per node (and for `collapseBlankBefore`).
   */
  remove(options?: { separator?: boolean; wholeLines?: boolean; collapseBlankBefore?: boolean }): this {
    for (const node of this.#nodes) {
      if (options?.wholeLines) {
        this.#session.formatter.removeWholeLines(node.documentStartIndex, node.documentEndIndex, options.collapseBlankBefore)
        continue
      }
      let end = node.documentEndIndex
      if (options?.separator) {
        const comma = trailingSeparator(node)
        if (comma) end = comma.documentEndIndex
      }
      // Collapse the line when the node owned it, the way Prettier would have.
      this.#session.formatter.removeNode(node.documentStartIndex, end)
    }
    return this
  }

  /**
   * Narrow-delete: keep `keep` (a 0+-node selection within this node) and drop the wrapper
   * around it — remove `[this.start, firstKept.start)` and `[lastKept.end, this.end)`. The
   * kept range stays editable, so edits made to nodes inside it in the same pass still compose
   * (this is what lets nested conditionals collapse in one pass). Empty `keep` removes the whole
   * node.
   */
  unwrap(keep: Collection<G>): this {
    const wrapper = this.#single()
    const kept = keep.#nodes
    if (kept.length === 0) {
      this.#session.collector.remove(wrapper.documentStartIndex, wrapper.documentEndIndex)
      return this
    }
    this.#session.collector.remove(wrapper.documentStartIndex, kept[0].documentStartIndex)
    this.#session.collector.remove(kept[kept.length - 1].documentEndIndex, wrapper.documentEndIndex)
    return this
  }

  // ---- insertion ----

  /** Insert `text` (literal or derived per node) immediately before each selected node. */
  insertBefore(text: TextArg<G>): this {
    for (const node of this.#nodes) {
      const at = node.documentStartIndex
      let next = this.#session.formatter.reindent(this.#text(text, node), at)
      // A trailing newline would leave the displaced node at column 0 — restore its indent.
      if (next.endsWith('\n')) next += this.#session.formatter.indentAt(at)
      this.#session.collector.insertLeft(at, next)
    }
    return this
  }

  /** Insert `text` (literal or derived per node) immediately after each selected node. */
  insertAfter(text: TextArg<G>): this {
    for (const node of this.#nodes) {
      this.#session.collector.insertRight(node.documentEndIndex, this.#session.formatter.reindent(this.#text(text, node), node.documentStartIndex))
    }
    return this
  }

  /** Surround each selected node with `before`…`after`. */
  wrap(before: string, after: string): this {
    for (const node of this.#nodes) {
      this.#session.collector.insertLeft(node.documentStartIndex, before)
      this.#session.collector.insertRight(node.documentEndIndex, after)
    }
    return this
  }

  /** Append `text` as the last element of each container: a fresh indented line in a block/class
   *  body (re-indented under `format`), or after the last element of an array/object/argument list
   *  (comma-separated) or interface/object-type body (`;`-separated). Under `format` a multi-line
   *  container keeps its layout — the element lands on its own line at the elements' indent, with a
   *  trailing separator matching the container's style — while an inline one stays on one line. */
  append(text: string): this {
    for (const node of this.#nodes) this.#session.formatter.append(node, text)
    return this
  }

  /** Prepend `text` as the first element of each container — the mirror of {@link append}. */
  prepend(text: string): this {
    for (const node of this.#nodes) this.#session.formatter.prepend(node, text)
    return this
  }

  /** Insert a top-level import once: a no-op if a statement importing the same module already
   *  exists. Placed after the last existing import, else before the first node. */
  ensureImport(statement: string): this {
    const source = importSource(statement)
    const imports = this.find('import_statement' as NodeTypeOf<G>).#nodes
    if (imports.some((imp) => importSource(imp.text) === source)) return this
    const eol = this.#session.formatter.eol
    if (imports.length === 0) return this.prependToFile(statement + eol)
    this.#session.collector.insertRight(imports[imports.length - 1].documentEndIndex, eol + statement)
    return this
  }

  /** Insert `text` at the very start of the first selected node (typically the file). */
  prependToFile(text: string): this {
    this.#session.collector.insertLeft(this.#firstNode().documentStartIndex, text)
    return this
  }

  /** Move this node's text to just before `target` (delete here, re-insert there). */
  moveBefore(target: Collection<G>): this {
    return this.#move(target, (dest, text) => this.#session.collector.insertLeft(dest.documentStartIndex, text))
  }

  /** Move this node's text to just after `target`. */
  moveAfter(target: Collection<G>): this {
    return this.#move(target, (dest, text) => this.#session.collector.insertRight(dest.documentEndIndex, text))
  }

  // ---- comments ----

  /** Add a leading comment line above each selected node (pass the full comment, e.g. `// note`). */
  addLeadingComment(text: string): this {
    return this.insertBefore(`${text}\n`)
  }

  /** Add a trailing comment after each selected node, on the same line. */
  addTrailingComment(text: string): this {
    for (const node of this.#nodes) this.#session.collector.insertRight(node.documentEndIndex, ' ' + text)
    return this
  }

  /** Remove each node's comments, keeping the node. Leading comments take the gap up to the node;
   *  trailing/inner comments are removed by their own range (residual whitespace is Prettier's job —
   *  note that a same-line trailing comment often attaches as an `inner` comment). */
  removeComments(): this {
    for (const node of this.#nodes) {
      const lead = node.leadingComments
      if (lead.length) this.#session.collector.remove(lead[0].documentStartIndex, node.documentStartIndex)
      for (const c of [...node.trailingComments, ...node.innerComments]) {
        this.#session.collector.remove(c.documentStartIndex, c.documentEndIndex)
      }
    }
    return this
  }

  /** Rewrite each node's first leading comment with `fn(its text)`; no-op where there is none.
   *  Emptying it (`fn` returns `''`) drops the comment: under `format` its line collapses (no blank
   *  left behind, like `remove`/`dropDirective`), keeping any sibling comments and the node; off, the
   *  verbatim overwrite leaves the residual line for the downstream formatter. */
  mapLeadingComment(fn: (text: string) => string): this {
    for (const node of this.#nodes) {
      const comment = node.leadingComments[0]
      if (!comment) continue
      const next = fn(comment.text)
      if (next === '') {
        this.#session.formatter.removeNode(comment.documentStartIndex, comment.documentEndIndex)
      } else {
        this.#session.collector.overwrite(comment.documentStartIndex, comment.documentEndIndex, next)
      }
    }
    return this
  }

  /** The first leading comment matching `pattern`, as a `RegExpMatchArray` (use a capture group
   *  to extract the expression), or `null`. Read it, then `dropDirective` to strip it. */
  directive(pattern: RegExp): RegExpMatchArray | null {
    for (const comment of this.#single().leadingComments) {
      const match = comment.text.match(pattern)
      if (match) return match
    }
    return null
  }

  /** Remove a matching leading directive comment (and the gap up to this node), keeping the node
   *  itself. Compose with `remove()` to drop both. */
  dropDirective(pattern: RegExp): this {
    const node = this.#single()
    const comment = node.leadingComments.find((c) => pattern.test(c.text))
    if (!comment) return this
    // The contract is "drop the directive and the gap up to the node" — so removal still runs to the
    // node, taking any comments stacked under the directive with it. It collapses those whole lines
    // but stops at the node's line, leaving the node's own line for a following `remove` to collapse
    // independently: the two deletes abut at the node's line start and compose.
    this.#session.formatter.removeLeadingTo(comment.documentStartIndex, node.documentStartIndex)
    return this
  }

  /** Evaluate a string expression (e.g. a directive's captured text) against `context`. Parsed as
   *  TypeScript — available because a namespaced codemod ensures that grammar. */
  evaluateExpression(expression: string, context: unknown): unknown {
    return evaluateNode(expression, context)
  }

  // ---- internals ----

  #text(arg: TextArg<G>, node: RichNode): string {
    return typeof arg === 'function' ? arg(new Collection<G>([node], this.#session)) : arg
  }
  /** Capture this node's text, delete it, and re-insert it at `target` via `place`. */
  #move(target: Collection<G>, place: (dest: RichNode, text: string) => void): this {
    const node = this.#single()
    const dest = target.#single()
    assert(
      node.documentEndIndex <= dest.documentStartIndex || dest.documentEndIndex <= node.documentStartIndex,
      'move source and target overlap',
    )
    const text = node.text
    this.#session.collector.remove(node.documentStartIndex, node.documentEndIndex)
    place(dest, text)
    return this
  }

  #select(nodes: RichNode[]): Collection<G> {
    return new Collection<G>(nodes, this.#session)
  }
  #single(): RichNode {
    assert(this.#nodes.length === 1, `expected a single node, got ${this.#nodes.length}`)
    return this.#nodes[0]
  }
  #firstNode(): RichNode {
    assert(this.#nodes.length > 0, 'collection is empty')
    return this.#nodes.reduce((a, b) => (b.documentStartIndex < a.documentStartIndex ? b : a))
  }
}

/** Stringify a `code\`\`` interpolation: a `Collection` yields its (single-node) text. */
function snippet(value: unknown): string {
  return value instanceof Collection ? value.text : String(value)
}

/** The module specifier of an import statement's source text, for idempotent `ensureImport`. */
function importSource(statementText: string): string | null {
  const match =
    statementText.match(/from\s*['"]([^'"]+)['"]/) ?? statementText.match(/import\s*['"]([^'"]+)['"]/)
  return match ? match[1] : null
}

function matches<G extends GrammarId>(node: RichNode, attrs?: AttrMatchers<G>): boolean {
  if (!attrs) return true
  for (const [key, matcher] of Object.entries(attrs) as [string, AttrMatcher<G> | undefined][]) {
    if (matcher === undefined) continue
    if (typeof matcher === 'function') {
      if (!matcher(node)) return false
    } else if (matcher instanceof RegExp) {
      if (!matcher.test(fieldText(node, key))) return false
    } else if (typeof matcher === 'string') {
      if (fieldText(node, key) !== matcher) return false
    } else {
      const child = node.child(key as FieldName) // nested matchers: descend into the field child
      if (!child || !matches(child, matcher)) return false
    }
  }
  return true
}

// `key` is a field name or the `text` pseudo-key; only the field branch needs the FieldName cast.
function fieldText(node: RichNode, key: string): string {
  return key === 'text' ? node.text : (node.child(key as FieldName)?.text ?? '')
}

/** Match a node by concrete type or by a grammar supertype (e.g. `expression`). */
function isType(node: RichNode, type: string): boolean {
  return node.type === type || Parser.subtypesOf(node.language, type).includes(node.type)
}

/** Nearest ancestor matching `type` (concrete or supertype), for `closest`. */
function ancestorOfType(node: RichNode, type: string): RichNode | null {
  for (let cur = node.parent; cur; cur = cur.parent) if (isType(cur, type)) return cur
  return null
}

/** The named sibling `delta` positions from `node`, or `null` past either end. */
function siblingAt(node: RichNode, delta: number): RichNode | null {
  const siblings = node.parent?.children
  const i = siblings?.indexOf(node) ?? -1
  return i === -1 ? null : (siblings![i + delta] ?? null)
}

// JS/TS scope boundaries — the structural notion behind `closestScope` (no resolver needed).
const SCOPE_NODES = new Set([
  'program',
  'statement_block',
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'generator_function',
  'arrow_function',
  'method_definition',
  'for_statement',
  'for_in_statement',
  'catch_clause',
])
function scopeOf(node: RichNode): RichNode | null {
  for (let cur: RichNode | null = node; cur; cur = cur.parent) if (SCOPE_NODES.has(cur.type)) return cur
  return null
}

const present = <T>(x: T | null): x is T => x !== null

function dedupe(nodes: RichNode[]): RichNode[] {
  return [...new Set(nodes)]
}

/** The tree root a node belongs to (its zone's parsed root), for per-zone resolver caching. */
function rootOf(node: RichNode): RichNode {
  let cur = node
  while (cur.parent) cur = cur.parent
  return cur
}

/**
 * Build a lazy transformer that runs an imperative `codemod(root, context)` against a target
 * (a grammar or a {@link ZoneSplitter}): `init()` loads grammars once; the returned transformer
 * is synchronous. The codemod receives a {@link Collection} over every zone's tree and records
 * edits, which are emitted via magic-string.
 *
 * `namespace` opts into the scan-gate (a source not mentioning it is returned untouched,
 * unparsed) and ensures the TypeScript grammar for `evaluate`'s string form. Formatting is applied
 * on every transform; its style is detected per source and tunable via `transform`'s `FormatOptions`.
 */
export function createCodemodTransformer<
  Ctx extends Record<string, unknown> = Record<string, unknown>,
  G extends GrammarId = GrammarId,
>(
  target: GrammarId | ZoneSplitter,
  codemod: (root: Collection<G>, context: Ctx) => void,
  options?: { namespace?: string },
): LazyTransformer<Ctx> {
  const namespace = options?.namespace
  let pending: Promise<Transformer<Ctx>> | null = null

  async function build(): Promise<Transformer<Ctx>> {
    await Parser.init()
    const grammars = typeof target === 'string' ? [target] : target.grammars
    for (const grammar of grammars) await Parser.loadGrammar(grammar)
    if (typeof target !== 'string') await target.init()
    if (namespace !== undefined) await Parser.loadGrammar('typescript')

    function run(source: string, context: Ctx, options: FormatOptions | undefined): EditCollector {
      const collector = new EditCollector(source)
      if (namespace !== undefined && !source.includes(namespace)) return collector
      const zones: Zone[] = splitAndParse(source, target)
      for (const zone of zones) attachComments(zone.tree)
      // Every edit is rendered layout-aware: the file's indent unit / EOL are detected once (and
      // overridable per apply via `options`).
      const formatter = new Formatter(collector, source, resolveStyle(source, options))
      // One resolver per zone tree, built on first use (only if the codemod asks for scope).
      const resolvers = new Map<RichNode, Resolver | null>()
      const session: Session = {
        collector,
        formatter,
        resolver(node) {
          const treeRoot = rootOf(node)
          if (!resolvers.has(treeRoot)) resolvers.set(treeRoot, createResolver(treeRoot))
          return resolvers.get(treeRoot) ?? null
        },
      }
      codemod(new Collection<G>(zones.map((zone) => zone.tree), session), context)
      return collector
    }

    return {
      transform: (source, context, options) => run(source, context, options).toString(),
      transformWithMap(source, context, options) {
        const collector = run(source, context, options)
        return { code: collector.toString(), map: collector.generateMap(options?.source ?? 'input') }
      },
    }
  }

  return {
    target,
    init() {
      pending ??= build()
      return pending
    },
  }
}
