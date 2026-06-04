import type {
  CaptureArg,
  CompiledRule,
  GrammarId,
  LazyTransformer,
  RewriteResult,
  RichNode,
  Transformer,
  ZoneSplitter,
} from './types.js'
import { remove } from './types.js'
import { Parser } from './parser.js'
import { splitAndParse } from './zone-splitter.js'
import { attachComments } from './comment-attachment.js'
import { EditCollector } from './edit-collector.js'
import { matchVisitor } from './pattern-matcher.js'
import { leadingCommentPredicate, type LeadingCommentMatch } from './comment-predicate.js'

/** A CompiledRule with its pattern and comment regex turned into runtime functions —
 *  the form the visitor walk consumes. Built once at `init()`. */
interface RuntimeRule {
  language: GrammarId | 'any'
  visitor: (node: RichNode) => Record<string, RichNode | RichNode[]> | null
  guard: ((captures: CaptureArg) => boolean) | null
  commentPredicate: ((node: RichNode) => LeadingCommentMatch | null) | null
  rewrite: CompiledRule['rewrite']
}

/**
 * Build a lazy transformer for a target (a single grammar or a {@link ZoneSplitter})
 * from compiled rule data. `init()` loads the grammars and compiles each rule's data
 * into runtime functions once; the returned `Transformer` is synchronous. §7.
 */
export function createTransformer<Ctx extends Record<string, unknown> = Record<string, unknown>>(
  target: GrammarId | ZoneSplitter,
  rules: CompiledRule[],
): LazyTransformer<Ctx> {
  let pending: Promise<Transformer<Ctx>> | null = null

  async function build(): Promise<Transformer<Ctx>> {
    await Parser.init()
    const grammars = typeof target === 'string' ? [target] : target.grammars
    for (const grammar of grammars) await Parser.loadGrammar(grammar)
    if (typeof target !== 'string') await target.init()

    const runtime: RuntimeRule[] = rules.map((rule) => ({
      language: rule.language,
      visitor: matchVisitor(rule.pattern),
      guard: rule.guard,
      commentPredicate: rule.commentRegex ? leadingCommentPredicate(rule.commentRegex) : null,
      rewrite: rule.rewrite,
    }))

    function collect(source: string, context: Ctx): EditCollector {
      const collector = new EditCollector(source)
      for (const zone of splitAndParse(source, target)) {
        attachComments(zone.tree)
        const zoneRules = runtime.filter((r) => r.language === zone.language || r.language === 'any')
        visit(zone.tree, zoneRules, collector, context)
      }
      return collector
    }

    return {
      transform: (source, context) => collect(source, context).toString(),
      transformWithMap(source, context, options) {
        const collector = collect(source, context)
        return { code: collector.toString(), map: collector.generateMap(options?.source ?? 'input') }
      },
    }
  }

  return {
    target,
    init() {
      pending ??= build()
      return pending
    },
  }
}

function visit(
  node: RichNode,
  rules: RuntimeRule[],
  collector: EditCollector,
  context: Record<string, unknown>,
): void {
  for (const rule of rules) {
    const caps = rule.visitor(node)
    if (caps === null) continue

    const captureArg: CaptureArg = { node, ...caps }
    // Guard refines the structural match (context-free); a miss means this rule does
    // not claim the node, so recursion continues into its subtree.
    if (rule.guard && !rule.guard(captureArg)) continue

    let cm: LeadingCommentMatch | null = null
    if (rule.commentPredicate) {
      cm = rule.commentPredicate(node)
      if (cm === null) continue
    }
    if (cm) captureArg.commentMatch = cm.match

    // A comment-gated edit also consumes the directive comment, so it is never
    // left orphaned (§6).
    const editStart = cm
      ? Math.min(cm.comment.documentStartIndex, node.documentStartIndex)
      : node.documentStartIndex
    applyResult(rule.rewrite(captureArg, context), node, editStart, rules, collector, context)
    return // outer-wins: the first matching rule claims this node
  }

  for (const child of node.children) {
    visit(child, rules, collector, context)
  }
}

/**
 * Apply a rewrite's result to the matched node's range `[editStart, node.end)`.
 *
 * A string/`remove` replaces the whole range opaquely (subtree skipped). A returned
 * subtree (a `RichNode`/`RichNode[]`, always contiguous and within the node) is **kept
 * in place**: only the wrapper around it is removed and the kept nodes are re-visited,
 * so nested rules still fire and — because the kept text never moves — the source map
 * stays precise. This is also why nesting collapses correctly: the kept branch is
 * transformed in the same pass.
 */
function applyResult(
  result: RewriteResult,
  node: RichNode,
  editStart: number,
  rules: RuntimeRule[],
  collector: EditCollector,
  context: Record<string, unknown>,
): void {
  const editEnd = node.documentEndIndex
  if (result === remove) {
    collector.remove(editStart, editEnd)
    return
  }
  if (typeof result === 'string') {
    collector.overwrite(editStart, editEnd, result)
    return
  }
  const kept = Array.isArray(result) ? result : [result]
  if (kept.length === 0) {
    collector.remove(editStart, editEnd)
    return
  }
  collector.remove(editStart, kept[0].documentStartIndex) // drop the wrapper (incl. any directive comment)
  collector.remove(kept[kept.length - 1].documentEndIndex, editEnd)
  for (const keptNode of kept) visit(keptNode, rules, collector, context)
}
