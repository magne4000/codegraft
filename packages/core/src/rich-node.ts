import type { Node } from 'web-tree-sitter'
import type { GrammarId, Point, RichNode } from './types.js'
import type { NodeTypeAll, FieldName } from './generated/node-types.js'
import { COMMENT_TYPES } from './comment-attachment.js'
import { assert } from './assert.js'

/**
 * Lazy wrapper over a web-tree-sitter `Node`. Scalar accessors (type/text/positions)
 * read straight through to the backing node; `allChildren` and `children` are built
 * once and cached, so there is exactly one `RichNodeImpl` per backing node within a
 * subtree — which is what lets the comment-attachment pass write onto the same
 * instances that pattern matching and rewrites later see.
 *
 * The class is internal; callers receive the `RichNode` interface via `wrapNode`.
 */
class RichNodeImpl implements RichNode {
  readonly language: GrammarId
  // Filled in by the comment-attachment pass; the arrays are mutable, the bindings are not.
  readonly leadingComments: RichNode[] = []
  readonly trailingComments: RichNode[] = []
  readonly innerComments: RichNode[] = []

  readonly #node: Node
  readonly #startOffset: number
  readonly #parent: RichNode | null
  #allChildren?: RichNodeImpl[]
  #children?: RichNodeImpl[]

  constructor(node: Node, language: GrammarId, startOffset: number, parent: RichNode | null) {
    this.#node = node
    this.language = language
    this.#startOffset = startOffset
    this.#parent = parent
  }

  get type(): NodeTypeAll {
    // The grammar guarantees the raw string is one of its node types; assert it into the union.
    return this.#node.type as NodeTypeAll
  }
  get isNamed(): boolean {
    return this.#node.isNamed
  }
  get text(): string {
    return this.#node.text
  }
  get startIndex(): number {
    return this.#node.startIndex
  }
  get endIndex(): number {
    return this.#node.endIndex
  }
  get startPosition(): Point {
    return this.#node.startPosition
  }
  get endPosition(): Point {
    return this.#node.endPosition
  }
  get parent(): RichNode | null {
    return this.#parent
  }
  get documentStartIndex(): number {
    return this.#node.startIndex + this.#startOffset
  }
  get documentEndIndex(): number {
    return this.#node.endIndex + this.#startOffset
  }

  /** Full CST: every child, including anonymous punctuation and comments. */
  get allChildren(): RichNode[] {
    return this.#computeAllChildren()
  }

  /** Named structural children with comments removed — the surface pattern matching
   *  walks, so neither punctuation nor comments can perturb a match. */
  get children(): RichNode[] {
    const comments = COMMENT_TYPES[this.language]
    this.#children ??= this.#computeAllChildren().filter((n) => n.isNamed && !comments.has(n.type))
    return this.#children
  }

  child(field: FieldName): RichNode | null {
    const target = this.#node.childForFieldName(field)
    return target === null ? null : this.#wrapperFor(target, field)
  }

  childrenForField(field: FieldName): RichNode[] {
    return this.#node
      .childrenForFieldName(field)
      .filter((n): n is Node => n !== null)
      .map((target) => this.#wrapperFor(target, field))
  }

  #computeAllChildren(): RichNodeImpl[] {
    this.#allChildren ??= this.#node.children
      .filter((c): c is Node => c !== null)
      .map((c) => new RichNodeImpl(c, this.language, this.#startOffset, this))
    return this.#allChildren
  }

  /** Map a backing field-child back to its cached wrapper, so identity (and any
   *  attached comments) is shared rather than re-wrapped. */
  #wrapperFor(target: Node, field: string): RichNode {
    const wrapped = this.#computeAllChildren().find((c) => c.#node.equals(target))
    assert(wrapped, `field '${field}' resolved to a node absent from allChildren`)
    return wrapped
  }
}

/** Wrap a parsed tree's root. Children are created lazily as the tree is walked. */
export function wrapNode(node: Node, language: GrammarId, startOffset: number): RichNode {
  return new RichNodeImpl(node, language, startOffset, null)
}
