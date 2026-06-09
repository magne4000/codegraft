import type { Collection, GrammarId } from '@codegraft/core'
import { defineCodemod } from '@codegraft/codemod'

/**
 * Remove imports with no reference, and rewrite a value import used only in type positions into a
 * type import — the analogue of `eslint-plugin-unused-imports` plus the import half of
 * `@typescript-eslint/consistent-type-imports`. Syntactic and single-file; confident-or-abstain, so
 * a binding the scope resolver can't resolve is left untouched rather than deleted. Runs on every
 * JS-family grammar and, through a `ZoneSplitter`, the `<script>` of a Vue SFC.
 */
export const removeUnusedImports = defineCodemod((root) => {
  // The resolver reports only value (`identifier`) references, so type-position uses are gathered
  // separately: every `type_identifier`, plus the `identifier` head of a qualified type (`NS.x`).
  const typeRefs = new Set<string>()
  root.find('type_identifier').forEach((ref) => typeRefs.add(ref.text))
  root.find('nested_type_identifier').forEach((qualified) => {
    const head = qualified.field('module')
    if (head.type === 'identifier') typeRefs.add(head.text)
  })

  interface Binding {
    /** A named specifier (`{ x }`), as opposed to a default or `* as ns`. */
    named: boolean
    /** Renderable text, without any `type` keyword: `Foo`, `Foo as Bar`, `* as ns`. */
    text: string
    local: Collection
    /** Already a type import — a whole `import type …`, or an inline `{ type X }`. */
    isType: boolean
  }
  type Kept = Binding & { typeOnly: boolean }

  root.find('import_statement').forEach((stmt) => {
    const clause = stmt.children().filter((child) => child.type === 'import_clause').first()
    if (clause.size() === 0) return // side-effect import (`import 'x'`): no binding to be unused

    const isTypeStatement = stmt.node.allChildren.some((child) => child.type === 'type') // `import type …`
    const bindings: Binding[] = []
    clause.children().forEach((part) => {
      if (part.type === 'identifier') {
        bindings.push({ named: false, text: part.text, local: part, isType: isTypeStatement })
      } else if (part.type === 'namespace_import') {
        bindings.push({ named: false, text: part.text, local: part.find('identifier').first(), isType: isTypeStatement })
      } else if (part.type === 'named_imports') {
        part.find('import_specifier').forEach((spec) => {
          const alias = spec.field('alias')
          const name = spec.field('name')
          const inlineType = spec.node.allChildren.some((child) => child.type === 'type')
          const text = alias.size() ? `${name.text} as ${alias.text}` : name.text
          bindings.push({ named: true, text, local: alias.size() ? alias : name, isType: isTypeStatement || inlineType })
        })
      }
    })

    // Keep each referenced binding, recording whether its only references are type-position ones.
    const kept: Kept[] = []
    for (const binding of bindings) {
      const references = binding.local.references()
      if (!references) return // resolver abstains on this file — leave the statement untouched
      const declaration = binding.local.node
      const valueUsed =
        !binding.isType &&
        references.nodes().some((ref) => {
          // A qualified-type head (`NS.Thing`) lexes as a value identifier but is a type use.
          const parent = ref.parent
          return ref !== declaration && !(parent?.type === 'nested_type_identifier' && parent.child('module') === ref)
        })
      if (!valueUsed && !typeRefs.has(binding.local.text)) continue // unreferenced
      kept.push({ ...binding, typeOnly: !valueUsed })
    }
    if (kept.length === 0) {
      stmt.remove()
      return
    }

    // A type-only default or `* as ns` can't be marked inline, so a binding renders as a type only
    // when the whole statement does (every binding type-only) or it's a named specifier. `asType`
    // is the single source of truth for the no-op check and the rendering below.
    const asTypeStatement = kept.every((binding) => binding.typeOnly)
    const asType = (binding: Kept) => asTypeStatement || (binding.named && binding.typeOnly)
    if (kept.length === bindings.length && kept.every((binding) => asType(binding) === binding.isType)) return

    const leading: string[] = []
    const specifiers: string[] = []
    for (const binding of kept) {
      if (!binding.named) leading.push(binding.text)
      else specifiers.push(asType(binding) && !asTypeStatement ? `type ${binding.text}` : binding.text)
    }
    if (specifiers.length) leading.push(`{ ${specifiers.join(', ')} }`)
    stmt.replaceWith(`${asTypeStatement ? 'import type' : 'import'} ${leading.join(', ')} from ${stmt.field('source').text}`)
  })
})

export default removeUnusedImports

// Lets `codegraft run --codemod @codegraft/rules/remove-unused-imports` apply over `.js/.jsx/.ts/.tsx`
// directly. A `.vue` refactor wraps it in a codemod file with `vueSplitter` added to `targets`.
export const targets: GrammarId[] = ['javascript', 'typescript', 'tsx']
