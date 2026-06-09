import { defineCodemod } from '@codegraft/codemod'

// A minimal Bati-style codemod for the `codegraft run` tests. The namespace is data-shaped
// (`$$.flags.x`) so the context is JSON-serialisable — the form `codegraft run --context` accepts.
export default defineCodemod<{ flags: Record<string, boolean> }>({ namespace: '$$' }, (root, ctx) => {
  root.find('if_statement').forEach((node) => {
    const cond = node.field('condition')
    if (!cond.text.includes('$$')) return
    if (cond.evaluate(ctx)) {
      node.unwrap(node.field('consequence').children())
    } else {
      const alt = node.field('alternative')
      if (alt.size() === 0) node.remove()
      else node.unwrap(alt.find('statement_block').first().children())
    }
  })
})

export const targets = ['tsx']
