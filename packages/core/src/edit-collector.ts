import type { Edit } from './types.js'

/**
 * Collects document-space edits and applies them to a source string.
 *
 * Overlap is resolved **first-wins**: an edit overlapping one already accepted is
 * dropped silently. This is what makes "outer-wins" hold at the text layer — the
 * outer match's edit lands first and a nested match's edit over the same span is
 * discarded. `apply` runs edits in reverse offset order so each splice leaves the
 * offsets of not-yet-applied (earlier) edits untouched.
 */
export class EditCollector {
  readonly #edits: Edit[] = []

  add(edit: Edit): void {
    // Half-open intervals [start, end): they overlap iff each starts before the
    // other ends. Touching at a boundary (e.end === edit.start) is not an overlap.
    for (const e of this.#edits) {
      if (e.start < edit.end && edit.start < e.end) return
    }
    const at = this.#edits.findIndex((e) => e.start > edit.start)
    if (at === -1) this.#edits.push(edit)
    else this.#edits.splice(at, 0, edit)
  }

  apply(source: string): string {
    return this.applyToSpan(source, 0, source.length)
  }

  /**
   * Apply the edits to just the `[start, end)` slice of `source` and return the
   * transformed slice. Every edit must fall within that range — the recursive
   * transform of a kept subtree relies on this to re-emit only that subtree, with
   * its own nested edits baked in.
   */
  applyToSpan(source: string, start: number, end: number): string {
    let text = source.slice(start, end)
    for (const edit of [...this.#edits].reverse()) {
      text = text.slice(0, edit.start - start) + edit.replacement + text.slice(edit.end - start)
    }
    return text
  }
}
