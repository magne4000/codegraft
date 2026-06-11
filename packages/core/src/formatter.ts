import type { RichNode } from './types.js'
import type { EditCollector } from './edit-collector.js'
import { type FormatStyle, reindent, indentOf } from './format.js'
import { openDelimiter, NEWLINE_CONTAINERS, SEMI_CONTAINERS } from './containers.js'

/**
 * How an edit is *rendered* once the codemod has decided *what* to edit. Built per-apply from the
 * source plus a resolved {@link FormatStyle}; the {@link Collection} delegates rendering to it while
 * the {@link EditCollector} it drives stays a pure edit buffer.
 *
 * Scope is deliberately narrow — just enough that edits are **syntactically valid**: re-indent an
 * inserted snippet to its anchor line, and give an appended/prepended element the separator its
 * container needs (`,` / `;` / a line break). Cosmetics — exact indent, blank lines, brace padding,
 * inline-vs-multiline reflow — are left to a downstream formatter, which sees the output anyway.
 */
export class Formatter {
  readonly #collector: EditCollector
  readonly #source: string
  readonly #style: FormatStyle

  constructor(collector: EditCollector, source: string, style: FormatStyle) {
    this.#collector = collector
    this.#source = source
    this.#style = style
  }

  /** The line ending — for inserting whole statements (`ensureImport`). */
  get eol(): string {
    return this.#style.eol
  }

  /** The leading whitespace of the line containing `index` — for restoring a displaced node's indent. */
  indentAt(index: number): string {
    return indentOf(this.#source, index)
  }

  /** `text` re-indented to the line at `index` (single-line text is unchanged) — for a replaced or
   *  inserted snippet. */
  reindent(text: string, index: number): string {
    return reindent(text, indentOf(this.#source, index), this.#style.eol)
  }

  /** Append `text` as the last element of `node` with a valid separator: a line break in a
   *  block/class body, a `,`/`;` after the last element of a delimited list, or as the sole element
   *  of an empty container. */
  append(node: RichNode, text: string): void {
    const elements = node.children
    if (NEWLINE_CONTAINERS.has(node.type)) {
      const at = elements.length ? elements[elements.length - 1] : openDelimiter(node)
      this.#collector.insertRight(at.documentEndIndex, this.#style.eol + text)
    } else if (elements.length === 0) {
      this.#collector.insertRight(openDelimiter(node).documentEndIndex, text)
    } else {
      this.#collector.insertRight(elements[elements.length - 1].documentEndIndex, this.#separator(node) + text)
    }
  }

  /** Prepend `text` as the first element of `node` — the mirror of {@link append}. */
  prepend(node: RichNode, text: string): void {
    const elements = node.children
    if (NEWLINE_CONTAINERS.has(node.type) || elements.length === 0) {
      this.#collector.insertRight(openDelimiter(node).documentEndIndex, NEWLINE_CONTAINERS.has(node.type) ? this.#style.eol + text : text)
    } else {
      this.#collector.insertLeft(elements[0].documentStartIndex, text + this.#separator(node))
    }
  }

  /** The separator placed between a delimited container's elements — `; ` for a TS interface /
   *  object type, else `, `. */
  #separator(node: RichNode): string {
    return SEMI_CONTAINERS.has(node.type) ? '; ' : ', '
  }
}
