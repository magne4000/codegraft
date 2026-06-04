import { defineRules } from '@trast/match'
import { remove, evaluate, getConditionalBranches, type RichNode } from '@trast/core'

/** The build-time globals a rule references, under the `$$` namespace (`$$.BATI.has(…)`).
 *  The integration tests supply the value programmatically; a consumer types `$$` with a
 *  matching `declare global` so source files type-check. */
interface Ctx {
  BATI: { has(feature: string): boolean }
}

const usesNamespace = ({ cond }: { cond: unknown }) => (cond as RichNode).text.includes('$$')

/** The canonical Bati rule set the integration fixtures run against. Conditions are
 *  written against the `$$` namespace and decided by `evaluate` — so compound conditions
 *  like `$$.BATI.has("a") && !$$.BATI.has("b")` work with no rule-specific logic — and the
 *  `$$` marker enables the source-scan optimisation. The conditional rules are generated
 *  for both `tsx` and `ts`, covering `.ts`, `.tsx`, and the Vue `<script>` zone alike. */
export default defineRules<Ctx>({ namespace: '$$' }, (match) => [
  ...(['tsx', 'ts'] as const).flatMap((lang) => [
    // if ($$.…) { … } else { … }
    match[lang].expr`if ($cond) { $$$then } else { $$$otherwise }`
      .where(usesNamespace)
      .rewrite(({ cond, then, otherwise }, ctx) =>
        evaluate(cond as RichNode, ctx) ? (then as RichNode[]) : (otherwise as RichNode[]),
      ),
    // if ($$.…) { … }   (no else)
    match[lang].expr`if ($cond) { $$$then }`
      .where(usesNamespace)
      .rewrite(({ cond, then }, ctx) => (evaluate(cond as RichNode, ctx) ? (then as RichNode[]) : remove)),
    // $$.… ? a : b
    match[lang].expr`$cond ? $consequent : $alternate`
      .where(usesNamespace)
      .rewrite(({ cond, consequent, alternate }, ctx) =>
        evaluate(cond as RichNode, ctx) ? (consequent as RichNode) : (alternate as RichNode),
      ),
    // // $$.…   above a declaration
    match[lang]
      .node('lexical_declaration')
      .whenLeadingComment(/\$\$[^\n]*/)
      .rewrite(({ node, commentMatch }, ctx) => (evaluate(commentMatch![0], ctx) ? node.text : remove)),
  ]),
  // // $$.…   above a JSX attribute (TSX only)
  match.tsx
    .node('jsx_attribute')
    .whenLeadingComment(/\$\$[^\n]*/)
    .rewrite(({ node, commentMatch }, ctx) => (evaluate(commentMatch![0], ctx) ? node.text : remove)),
  // <!-- $$.… --> above an HTML element
  match.html
    .node('element')
    .whenLeadingComment(/\$\$.*?(?=\s*-->)/)
    .rewrite(({ node, commentMatch }, ctx) => (evaluate(commentMatch![0], ctx) ? node.text : remove)),
  // $$.If<{ featureA: T; default: U }>  →  the selected branch's type
  match.ts.type`$$.If<$branches>`.rewrite(({ branches }, ctx) => {
    const choices = getConditionalBranches(branches as RichNode)
    const chosen = choices.find((c) => ctx.BATI.has(c.name)) ?? choices.find((c) => c.name === 'default')
    return chosen ? chosen.type : 'never'
  }),
])
