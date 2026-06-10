/** The `$$…` expression a directive comment carries, regardless of delimiter (`// $$.x`, `//# $$.x`,
 *  `# $$.x`, or a one-line block comment whose trailing terminator is trimmed); `null` when the
 *  comment is not a `$$` directive. */
export function extractDirective(commentText: string): string | null {
  const match = commentText.match(/\$\$[^\n]*/)
  return match ? match[0].replace(/\s*#*\s*\*\/\s*$/, '').trim() : null
}
