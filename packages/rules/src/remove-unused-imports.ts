import type { Collection, GrammarId, RichNode } from '@codegraft/core'
import { defineCodemod } from '@codegraft/codemod'

// `my-widget` / `MyWidget` / `myWidget` → `MyWidget`; each hyphen drops and caps the next letter.
const pascalCase = (name: string): string => name.replace(/(^|-)([a-z])/g, (_m, _sep, c: string) => c.toUpperCase())
const camelCase = (name: string): string => {
  const pascal = pascalCase(name)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

// Vue's built-in directives bind no import, unlike a custom `v-my-dir` (which maps to a `vMyDir` local).
const BUILTIN_DIRECTIVES = new Set([
  'v-if', 'v-else', 'v-else-if', 'v-for', 'v-show', 'v-bind', 'v-on',
  'v-model', 'v-slot', 'v-html', 'v-text', 'v-pre', 'v-once', 'v-cloak', 'v-memo',
])

/**
 * Binding names a Vue template references *outside* a JS expression — component tags (`<MyWidget>` /
 * `<my-widget>` → `MyWidget`/`myWidget`) and custom directives (`v-my-dir` → `vMyDir`), which live in
 * vue `tag_name` / `directive_name` nodes. Native elements (`<div>`) and built-in directives are
 * excluded — never an imported binding. These are always value uses; empty for a non-SFC file.
 */
function vueTemplateBindings(root: Collection): Set<string> {
  const names = new Set<string>()
  root.find('tag_name').forEach((tag) => {
    const name = tag.text
    if (/^[A-Z]/.test(name) || name.includes('-')) names.add(pascalCase(name)).add(camelCase(name))
  })
  root.find('directive_name').forEach((dir) => {
    const name = dir.text
    if (name.startsWith('v-') && !BUILTIN_DIRECTIVES.has(name)) names.add('v' + pascalCase(name.slice(2)))
  })
  return names
}

/** The tree (zone) root a node belongs to — for telling a binding's own zone from its siblings. */
const treeRootOf = (node: RichNode): RichNode => {
  let cur = node
  while (cur.parent) cur = cur.parent
  return cur
}

/** A value identifier that is not the head of a qualified type (`NS.Thing`, which is a type use). */
const isValueRef = (ref: RichNode): boolean => {
  const parent = ref.parent
  return !(parent?.type === 'nested_type_identifier' && parent.child('module') === ref)
}

/**
 * Remove imports with no reference, and rewrite a value import used only in type positions into a
 * type import — the analogue of `eslint-plugin-unused-imports` plus the import half of
 * `@typescript-eslint/consistent-type-imports`. Syntactic and single-file, confident-or-abstain: an
 * import whose use isn't decidable is kept. The scope resolver's rename-safety abstentions (a TS
 * namespace, `declare module`) don't block pruning — a syntactic use-scan covers them; only `with`
 * and `eval`, which can reach a name invisibly, force a no-op. Runs on every JS-family grammar and,
 * through a `ZoneSplitter`, a Vue SFC: a binding used only from a sibling zone — the template's
 * expression zones, a component `<Tag>`, a custom `v-directive`, a `<style> v-bind()`, or a second
 * `<script>` — is kept, not pruned.
 */
export const removeUnusedImports = defineCodemod((root) => {
  // True only when there is more than one parsed zone (a Vue SFC). A plain single-grammar file has no
  // sibling zone to consult, so it skips the cross-zone work below — the sibling scan and template names.
  const multiZone = root.nodes().length > 1

  // The resolver reports only value (`identifier`) references, so type-position uses are gathered
  // separately: every `type_identifier`, plus the `identifier` head of a qualified type (`NS.x`).
  const typeRefs = new Set<string>()
  root.find('type_identifier').forEach((ref) => typeRefs.add(ref.text))
  root.find('nested_type_identifier').forEach((qualified) => {
    const head = qualified.field('module')
    if (head.type === 'identifier') typeRefs.add(head.text)
  })
  // A `typeof X` type query holds its operand as a value `identifier` (the head of any member or
  // instantiation chain — `typeof a.b`, `typeof g<T>`), so it never lexes as a `type_identifier`.
  // Without this, a type-only import used solely through `typeof` reads as unreferenced — its
  // `isType` binding scores `valueUsed === false` — and is wrongly pruned.
  root.find('type_query').forEach((query) => query.find('identifier').forEach((id) => typeRefs.add(id.text)))

  // Component tags / custom directives a Vue template references — a value use the JS scans can't see.
  const templateNames = multiZone ? vueTemplateBindings(root) : new Set<string>()

  // The resolver abstains on the whole file at a construct it can't rename through — a TS namespace,
  // `declare module`/`declare global`. Use-detection still holds (an import is used iff its name
  // appears as a value identifier), so scan — unless `with`/`eval` can reach a name invisibly (null).
  let fallback: { dynamic: boolean; refs: Map<string, RichNode[]> } | undefined
  const syntacticRefs = (name: string): RichNode[] | null => {
    if (!fallback) {
      const dynamic =
        root.find('with_statement').size() > 0 || root.find('call_expression', { function: 'eval' }).size() > 0
      const refs = new Map<string, RichNode[]>()
      if (!dynamic) {
        // Value uses lex as `identifier` (call, `typeof x`, JSX tag, `member_expression` head) or
        // `shorthand_property_identifier` (`{ x }`); a `.member`/key is a `property_identifier`. The
        // import's own specifiers are `identifier`s too, so skip anything inside an import statement.
        const add = (node: RichNode): void => {
          for (let a = node.parent; a; a = a.parent) if (a.type === 'import_statement') return
          const list = refs.get(node.text)
          if (list) list.push(node)
          else refs.set(node.text, [node])
        }
        root.find('identifier').nodes().forEach(add)
        root.find('shorthand_property_identifier').nodes().forEach(add)
      }
      fallback = { dynamic, refs }
    }
    return fallback.dynamic ? null : (fallback.refs.get(name) ?? [])
  }

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
      const resolved = binding.local.references()
      const refNodes = resolved ? resolved.nodes() : syntacticRefs(binding.local.text)
      if (!refNodes) return // resolver abstained and `with`/`eval` make use-detection unsound — skip
      const declaration = binding.local.node

      // The resolver (and the syntactic fallback's own-tree refs) only sees the binding's own zone
      // tree. In a multi-zone file — a Vue SFC's template-expression zones, a second `<script>` — the
      // same binding is reachable from a sibling zone, where the use lexes as a plain value identifier
      // and is always a value use (a template / `v-bind` runs at runtime). Consult that even when the
      // resolver succeeded — skipping it is exactly what hid template usage. An unsound scan
      // (`with`/`eval`) with sibling zones present can't rule a use out, so abstain.
      let usedInSibling = false
      if (multiZone) {
        const occurrences = syntacticRefs(binding.local.text)
        if (!occurrences) return
        const ownTree = treeRootOf(declaration)
        usedInSibling = occurrences.some((ref) => treeRootOf(ref) !== ownTree && isValueRef(ref))
      }

      const valueUsed =
        templateNames.has(binding.local.text) || // a component tag / custom directive (a value use)
        usedInSibling ||
        (!binding.isType && refNodes.some((ref) => ref !== declaration && isValueRef(ref)))
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
    // The `;` is part of the import_statement node, so the rewrite must carry it back — preserve the
    // original's terminator (present, or omitted under ASI) rather than dropping it.
    const semi = stmt.node.text.endsWith(';') ? ';' : ''
    stmt.replaceWith(
      `${asTypeStatement ? 'import type' : 'import'} ${leading.join(', ')} from ${stmt.field('source').text}${semi}`,
    )
  })
})

export default removeUnusedImports

// Lets `codegraft run --codemod @codegraft/rules/remove-unused-imports` apply over `.js/.jsx/.ts/.tsx`
// directly; the cli adds the Vue splitter, so `.vue` `<script>` works too without declaring it here.
export const targets: GrammarId[] = ['javascript', 'typescript', 'tsx']
