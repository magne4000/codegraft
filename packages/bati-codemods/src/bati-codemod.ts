import type { Collection, GrammarId } from '@codegraft/core'
import { getConditionalBranches } from '@codegraft/core'
import { defineCodemod } from '@codegraft/codemod'
import type { BatiContext } from './context.js'
import { extractDirective } from './directive.js'

/** A leading comment that is a `$$` directive — the pattern `dropDirective` keys off. */
const DIRECTIVE = /\$\$/
/** Container types whose elements are comma-separated, so dropping one needs separator cleanup. */
const SEPARATOR_PARENTS = new Set(['array', 'object', 'arguments'])

/**
 * Bati's boilerplate transform as one codemod: a single depth-first walk that collapses `$$`
 * conditionals and types and applies comment-directive gates, pruning the branches it removes so
 * nested conditionals resolve in one pass without overlapping edits. Run `batiImports` and
 * `@codegraft/rules` `removeUnusedImports` after it — they read the post-collapse tree and must not
 * be `$$`-scan-gated.
 */
export const batiCodemod = defineCodemod<BatiContext>({ namespace: '$$' }, (root, ctx) => {
  if (suppressWholeFile()) return
  walkSiblings(root.children())

  /** `$$.keepFileIf(<condition>)` on the first line: empty the file when false (Bati then drops it),
   *  else strip the directive and transform normally. Returns whether the file was emptied. */
  function suppressWholeFile(): boolean {
    const first = root.children().first()
    if (first.size() === 0) return false
    const lead = first.node.leadingComments
    if (lead.length === 0) return false
    const condition = extractDirective(lead[0].text)?.match(/^\$\$\.keepFileIf\((.*)\)$/)?.[1]
    if (condition === undefined) return false
    if (first.evaluateExpression(condition, ctx)) {
      dropDirectiveComment(first, lead.length)
      return false
    }
    root.replaceWith('')
    return true
  }

  /** Apply the leading-comment gate to each sibling, then descend into the ones it keeps. */
  function walkSiblings(siblings: Collection): void {
    siblings.forEach((child) => {
      if (!gateRemoved(child)) visit(child)
    })
  }

  /** Act on a node's `$$` directive comment. Returns whether the node was removed (so the caller
   *  prunes): only a falsy condition removes it; a flag or true condition strips the directive and
   *  keeps the node. */
  function gateRemoved(col: Collection): boolean {
    const lead = col.node.leadingComments
    if (lead.length === 0) return false
    const directive = extractDirective(lead[0].text)
    if (directive === null || directive.startsWith('$$.keepFileIf')) return false // keepFileIf already handled

    if (directive === '$$.includeIfImported') {
      ctx.includeIfImported = true
      dropDirectiveComment(col, lead.length)
      return false
    }

    const value = col.evaluateExpression(directive, ctx)
    if (value === true) {
      dropDirectiveComment(col, lead.length)
      return false
    }
    // `… || "remove-comments-only"` with a comment below the directive keeps the node, dropping only
    // the comments; with the directive alone it falls through and behaves like a false condition.
    if (value === 'remove-comments-only' && lead.length > 1) {
      col.dropDirective(DIRECTIVE)
      return false
    }
    col.dropDirective(DIRECTIVE) // removes the directive and any comments below it, up to the node
    col.remove(SEPARATOR_PARENTS.has(col.node.parent?.type ?? '') ? { separator: true } : undefined)
    return true
  }

  /** Drop the directive line, keeping the node. A stacked run keeps the non-directive comments below
   *  it (Prettier tidies the blank); a lone directive takes its whole line. */
  function dropDirectiveComment(col: Collection, leadCount: number): void {
    if (leadCount === 1) col.dropDirective(DIRECTIVE)
    else col.mapLeadingComment(() => '')
  }

  /** Dispatch a kept node by type; conditional constructs drive their own pruned recursion. */
  function visit(col: Collection): void {
    switch (col.type) {
      case 'if_statement':
        if (usesNamespace(col.field('condition'))) return collapseIf(col)
        break
      case 'ternary_expression':
        if (usesNamespace(col.field('condition'))) return collapseTernary(col)
        break
      case 'as_expression':
        if (dropAnyCast(col)) return
        break
      case 'generic_type':
        if (resolveConditionalType(col)) return
        break
    }
    walkSiblings(col.children())
  }

  function collapseIf(col: Collection): void {
    if (col.field('condition').evaluate(ctx)) return keepBranch(col, col.field('consequence'))
    const alternative = col.field('alternative') // else_clause, or empty when there is no else
    if (alternative.size() === 0) col.remove()
    else keepBranch(col, alternative.children().first()) // the statement inside `else …`
  }

  /** Unwrap `col` down to `branch`, then walk the kept region. A block keeps its statements (braces
   *  dropped); a single statement (incl. an `else if`) is kept whole. */
  function keepBranch(col: Collection, branch: Collection): void {
    if (branch.isOfType('statement_block')) {
      const statements = branch.children()
      col.unwrap(statements)
      walkSiblings(statements)
    } else {
      col.unwrap(branch)
      visit(branch)
    }
  }

  function collapseTernary(col: Collection): void {
    const keep = col.field('condition').evaluate(ctx) ? col.field('consequence') : col.field('alternative')
    // In a JSX child `{$$.… ? <C/> : undefined}`, act on the whole `{…}`: remove it for an
    // `undefined`/`null` branch (no empty braces left) or unwrap to a kept JSX element (drop the
    // braces). Any other branch keeps its braces — only the ternary collapses — matching Bati.
    if (col.node.parent?.type === 'jsx_expression') {
      if (keep.type === 'undefined' || keep.type === 'null') {
        col.parent().remove()
        return
      }
      if (isJsxElement(keep.type)) {
        col.parent().unwrap(keep)
        visit(keep)
        return
      }
    }
    col.unwrap(keep)
    visit(keep)
  }

  /** `x as $$.Any` → `x`. Returns whether it was an `$$.Any` cast. */
  function dropAnyCast(col: Collection): boolean {
    const parts = col.children() // [expression, type]
    if (!isQualified(parts.at(1), 'Any')) return false
    const expression = parts.at(0)
    col.unwrap(expression)
    visit(expression)
    return true
  }

  /** Resolve `$$.If` / `$$.IfAsUnknown<{ '$$.…': T; _: F }>` to its live branch. Returns whether it
   *  was a Bati conditional type (so the caller skips the now-rewritten subtree). */
  function resolveConditionalType(col: Collection): boolean {
    const name = col.field('name')
    const asUnknown = isQualified(name, 'IfAsUnknown')
    if (!asUnknown && !isQualified(name, 'If')) return false

    let fallback: string | null = null
    let chosen: string | null = null
    for (const branch of getConditionalBranches(col.field('type_arguments').children().first().node)) {
      const key = unquote(branch.name)
      if (key === '_') fallback = branch.type.text
      else if (chosen === null && col.evaluateExpression(key, ctx)) chosen = branch.type.text
    }
    const resolved = chosen ?? fallback

    const parent = col.parent()
    if (resolved !== null) {
      col.replaceWith(asUnknown && parent.type === 'as_expression' ? `unknown as ${resolved}` : resolved)
    } else if (parent.type === 'as_expression') {
      parent.unwrap(parent.children().at(0)) // drop ` as $$.If<…>`, keep the expression
    } else if (parent.type === 'type_annotation') {
      parent.remove() // drop the `: $$.If<…>` annotation
    } else {
      col.replaceWith('') // type-argument position with no match and no fallback
    }
    return true
  }
})

export default batiCodemod

/** The targets this codemod handles directly; `.vue` `<script>` is reached via a `ZoneSplitter`. */
export const targets: GrammarId[] = ['javascript', 'typescript', 'tsx']

/** Whether an `if`/ternary condition references the `$$` namespace (else it is left alone). */
function usesNamespace(condition: Collection): boolean {
  return condition.size() > 0 && condition.text.includes('$$')
}

function isJsxElement(type: string): boolean {
  return type === 'jsx_element' || type === 'jsx_self_closing_element' || type === 'jsx_fragment'
}

/** Whether a TS type node is the qualified name `$$.<member>`. */
function isQualified(type: Collection, member: string): boolean {
  if (type.size() === 0 || type.type !== 'nested_type_identifier') return false
  return type.field('module').text === '$$' && type.field('name').text === member
}

function unquote(text: string): string {
  return text.replace(/^['"`]|['"`]$/g, '')
}
