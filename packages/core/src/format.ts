// Re-indenting inserted code. Codegraft edits byte ranges, so code it doesn't touch keeps its
// formatting for free; this re-anchors an *inserted* snippet to the file's indent and line ending
// instead of landing at column 0. Cosmetic clean-up beyond that is left to a downstream formatter.

/** A source file's resolved formatting. Only the line ending matters now — indentation of an insert
 *  is taken from its anchor line, not a detected unit. */
export interface FormatStyle {
  eol: string
}

/** Per-apply formatting configuration (`transform(src, ctx, options)`): override the detected EOL. */
export interface FormatOptions {
  /** Force the line ending (`'\n'` / `'\r\n'`) instead of guessing it. */
  eol?: string
}

/** Guess the EOL (first line break) of `source`, defaulting to `'\n'`. */
export function detectStyle(source: string): FormatStyle {
  return { eol: /\r\n|\n/.exec(source)?.[0] ?? '\n' }
}

/** The {@link FormatStyle} for an apply: detected from `source`, with any explicit `options` winning. */
export function resolveStyle(source: string, options?: FormatOptions): FormatStyle {
  return { eol: options?.eol ?? detectStyle(source).eol }
}

/** Re-indent a snippet for a line indented by `baseIndent`: the first line is left for the caller
 *  to position, every following non-blank line is re-anchored to `baseIndent` (its indentation
 *  relative to the block's own base preserved), and line breaks become `eol`.
 *
 *  The block's base is the least-indented continuation line — *not* the first line, which a node's
 *  `.text` leaves at column 0 even when the node sits deep in the source. Stripping that base before
 *  applying `baseIndent` re-anchors a "hanging" block (continuation lines still at their source
 *  indent) to the target, instead of stacking `baseIndent` on top of the indent already there. */
export function reindent(text: string, baseIndent: string, eol: string): string {
  if (!text.includes('\n')) return text
  const lines = text.split(/\r\n|\n/)
  let base = Infinity
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    base = Math.min(base, /^[ \t]*/.exec(lines[i])![0].length)
  }
  if (base === Infinity) base = 0 // a single-or-blank-continuation snippet: nothing to strip
  return lines.map((line, i) => (i === 0 || line.trim() === '' ? line : baseIndent + line.slice(base))).join(eol)
}

/** Offset of the first character of the line containing `index`. */
export function lineStartOf(source: string, index: number): number {
  return source.lastIndexOf('\n', index - 1) + 1
}

/** The leading whitespace of the line containing `index` — the base indent an inserted snippet should
 *  match. Empty when the line starts with a non-whitespace character. */
export function indentOf(source: string, index: number): string {
  return /^[ \t]*/.exec(source.slice(lineStartOf(source, index), index))![0]
}
