import MagicString from 'magic-string'
import type { SourceMap } from './types.js'

/**
 * A pure edit buffer: collects text edits against a source string and produces the transformed code
 * (and, on demand, a source map) via magic-string. It knows nothing about lines, indentation, or
 * formatting — that policy lives in the {@link Formatter}, which drives this buffer.
 *
 * Overlap is resolved **first-wins**: an edit overlapping one already accepted is dropped silently —
 * the text-layer side of outer-wins. Because edits are applied through magic-string at their original
 * offsets, the kept text keeps its original position, so the generated map is precise.
 */
export class EditCollector {
  readonly #magic: MagicString
  readonly #claimed: Array<[number, number]> = []

  constructor(source: string) {
    this.#magic = new MagicString(source)
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

  /** Insert `text` at `index`, attached to the left chunk. A point insertion: it claims no
   *  range, so it composes with edits on either side (and survives removal of the right side). */
  insertLeft(index: number, text: string): void {
    this.#magic.appendLeft(index, text)
  }

  /** Insert `text` at `index`, attached to the right chunk. */
  insertRight(index: number, text: string): void {
    this.#magic.appendRight(index, text)
  }

  toString(): string {
    return this.#magic.toString()
  }

  generateMap(source: string): SourceMap {
    return this.#magic.generateMap({ source, includeContent: true, hires: true })
  }

  // Half-open intervals [start, end): reject one overlapping an accepted edit (touching
  // boundaries don't overlap), so magic-string never sees a conflicting operation.
  #claim(start: number, end: number): boolean {
    if (this.#claimed.some(([s, e]) => s < end && start < e)) return false
    this.#claimed.push([start, end])
    return true
  }
}
