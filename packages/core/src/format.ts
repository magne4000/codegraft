// Guessing a file's formatting and re-indenting inserted code. Codegraft edits byte ranges, so
// code it doesn't touch keeps its formatting for free; these let an *inserted* snippet adopt the
// file's indent unit and line ending instead of landing at column 0. Opt-in (the `format` option).

/** A source file's guessed formatting: the indent unit (`'\t'` or N spaces) and line ending. */
export interface FormatStyle {
  indentUnit: string
  eol: string
}

/** Guess the indent unit (most common indentation step, detect-indent style; tabs when they
 *  dominate) and EOL (first line break) of `source`, defaulting to two spaces and `'\n'`. */
export function detectStyle(source: string): FormatStyle {
  return { indentUnit: detectIndentUnit(source), eol: detectEol(source) }
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
