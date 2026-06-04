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
import { assert } from './assert.js'

/** Shared per-transform state a {@link Collection} records edits into. */
interface Session {
  collector: EditCollector
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

  // ---- internals ----

  #select(nodes: RichNode[]): Collection {
    return new Collection(nodes, this.#session)
  }
  #single(): RichNode {
    assert(this.#nodes.length === 1, `expected a single node, got ${this.#nodes.length}`)
    return this.#nodes[0]
  }
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

/**
 * Build a lazy transformer that runs an imperative `codemod(root, context)` against a target
 * (a grammar or a {@link ZoneSplitter}). Mirrors `createTransformer`: `init()` loads grammars
 * once; the returned transformer is synchronous. The codemod receives a {@link Collection} over
 * every zone's tree and records edits, which are emitted via magic-string.
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
      const root = new Collection(
        zones.map((zone) => zone.tree),
        { collector },
      )
      codemod(root, context)
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
