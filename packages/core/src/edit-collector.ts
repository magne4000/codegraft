import MagicString from 'magic-string'
import type { SourceMap } from './types.js'

/**
 * Collects edits against a source string and produces the transformed code (and, on
 * demand, a source map) via magic-string.
 *
 * Overlap is resolved **first-wins**: an edit overlapping one already accepted is
 * dropped silently — the text-layer side of outer-wins. Because edits are applied
 * through magic-string at their original offsets, the kept text keeps its original
 * position, so the generated map is precise.
 */
export class EditCollector {
  readonly #magic: MagicString
  readonly #source: string
  readonly #claimed: Array<[number, number]> = []

  constructor(source: string) {
    this.#magic = new MagicString(source)
    this.#source = source
  }

  /** Replace `[start, end)` with `replacement` (an empty range inserts before `start`). */
  overwrite(start: number, end: number, replacement: string): void {
    if (!this.#claim(start, end)) return
    if (start === end) this.#magic.appendLeft(start, replacement)
    else this.#magic.update(start, end, replacement)
  }

  /** Delete `[start, end)`. */
  remove(start: number, end: number): void {
    if (start === end || !this.#claim(start, end)) return
    this.#magic.remove(start, end)
  }

  /** Format-aware delete of `[start, end)`: when the span owns its line(s) — only indentation
   *  before `start`, only whitespace after `end` up to the line break — drop the whole lines so no
   *  blank line is left behind; otherwise an in-line delete that also clears one residual separating
   *  space, so a removed mid-list element (`[1, two(), 3]`) leaves `[1, 3]`, not `[1,  3]`. Used under
   *  `format` so removing an own-line node collapses its line the way Prettier would.
   *
   *  In the own-line case the content, the leading indent, and the trailing line break are claimed
   *  separately so the removal composes after an abutting edit: a prior `unwrap`/`dropDirective` that
   *  already consumed the run up to `start` leaves the content abutting it (no overlap, so it lands),
   *  while the leading-indent claim it overlaps is dropped on its own (first-wins) instead of taking
   *  the whole line removal down with it. */
  removeFormatted(start: number, end: number): void {
    const lineStart = this.#lineStart(start)
    const newline = this.#source.indexOf('\n', end)
    const lineEnd = newline === -1 ? this.#source.length : newline
    const ownsLines = this.#source.slice(lineStart, start).trim() === '' && this.#source.slice(end, lineEnd).trim() === ''
    if (!ownsLines) {
      // Inline hole: drop one separating space when both sides are spaced (a mid-list element), so no
      // double space is left. Never at a list edge (one side non-space) or across a line break.
      const trim = isHSpace(this.#source[end]) && isHSpace(this.#source[start - 1]) ? 1 : 0
      this.remove(start, end + trim)
      return
    }
    this.remove(start, end) // the content — abuts any prior edit at `start`, so it always lands
    this.remove(lineStart, start) // leading indent — may be already gone under a prior edit
    this.remove(end, newline === -1 ? this.#source.length : newline + 1) // trailing line break
  }

  /** Delete `[start, end)` where `end` begins a following node, collapsing the lines before it:
   *  when `start` opens its own line and `end` sits on a later line, drop `[start's line, end's
   *  line)` so the leading run (a directive comment and any comments stacked under it) vanishes
   *  whole-line while `end`'s own line — its indentation included — is left for a later edit to
   *  collapse independently. Otherwise (an inline `start`, or `end` on the same line) a verbatim
   *  `[start, end)` delete. Used by `dropDirective` so it composes with a following `remove`. */
  removeUpToLine(start: number, end: number): void {
    const startLine = this.#lineStart(start)
    const endLine = this.#lineStart(end)
    if (endLine > startLine && this.#source.slice(startLine, start).trim() === '') this.remove(startLine, endLine)
    else this.remove(start, end)
  }

  /** Delete the whole lines `[start, end)` touches — from the start of `start`'s line (leading
   *  indentation included) through the newline after `end`'s line, so nothing blank is left behind.
   *  With `collapseBlankBefore`, also absorb whole blank lines immediately above (a separator before
   *  a dropped block). */
  removeLines(start: number, end: number, collapseBlankBefore = false): void {
    let lineStart = this.#lineStart(start)
    if (collapseBlankBefore) {
      while (lineStart > 0) {
        const prevStart = this.#lineStart(lineStart - 1)
        if (this.#source.slice(prevStart, lineStart - 1).trim() !== '') break // a non-blank line stops it
        lineStart = prevStart
      }
    }
    const newline = this.#source.indexOf('\n', end)
    this.remove(lineStart, newline === -1 ? this.#source.length : newline + 1)
  }

  /** Insert `text` at `index`, attached to the left chunk. A point insertion: it claims no
   *  range, so it composes with edits on either side (and survives removal of the right side). */
  insertLeft(index: number, text: string): void {
    this.#magic.appendLeft(index, text)
  }

  /** Insert `text` at `index`, attached to the right chunk. */
  insertRight(index: number, text: string): void {
    this.#magic.appendRight(index, text)
  }

  /** The leading whitespace of the line containing `index` — the base indent an inserted block
   *  should match. Empty when the line starts with a non-whitespace character. */
  indentAt(index: number): string {
    return /^[ \t]*/.exec(this.#source.slice(this.#lineStart(index), index))![0]
  }

  toString(): string {
    return this.#magic.toString()
  }

  generateMap(source: string): SourceMap {
    return this.#magic.generateMap({ source, includeContent: true, hires: true })
  }

  // Offset of the first character of the line containing `index`.
  #lineStart(index: number): number {
    return this.#source.lastIndexOf('\n', index - 1) + 1
  }

  // Half-open intervals [start, end): reject one overlapping an accepted edit (touching
  // boundaries don't overlap), so magic-string never sees a conflicting operation.
  #claim(start: number, end: number): boolean {
    if (this.#claimed.some(([s, e]) => s < end && start < e)) return false
    this.#claimed.push([start, end])
    return true
  }
}

/** A space or tab — the horizontal whitespace separating inline list elements (`undefined` past
 *  either end of the source is not whitespace). */
function isHSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\t'
}
