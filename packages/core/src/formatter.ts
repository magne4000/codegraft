import type { RichNode } from './types.js'
import type { EditCollector } from './edit-collector.js'
import { type FormatStyle, reindent, indentOf, isHSpace, lineStartOf } from './format.js'
import { openDelimiter, trailingSeparator, isMultiline, SEMI_CONTAINERS } from './containers.js'

/**
 * The layout-formatting policy: how an edit is *rendered* once the codemod has decided *what* to
 * edit. Built per-apply from the source plus a detected {@link FormatStyle} when `format` is enabled
 * (absent — `null` on the session — for verbatim runs). The {@link Collection} delegates the format
 * arm of each edit to it; the {@link EditCollector} it drives stays a pure edit buffer.
 *
 * This is the single home for indentation/EOL re-rendering, container layout (separators, trailing
 * commas, brace padding), and line-collapse on removal — and the place prettier-like options
 * (trailing-comma/semicolon/quote/print-width) would grow.
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

  /** The detected line ending — for inserting whole statements (`ensureImport`). */
  get eol(): string {
    return this.#style.eol
  }

  /** The leading whitespace of the line containing `index`. */
  indentAt(index: number): string {
    return indentOf(this.#source, index)
  }

  // —— insertion: render the text to insert ——

  /** `text` re-indented to the line at `index` (single-line text is unchanged). */
  reindent(text: string, index: number): string {
    return reindent(text, indentOf(this.#source, index), this.#style.eol)
  }

  /** `text` as a fresh line at the indentation of the sibling at `index`. */
  line(text: string, index: number): string {
    const indent = indentOf(this.#source, index)
    return this.#style.eol + indent + reindent(text, indent, this.#style.eol)
  }

  // —— insertion: emit the edit for a structural insertion ——

  /** Open an empty `{}` block onto its own indented line — `{}` → `{⏎  text⏎}`. */
  fillBlock(node: RichNode, text: string): void {
    const blockIndent = indentOf(this.#source, node.documentStartIndex)
    const indent = blockIndent + this.#style.indentUnit
    const eol = this.#style.eol
    this.#collector.insertRight(openDelimiter(node).documentEndIndex, eol + indent + reindent(text, indent, eol) + eol + blockIndent)
  }

  /** Fill an empty delimited container with its sole element: a brace container is padded
   *  (`{}` → `{ text }`); an array / argument list is not (`[]` → `[text]`). */
  fillContainer(node: RichNode, text: string): void {
    const open = openDelimiter(node)
    const pad = open.text === '{' ? ' ' : ''
    this.#collector.insertRight(open.documentEndIndex, pad + text + pad)
  }

  /** Append `text` after the last element `last` of a delimited container — comma-separated
   *  (array/object/arguments) or `;`-separated (interface/object-type body). A multi-line container
   *  places the element on a fresh line at the elements' indent, mirroring the trailing-separator
   *  style — extend an existing trailing `sep`, add the mandatory `,` a comma list omits, or rely on
   *  the newline alone for a `;` list (where the separator between members is optional); an inline one
   *  stays on one line. */
  appendElement(node: RichNode, last: RichNode, text: string): void {
    const sep = this.#separatorFor(node)
    if (!isMultiline(node)) {
      this.#collector.insertRight(last.documentEndIndex, `${sep} ${text}`)
      return
    }
    const trailing = trailingSeparator(last, sep)
    const line = this.line(text, last.documentStartIndex)
    if (trailing) this.#collector.insertRight(trailing.documentEndIndex, line + sep)
    else if (sep === ';') this.#collector.insertRight(last.documentEndIndex, line)
    else this.#collector.insertRight(last.documentEndIndex, sep + line)
  }

  /** Prepend `text` before the first element `first` — the mirror of {@link appendElement}. The new
   *  element is always followed by the old first, so a multi-line container puts it on a fresh line
   *  after the open delimiter, separator-terminated (`;` only where the body terminates members with
   *  one); an inline one inserts before the first element so brace padding stays intact
   *  (`{ a }` → `{ x, a }`). */
  prependElement(node: RichNode, first: RichNode, text: string): void {
    const sep = this.#separatorFor(node)
    if (!isMultiline(node)) {
      this.#collector.insertLeft(first.documentStartIndex, `${text}${sep} `)
      return
    }
    const terminate = sep === ',' || trailingSeparator(first, sep) !== null
    this.#collector.insertRight(openDelimiter(node).documentEndIndex, this.line(text, first.documentStartIndex) + (terminate ? sep : ''))
  }

  /** The token that separates a container's elements — `;` for a TS interface / object type, else
   *  `,`. The seam a future `semi`/separator option would hook into. */
  #separatorFor(node: RichNode): string {
    return SEMI_CONTAINERS.has(node.type) ? ';' : ','
  }

  // —— removal: emit the collapse edits ——

  /** Delete `[start, end)`, collapsing whitespace the way Prettier would: when the span owns its
   *  line(s) — only indentation before `start`, only whitespace after `end` up to the line break —
   *  drop the whole lines so no blank line is left; otherwise an in-line delete that also clears one
   *  residual separating space, so a removed mid-list element (`[1, two(), 3]`) leaves `[1, 3]`, not
   *  `[1,  3]`.
   *
   *  In the own-line case the content, the leading indent, and the trailing line break are removed
   *  separately so the deletion composes after an abutting edit: a prior `unwrap`/`dropDirective` that
   *  already consumed the run up to `start` leaves the content abutting it (no overlap, so it lands),
   *  while the leading-indent removal it overlaps is dropped on its own (first-wins) instead of taking
   *  the whole line removal down with it. */
  removeNode(start: number, end: number): void {
    const lineStart = lineStartOf(this.#source, start)
    const newline = this.#source.indexOf('\n', end)
    const lineEnd = newline === -1 ? this.#source.length : newline
    const ownsLines = this.#source.slice(lineStart, start).trim() === '' && this.#source.slice(end, lineEnd).trim() === ''
    if (!ownsLines) {
      // Inline hole: drop one separating space when both sides are spaced (a mid-list element), so no
      // double space is left. Never at a list edge (one side non-space) or across a line break.
      const trim = isHSpace(this.#source[end]) && isHSpace(this.#source[start - 1]) ? 1 : 0
      this.#collector.remove(start, end + trim)
      return
    }
    this.#collector.remove(start, end) // the content — abuts any prior edit at `start`, so it lands
    this.#collector.remove(lineStart, start) // leading indent — may be already gone under a prior edit
    this.#collector.remove(end, newline === -1 ? this.#source.length : newline + 1) // trailing line break
  }

  /** Delete `[start, end)` where `end` begins a following node, collapsing the lines before it: when
   *  `start` opens its own line and `end` sits on a later line, drop `[start's line, end's line)` so
   *  the leading run (a directive comment and any comments stacked under it) vanishes whole-line while
   *  `end`'s own line — its indentation included — is left for a later edit to collapse independently.
   *  Otherwise (an inline `start`, or `end` on the same line) a plain `[start, end)` delete. Used by
   *  `dropDirective` so it composes with a following `remove`. */
  removeLeadingTo(start: number, end: number): void {
    const startLine = lineStartOf(this.#source, start)
    const endLine = lineStartOf(this.#source, end)
    if (endLine > startLine && this.#source.slice(startLine, start).trim() === '') this.#collector.remove(startLine, endLine)
    else this.#collector.remove(start, end)
  }
}
