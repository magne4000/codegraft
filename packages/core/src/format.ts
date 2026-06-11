// Guessing a file's formatting and re-indenting inserted code. Codegraft edits byte ranges, so
// code it doesn't touch keeps its formatting for free; these let an *inserted* snippet adopt the
// file's indent unit and line ending instead of landing at column 0. Opt-in (the `format` option).

/** A source file's resolved formatting: the indent unit (`'\t'` or N spaces) and line ending. */
export interface FormatStyle {
  indentUnit: string
  eol: string
}

/** Per-apply formatting configuration (`transform(src, ctx, options)`) — each field overrides what
 *  would otherwise be detected from the source. The extension point prettier-like options (trailing
 *  comma, semicolons, quotes, print width) would grow on. */
export interface FormatOptions {
  /** Force the indent unit (`'\t'` or N spaces) instead of guessing it. */
  indentUnit?: string
  /** Force the line ending (`'\n'` / `'\r\n'`) instead of guessing it. */
  eol?: string
}

/** Guess the indent unit (most common indentation step, detect-indent style; tabs when they
 *  dominate) and EOL (first line break) of `source`, defaulting to two spaces and `'\n'`. */
export function detectStyle(source: string): FormatStyle {
  return { indentUnit: detectIndentUnit(source), eol: detectEol(source) }
}

/** The {@link FormatStyle} for an apply: detected from `source`, with any explicit `options` winning. */
export function resolveStyle(source: string, options?: FormatOptions): FormatStyle {
  const detected = detectStyle(source)
  return {
    indentUnit: options?.indentUnit ?? detected.indentUnit,
    eol: options?.eol ?? detected.eol,
  }
}

function detectEol(source: string): string {
  return /\r\n|\n/.exec(source)?.[0] ?? '\n'
}

function detectIndentUnit(source: string): string {
  const steps = new Map<number, number>() // space-step size → occurrences
  let tabLines = 0
  let prevSpaces = 0
  let prevWasSpace = false
  for (const raw of source.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.trim() === '') {
      prevWasSpace = false
      continue
    }
    const indent = /^[ \t]*/.exec(line)![0]
    if (indent.includes('\t')) {
      tabLines++
      prevWasSpace = false
      continue
    }
    if (prevWasSpace) {
      const step = Math.abs(indent.length - prevSpaces)
      if (step > 0) steps.set(step, (steps.get(step) ?? 0) + 1)
    }
    prevSpaces = indent.length
    prevWasSpace = true
  }
  let unit = 0
  let best = 0
  for (const [step, count] of steps) {
    if (count > best) {
      best = count
      unit = step
    }
  }
  if (tabLines > best) return '\t'
  return ' '.repeat(unit || 2)
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

// —— Pure line/whitespace queries over a source string (shared by the formatter and whole-line
// removal). They take the source explicitly so they stay independent of the edit buffer. ——

/** Offset of the first character of the line containing `index`. */
export function lineStartOf(source: string, index: number): number {
  return source.lastIndexOf('\n', index - 1) + 1
}

/** The leading whitespace of the line containing `index` — the base indent an inserted block should
 *  match. Empty when the line starts with a non-whitespace character. */
export function indentOf(source: string, index: number): string {
  return /^[ \t]*/.exec(source.slice(lineStartOf(source, index), index))![0]
}

/** A space or tab — the horizontal whitespace separating inline list elements (`undefined` past
 *  either end of the source is not whitespace). */
export function isHSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\t'
}

/** The start of the run of whole blank lines immediately above the line beginning at `lineStart`
 *  — `lineStart` itself when the preceding line is non-blank. The "absorb blank lines above" step
 *  shared by whole-line removal and the line-collapse of a removed last element. */
export function blankRunStart(source: string, lineStart: number): number {
  let from = lineStart
  while (from > 0) {
    const prevStart = lineStartOf(source, from - 1)
    if (source.slice(prevStart, from - 1).trim() !== '') break // a non-blank line stops it
    from = prevStart
  }
  return from
}

/** The end of the run of whole blank lines beginning at line start `from` — the start of the first
 *  non-blank line at or after it (`from` itself when that line is non-blank, the source length when
 *  only blank lines remain). The forward mirror of {@link blankRunStart}: collapsing the blank lines
 *  that followed a removed first element, which would dangle after the container's opening delimiter. */
export function blankRunEnd(source: string, from: number): number {
  let to = from
  while (to < source.length) {
    const newline = source.indexOf('\n', to)
    const lineEnd = newline === -1 ? source.length : newline
    if (source.slice(to, lineEnd).trim() !== '') break // a non-blank line stops it
    to = newline === -1 ? source.length : newline + 1
  }
  return to
}

/** The whole-line span `[from, to)` covering the lines `[start, end)` touches — from the start of
 *  `start`'s line (leading indentation included) through the newline after `end`'s line, so nothing
 *  blank is left behind. With `collapseBlankBefore`, also absorb whole blank lines immediately above
 *  (a separator before a dropped block). */
export function wholeLineRange(source: string, start: number, end: number, collapseBlankBefore = false): [number, number] {
  const lineStart = lineStartOf(source, start)
  const from = collapseBlankBefore ? blankRunStart(source, lineStart) : lineStart
  const newline = source.indexOf('\n', end)
  return [from, newline === -1 ? source.length : newline + 1]
}
