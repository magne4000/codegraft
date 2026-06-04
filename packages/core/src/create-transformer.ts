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

    return {
      transform(source, context) {
        const collector = new EditCollector()
        for (const zone of splitAndParse(source, target)) {
          attachComments(zone.tree)
          const zoneRules = runtime.filter(
            (r) => r.language === zone.language || r.language === 'any',
          )
          visit(zone.tree, zoneRules, collector, context, source)
        }
        return collector.apply(source)
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
  source: string,
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
    const start = cm
      ? Math.min(cm.comment.documentStartIndex, node.documentStartIndex)
      : node.documentStartIndex
    const replacement = resolveResult(rule.rewrite(captureArg, context), rules, context, source)
    collector.add({ start, end: node.documentEndIndex, replacement })
    return // outer-wins: the first matching rule claims this node; skip its subtree
  }

  for (const child of node.children) {
    visit(child, rules, collector, context, source)
  }
}

function resolveResult(
  result: RewriteResult,
  rules: RuntimeRule[],
  context: Record<string, unknown>,
  source: string,
): string {
  if (result === remove) return ''
  if (typeof result === 'string') return result
  if (Array.isArray(result)) return result.length === 0 ? '' : transformSpan(result, rules, context, source)
  return transformSpan([result], rules, context, source)
}

/**
 * Re-emit a kept subtree, transformed. The returned nodes re-enter the visitor in a
 * fresh collector, then their source span is emitted with those nested edits applied —
 * so a rule (e.g. a nested BATI conditional) inside a kept branch still fires. The
 * nodes are contiguous (a spread capture guarantees it), and every nested edit lands
 * within their span, so re-emitting the span is exact: slicing preserves the
 * whitespace, separators, and comments that live between the nodes.
 */
function transformSpan(
  nodes: RichNode[],
  rules: RuntimeRule[],
  context: Record<string, unknown>,
  source: string,
): string {
  const sub = new EditCollector()
  for (const node of nodes) visit(node, rules, sub, context, source)
  return sub.applyToSpan(source, nodes[0].documentStartIndex, nodes[nodes.length - 1].documentEndIndex)
}
