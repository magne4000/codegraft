import type {
  GrammarId,
  LazyTransformer,
  RichNode,
  Transformer,
  Zone,
  ZoneSplitter,
} from './types.js'
import { Parser } from './parser.js'
import { splitAndParse } from './zone-splitter.js'
import { attachComments } from './comment-attachment.js'
import { EditCollector } from './edit-collector.js'
import { evaluate as evaluateNode } from './evaluate.js'
import { createResolver, type Resolver } from './resolver.js'
import { assert } from './assert.js'

/** Shared per-transform state a {@link Collection} records edits into. */
interface Session {
  collector: EditCollector
  /** The binding resolver for `node`'s zone (JS/TS/TSX), or `null` if unsupported. */
  resolver(node: RichNode): Resolver | null
}

/** A field predicate in `find(type, attrs)`: equals a field's text (`string`), matches it
 *  (`RegExp`), or an escape-hatch predicate over the whole node (`function`). The pseudo-key
 *  `text` matches the node's own text rather than a field. */
type AttrMatcher = string | RegExp | ((node: RichNode) => boolean)

/**
 * A jscodeshift-style selection of CST nodes bound to one transform run. Query methods
 * (`find`/`filter`/`closest`/`parent`/`children`/`first`/`at`) return new Collections; edit
 * methods (`replaceWith`/`remove`/…) record magic-string edits and return `this`. Single-node
 * accessors (`node`/`text`/`type`/`field`/`evaluate`) assert the collection holds exactly one
 * node — the shape you get inside `forEach`, after `first()`/`at()`, or from `field()`.
 *
 * Everything hangs off this object (and the run context), so a codemod's `.toString()` is
 * self-contained and serialises for `trast build` (§5 of the plan).
 */
export class Collection {
  readonly #nodes: RichNode[]
  readonly #session: Session

  constructor(nodes: RichNode[], session: Session) {
    this.#nodes = nodes
    this.#session = session
  }

  // ---- query ----

  /** Descendants (not self) of node type `type`, optionally filtered by field predicates. */
  find(type: string, attrs?: Record<string, AttrMatcher>): Collection {
    const out: RichNode[] = []
    const seen = new Set<RichNode>()
    const walk = (node: RichNode): void => {
      for (const child of node.children) {
        if (child.type === type && !seen.has(child) && matches(child, attrs)) {
          seen.add(child)
          out.push(child)
        }
        walk(child)
      }
    }
    for (const node of this.#nodes) walk(node)
    return this.#select(out)
  }

  filter(predicate: (node: Collection) => boolean): Collection {
    return this.#select(this.#nodes.filter((n) => predicate(new Collection([n], this.#session))))
  }

  /** Nearest ancestor (not self) of node type `type`, per selected node. */
  closest(type: string): Collection {
    return this.#select(dedupe(this.#nodes.map((n) => ancestorOfType(n, type)).filter(present)))
  }

  parent(): Collection {
    return this.#select(dedupe(this.#nodes.map((n) => n.parent).filter(present)))
  }

  children(): Collection {
    return this.#select(this.#nodes.flatMap((n) => n.children))
  }

  first(): Collection {
    return this.#select(this.#nodes.slice(0, 1))
  }

  at(index: number): Collection {
    const node = this.#nodes.at(index)
    return this.#select(node ? [node] : [])
  }

  size(): number {
    return this.#nodes.length
  }

  forEach(fn: (node: Collection) => void): this {
    for (const node of this.#nodes) fn(new Collection([node], this.#session))
    return this
  }

  map<T>(fn: (node: Collection) => T): T[] {
    return this.#nodes.map((node) => fn(new Collection([node], this.#session)))
  }

  nodes(): RichNode[] {
    return [...this.#nodes]
  }

  // ---- single-node accessors (assert exactly one) ----

  get node(): RichNode {
    return this.#single()
  }
  get text(): string {
    return this.#single().text
  }
  get type(): string {
    return this.#single().type
  }
  /** The field child as a (0-or-1) Collection, e.g. `node.field('condition')`. */
  field(name: string): Collection {
    const child = this.#single().child(name)
    return this.#select(child ? [child] : [])
  }
  /** Evaluate this node as a build-time expression against `context` (see core `evaluate`). */
  evaluate(context: unknown): unknown {
    return evaluateNode(this.#single(), context)
  }

  // ---- scope (JS/TS/TSX; confident-or-abstain) ----

  /** Every occurrence (declaration + references) of the binding this node declares, or `null`
   *  when not confidently resolvable — the safe signal to skip a rename. */
  references(): Collection | null {
    const node = this.#single()
    const refs = this.#session.resolver(node)?.references(node)
    return refs ? this.#select(refs) : null
  }

  /** The declaration this reference resolves to, or `null` for a global / when uncertain. */
  definition(): Collection | null {
    const node = this.#single()
    const def = this.#session.resolver(node)?.definition(node)
    return def ? this.#select([def]) : null
  }

  // ---- edits ----

  replaceWith(text: string): this {
    for (const node of this.#nodes) {
      this.#session.collector.overwrite(node.documentStartIndex, node.documentEndIndex, text)
    }
    return this
  }

  remove(): this {
    for (const node of this.#nodes) {
      this.#session.collector.remove(node.documentStartIndex, node.documentEndIndex)
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
  unwrap(keep: Collection): this {
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

  /** Insert `text` immediately before each selected node. */
  insertBefore(text: string): this {
    for (const node of this.#nodes) this.#session.collector.insertLeft(node.documentStartIndex, text)
    return this
  }

  /** Insert `text` immediately after each selected node. */
  insertAfter(text: string): this {
    for (const node of this.#nodes) this.#session.collector.insertRight(node.documentEndIndex, text)
    return this
  }

  /** Append `text` as the last element of each container node (array/object/argument list/block):
   *  after the last element with the right separator, or just inside an empty container. */
  append(text: string): this {
    for (const node of this.#nodes) {
      const elements = node.children
      if (elements.length === 0) this.#session.collector.insertRight(openDelimiter(node).documentEndIndex, text)
      else this.#session.collector.insertRight(elements[elements.length - 1].documentEndIndex, separatorFor(node) + text)
    }
    return this
  }

  /** Prepend `text` as the first element of each container node. */
  prepend(text: string): this {
    for (const node of this.#nodes) {
      const open = openDelimiter(node).documentEndIndex
      const elements = node.children
      this.#session.collector.insertRight(open, elements.length === 0 ? text : text + separatorFor(node))
    }
    return this
  }

  /** Insert a top-level import once: a no-op if a statement importing the same module already
   *  exists. Placed after the last existing import, else before the first node. */
  ensureImport(statement: string): this {
    const source = importSource(statement)
    const imports = this.find('import_statement').#nodes
    if (imports.some((imp) => importSource(imp.text) === source)) return this
    if (imports.length > 0) {
      this.#session.collector.insertRight(imports[imports.length - 1].documentEndIndex, '\n' + statement)
    } else {
      this.#session.collector.insertLeft(this.#firstNode().documentStartIndex, statement + '\n')
    }
    return this
  }

  /** Insert `text` at the very start of the first selected node (typically the file). */
  prependToFile(text: string): this {
    this.#session.collector.insertLeft(this.#firstNode().documentStartIndex, text)
    return this
  }

  // ---- comment directives ----

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
    if (comment) this.#session.collector.remove(comment.documentStartIndex, node.documentStartIndex)
    return this
  }

  /** Evaluate a string expression (e.g. a directive's captured text) against `context`. Parsed as
   *  TypeScript — available because a namespaced codemod ensures that grammar. */
  evaluateExpression(expression: string, context: unknown): unknown {
    return evaluateNode(expression, context)
  }

  // ---- internals ----

  #select(nodes: RichNode[]): Collection {
    return new Collection(nodes, this.#session)
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

/** The opening delimiter token (`[` / `{` / `(`) of a container node. */
function openDelimiter(node: RichNode): RichNode {
  const open = node.allChildren[0]
  assert(open, `container '${node.type}' has no opening delimiter`)
  return open
}

const NEWLINE_CONTAINERS = new Set(['statement_block', 'class_body', 'program'])
/** Separator between a container's elements: newline for statement lists, comma otherwise. */
function separatorFor(node: RichNode): string {
  return NEWLINE_CONTAINERS.has(node.type) ? '\n' : ', '
}

/** The module specifier of an import statement's source text, for idempotent `ensureImport`. */
function importSource(statementText: string): string | null {
  const match =
    statementText.match(/from\s*['"]([^'"]+)['"]/) ?? statementText.match(/import\s*['"]([^'"]+)['"]/)
  return match ? match[1] : null
}

function matches(node: RichNode, attrs?: Record<string, AttrMatcher>): boolean {
  if (!attrs) return true
  for (const [key, matcher] of Object.entries(attrs)) {
    if (typeof matcher === 'function') {
      if (!matcher(node)) return false
      continue
    }
    const text = key === 'text' ? node.text : (node.child(key)?.text ?? '')
    if (matcher instanceof RegExp ? !matcher.test(text) : text !== matcher) return false
  }
  return true
}

function ancestorOfType(node: RichNode, type: string): RichNode | null {
  for (let cur = node.parent; cur; cur = cur.parent) if (cur.type === type) return cur
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
 * unparsed) and ensures the TypeScript grammar for `evaluate`'s string form.
 */
export function createCodemodTransformer<Ctx extends Record<string, unknown> = Record<string, unknown>>(
  target: GrammarId | ZoneSplitter,
  codemod: (root: Collection, context: Ctx) => void,
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

    function run(source: string, context: Ctx): EditCollector {
      const collector = new EditCollector(source)
      if (namespace !== undefined && !source.includes(namespace)) return collector
      const zones: Zone[] = splitAndParse(source, target)
      for (const zone of zones) attachComments(zone.tree)
      // One resolver per zone tree, built on first use (only if the codemod asks for scope).
      const resolvers = new Map<RichNode, Resolver | null>()
      const session: Session = {
        collector,
        resolver(node) {
          const treeRoot = rootOf(node)
          if (!resolvers.has(treeRoot)) resolvers.set(treeRoot, createResolver(treeRoot))
          return resolvers.get(treeRoot) ?? null
        },
      }
      codemod(new Collection(zones.map((zone) => zone.tree), session), context)
      return collector
    }

    return {
      transform: (source, context) => run(source, context).toString(),
      transformWithMap(source, context, options) {
        const collector = run(source, context)
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
