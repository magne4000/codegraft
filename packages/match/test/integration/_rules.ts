import { defineRules } from '@trast/match'
import { remove, type RichNode } from '@trast/core'

type Ctx = { features: string[] }
const feature = (node: unknown) => (node as RichNode).text.slice(1, -1) // "auth" -> auth
const on = (ctx: Ctx, node: unknown) => ctx.features.includes(feature(node))

/** The canonical Bati rule set the integration fixtures run against. The conditional
 *  rules are generated for both `tsx` and `ts` (the DRY multi-grammar pattern), so they
 *  cover `.ts`, `.tsx`, and the Vue `<script>` zone alike. */
export default defineRules<Ctx>((match) => [
  ...(['tsx', 'ts'] as const).flatMap((lang) => [
    // if (BATI.has("x")) { … } else { … }
    match[lang].expr`if (BATI.has($f)) { $$$then } else { $$$otherwise }`.rewrite(({ f, then, otherwise }, ctx) =>
      on(ctx, f) ? (then as RichNode[]) : (otherwise as RichNode[]),
    ),
    // if (BATI.has("x")) { … }   (no else)
    match[lang].expr`if (BATI.has($f)) { $$$then }`.rewrite(({ f, then }, ctx) =>
      on(ctx, f) ? (then as RichNode[]) : remove,
    ),
    // BATI.has("x") ? a : b
    match[lang].expr`BATI.has($f) ? $consequent : $alternate`.rewrite(({ f, consequent, alternate }, ctx) =>
      on(ctx, f) ? (consequent as RichNode) : (alternate as RichNode),
    ),
    // // @bati x  above a declaration
    match[lang]
      .node('lexical_declaration')
      .whenLeadingComment(/@bati (\w+)/)
      .rewrite(({ node, commentMatch }, ctx) => (ctx.features.includes(commentMatch![1]) ? node.text : remove)),
  ]),
  // // @bati x  above a JSX attribute (TSX only)
  match.tsx
    .node('jsx_attribute')
    .whenLeadingComment(/@bati (\w+)/)
    .rewrite(({ node, commentMatch }, ctx) => (ctx.features.includes(commentMatch![1]) ? node.text : remove)),
  // <!-- @bati x --> above an HTML element
  match.html
    .node('element')
    .whenLeadingComment(/@bati (\w+)/)
    .rewrite(({ node, commentMatch }, ctx) => (ctx.features.includes(commentMatch![1]) ? node.text : remove)),
])
