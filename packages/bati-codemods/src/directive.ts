/** The `$$…` expression a directive comment carries, regardless of delimiter — `// $$.x`, `//# $$.x`,
 *  `# $$.x`, a one-line block `/*# $$.x #*​/`, or an html `<!-- $$.x -->` — trimming whichever trailing
 *  terminator the comment uses. `null` when the comment is not a `$$` directive. */
export function extractDirective(commentText: string): string | null {
  const match = commentText.match(/\$\$[^\n]*/)
  return match ? match[0].replace(/\s*(?:#*\s*\*\/|-->)\s*$/, '').trim() : null
}
