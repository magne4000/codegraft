import type { GrammarId, RichNode } from './types.js'

/**
 * Lexical binding resolution for one parsed tree — **JS/TS/TSX only**, syntactic (no types).
 *
 * Confident-or-abstain: a query returns `null` whenever the tree contains a construct the
 * resolver does not fully model (`with`, `eval`, a TS namespace/ambient module, an unknown binding
 * form, or an occurrence that can't be renamed in place such as an object shorthand). A codemod
 * treats `null` as "do not proceed", so a rename never fires on a guess. (A TS `enum` is modelled —
 * its name binds like a class — so it does not force abstention.)
 *
 * Value vs type is mostly free here: tree-sitter spells type references `type_identifier`, so
 * collecting `identifier` nodes naturally excludes them.
 */
export interface Resolver {
  /** Every occurrence (declaration + value references) of the binding `decl` introduces; `null`
   *  to abstain. */
  references(decl: RichNode): RichNode[] | null
  /** The declaration a value reference resolves to; `null` for a global or to abstain. */
  definition(ref: RichNode): RichNode | null
}

const SUPPORTED = new Set<GrammarId>(['javascript', 'typescript', 'tsx'])

/** A resolver for `root`'s tree, or `null` if the language has no binding model. */
export function createResolver(root: RichNode): Resolver | null {
  return SUPPORTED.has(root.language) ? new ScopeResolver(root) : null
}

interface Scope {
  node: RichNode
  parent: Scope | null
  /** name → its declaration identifier in this scope. */
  bindings: Map<string, RichNode>
}

const FUNCTIONS = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'generator_function',
  'arrow_function',
  'method_definition',
])

class ScopeResolver implements Resolver {
  #abstain = false
  readonly #root: Scope
  /** scope-owning node → its scope (the only nodes recorded; `#scopeAt` walks up to them). */
  readonly #scopes = new Map<RichNode, Scope>()

  constructor(root: RichNode) {
    this.#root = { node: root, parent: null, bindings: new Map() }
    this.#scopes.set(root, this.#root)
    this.#walk(root, this.#root, this.#root)
  }

  definition(ref: RichNode): RichNode | null {
    if (this.#abstain || ref.type !== 'identifier') return null
    return this.#resolve(ref)
  }

  references(decl: RichNode): RichNode[] | null {
    if (this.#abstain || decl.type !== 'identifier') return null
    const name = decl.text
    if (this.#scopeAt(decl).bindings.get(name) !== decl) return null // not a binding we own
    const out: RichNode[] = []
    let abstain = false
    const collect = (node: RichNode): void => {
      if (abstain) return
      if (node.text === name) {
        // an object shorthand referencing this binding can't be renamed in place
        if (node.type === 'shorthand_property_identifier' && this.#resolve(node) === decl) {
          abstain = true
          return
        }
        if (node.type === 'identifier' && this.#resolve(node) === decl) out.push(node)
      }
      for (const child of node.allChildren) collect(child)
    }
    collect(this.#scopeAt(decl).node)
    return abstain ? null : out
  }

  #resolve(ref: RichNode): RichNode | null {
    for (let s: Scope | null = this.#scopeAt(ref); s; s = s.parent) {
      const binding = s.bindings.get(ref.text)
      if (binding) return binding
    }
    return null
  }

  #scopeAt(node: RichNode): Scope {
    for (let n: RichNode | null = node; n; n = n.parent) {
      const scope = this.#scopes.get(n)
      if (scope) return scope
    }
    return this.#root
  }

  #newScope(node: RichNode, parent: Scope): Scope {
    const scope: Scope = { node, parent, bindings: new Map() }
    this.#scopes.set(node, scope)
    return scope
  }

  #walk(node: RichNode, scope: Scope, fnScope: Scope): void {
    if (this.#abstain) return
    switch (node.type) {
      case 'with_statement':
      case 'internal_module': // TS `namespace X {}` — exported members are visible as `X.m`, so a
      case 'module': // TS `module 'x' {}`      partial rename would corrupt; abstain rather than guess.
        this.#abstain = true
        return
      case 'enum_declaration': {
        // An enum binds its name in the enclosing scope (like a class). Member names are
        // `property_identifier` (reached as `E.Member`), never free identifiers, so walking the
        // body here only resolves initialiser references — it can't mis-bind a member.
        this.#bind(scope, node.child('name'))
        this.#walkChildren(node.child('body'), scope, fnScope)
        return
      }
      case 'call_expression':
        if (node.child('function')?.text === 'eval') {
          this.#abstain = true
          return
        }
        this.#walkChildren(node, scope, fnScope)
        return
      case 'function_declaration':
      case 'generator_function_declaration': {
        this.#bind(fnScope, node.child('name')) // hoisted to the enclosing function scope
        const inner = this.#newScope(node, scope)
        this.#bindParams(node, inner)
        this.#walkChildren(node.child('body'), inner, inner)
        return
      }
      case 'function_expression':
      case 'generator_function':
      case 'arrow_function':
      case 'method_definition': {
        const inner = this.#newScope(node, scope)
        this.#bind(inner, node.child('name')) // optional function-expression name
        this.#bindParams(node, inner)
        this.#walkChildren(node.child('body'), inner, inner)
        return
      }
      case 'class_declaration': {
        this.#bind(scope, node.child('name')) // class name: block-scoped in the enclosing scope
        this.#walkChildren(node.child('body'), scope, fnScope)
        return
      }
      case 'lexical_declaration': // let / const
        for (const d of node.children) {
          if (d.type !== 'variable_declarator') continue
          this.#bindPattern(d.child('name'), scope)
          this.#walkChildren(d.child('value'), scope, fnScope)
        }
        return
      case 'variable_declaration': // var → hoisted
        for (const d of node.children) {
          if (d.type !== 'variable_declarator') continue
          this.#bindPattern(d.child('name'), fnScope)
          this.#walkChildren(d.child('value'), scope, fnScope)
        }
        return
      case 'import_statement':
        this.#bindImports(node)
        return
      case 'statement_block': {
        this.#walkChildren(node, this.#newScope(node, scope), fnScope)
        return
      }
      case 'for_statement':
      case 'for_in_statement': {
        this.#walkChildren(node, this.#newScope(node, scope), fnScope)
        return
      }
      case 'catch_clause': {
        const inner = this.#newScope(node, scope)
        this.#bindPattern(node.child('parameter'), inner)
        this.#walkChildren(node.child('body'), inner, fnScope)
        return
      }
      default:
        this.#walkChildren(node, scope, fnScope)
    }
  }

  #walkChildren(node: RichNode | null, scope: Scope, fnScope: Scope): void {
    if (!node) return
    for (const child of node.allChildren) this.#walk(child, scope, fnScope)
  }

  #bind(scope: Scope, name: RichNode | null): void {
    if (name?.type === 'identifier') scope.bindings.set(name.text, name)
  }

  #bindParams(fn: RichNode, scope: Scope): void {
    const params = fn.child('parameters')
    if (params) {
      for (const p of params.children) this.#bindPattern(unwrapParameter(p), scope)
      return
    }
    this.#bindPattern(fn.child('parameter'), scope) // arrow `x => …`
  }

  #bindImports(node: RichNode): void {
    const walk = (n: RichNode): void => {
      if (n.type === 'identifier') {
        this.#root.bindings.set(n.text, n) // default / namespace local
        return
      }
      if (n.type === 'import_specifier') {
        const local = n.child('alias') ?? n.child('name')
        if (local?.type === 'identifier') this.#root.bindings.set(local.text, local)
        return
      }
      for (const child of n.allChildren) walk(child)
    }
    walk(node)
  }

  /** Bind every name a binding pattern introduces; abstain on an unknown pattern form. */
  #bindPattern(node: RichNode | null, scope: Scope): void {
    if (!node) return
    switch (node.type) {
      case 'identifier':
        scope.bindings.set(node.text, node)
        return
      case 'shorthand_property_identifier_pattern':
        scope.bindings.set(node.text, node)
        return
      case 'object_pattern':
        for (const child of node.children) {
          if (child.type === 'pair_pattern') this.#bindPattern(child.child('value'), scope)
          else this.#bindPattern(child, scope)
        }
        return
      case 'array_pattern':
        for (const child of node.children) this.#bindPattern(child, scope)
        return
      case 'rest_pattern':
        this.#bindPattern(node.children[0] ?? null, scope)
        return
      case 'assignment_pattern':
      case 'object_assignment_pattern':
        this.#bindPattern(node.child('left') ?? node.children[0] ?? null, scope)
        return
      default:
        this.#abstain = true // a binding form we don't model — abstain rather than mis-resolve
    }
  }
}

/** TS wraps params as `required_parameter`/`optional_parameter` { pattern }; JS is the bare pattern. */
function unwrapParameter(param: RichNode): RichNode {
  if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
    return param.child('pattern') ?? param.children[0] ?? param
  }
  return param
}
