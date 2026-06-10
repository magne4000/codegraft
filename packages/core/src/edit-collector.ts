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
