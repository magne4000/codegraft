import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { Language, Parser as TreeSitter } from 'web-tree-sitter'
import type { Tree } from 'web-tree-sitter'
import type { GrammarId } from './types.js'
import { assert } from './assert.js'

// web-tree-sitter resolves the grammar `.wasm` from its npm package at runtime; the
// engine wasm (`tree-sitter.wasm`) is self-located by `Parser.init()`.
const require = createRequire(import.meta.url)

/**
 * The npm specifier of each built-in grammar's `.wasm`. `tree-sitter-typescript`
 * ships both the `typescript` and `tsx` grammars. These packages are optional peer
 * dependencies (§2): the specifier is only resolved when a grammar is actually
 * requested, and a missing package becomes an actionable error in `resolveBuiltinWasm`.
 */
const BUILTIN_WASM: Record<GrammarId, string> = {
  javascript: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  html: 'tree-sitter-html/tree-sitter-html.wasm',
  css: 'tree-sitter-css/tree-sitter-css.wasm',
}

let initPromise: Promise<void> | null = null
let parser: TreeSitter | null = null
const languages = new Map<string, Language>()
const loads = new Map<string, Promise<Language>>()
const subtypeCache = new Map<string, Map<string, string[]>>()

/** Idempotent. Loads the web-tree-sitter WASM runtime once per process. */
async function init(): Promise<void> {
  initPromise ??= TreeSitter.init()
  await initPromise
}

/**
 * Lazily load a grammar, idempotent per `id`. Built-in {@link GrammarId}s resolve
 * their own `.wasm`; an external grammar (e.g. a {@link ZoneSplitter}'s shell
 * grammar) passes its `wasmPath` and an arbitrary `id` used as the cache key.
 */
async function loadGrammar(id: GrammarId | string, wasmPath?: string): Promise<void> {
  if (languages.has(id)) return
  let pending = loads.get(id)
  if (!pending) {
    pending = loadLanguage(id, wasmPath)
    loads.set(id, pending)
  }
  languages.set(id, await pending)
}

async function loadLanguage(id: string, wasmPath?: string): Promise<Language> {
  await init()
  const path = wasmPath ?? resolveBuiltinWasm(id)
  return Language.load(readFileSync(path))
}

/** The npm package that ships a built-in grammar's wasm — the optional peer (§2) a
 *  consumer must install for that grammar. Derived from the single wasm registry. */
export function grammarPackage(id: GrammarId): string {
  const spec = BUILTIN_WASM[id]
  return spec.slice(0, spec.indexOf('/'))
}

function resolveBuiltinWasm(id: string): string {
  const spec = BUILTIN_WASM[id as GrammarId]
  assert(spec, `grammar '${id}' is not built in; a ZoneSplitter must pass its own wasmPath to loadGrammar`)
  try {
    return require.resolve(spec)
  } catch {
    const pkg = spec.slice(0, spec.indexOf('/'))
    throw new Error(`[trast] grammar '${id}' requires the optional peer '${pkg}'; add it to your dependencies`)
  }
}

/** Parse `source` with an already-loaded grammar. Reuses one parser instance; safe
 *  because transforms run synchronously and trees are independent of the parser. */
function parse(source: string, id: GrammarId | string): Tree {
  const language = languages.get(id)
  assert(language, `grammar '${id}' not loaded; call loadGrammar('${id}') first`)
  parser ??= new TreeSitter()
  parser.setLanguage(language)
  const tree = parser.parse(source)
  assert(tree, `parsing produced no tree for grammar '${id}'`)
  return tree
}

/** The subtypes of a grammar supertype, expanded transitively (`statement` → `declaration` →
 *  `lexical_declaration`, …), or `[]` if `typeName` is not a supertype. Intermediate supertype
 *  names are kept too — harmless, since only concrete types appear in a tree. Memoised per grammar,
 *  so a `find` can call it per node. */
function subtypesOf(id: GrammarId | string, typeName: string): string[] {
  const language = languages.get(id)
  assert(language, `grammar '${id}' not loaded; call loadGrammar('${id}') first`)
  let perGrammar = subtypeCache.get(id)
  if (!perGrammar) subtypeCache.set(id, (perGrammar = new Map()))
  let names = perGrammar.get(typeName)
  if (!names) {
    const supertypes = new Set(language.supertypes)
    const root = language.idForNodeType(typeName, true)
    const out = new Set<string>()
    const queue = root !== null && supertypes.has(root) ? [root] : []
    for (let sym = queue.pop(); sym !== undefined; sym = queue.pop()) {
      for (const sub of language.subtypes(sym)) {
        const name = language.nodeTypeForId(sub)
        if (!name || out.has(name)) continue
        out.add(name)
        if (supertypes.has(sub)) queue.push(sub) // nested supertype — expand to its leaves
      }
    }
    perGrammar.set(typeName, (names = [...out]))
  }
  return names
}

/** Singleton confining every web-tree-sitter init/load concern to this module. */
export const Parser = { init, loadGrammar, parse, subtypesOf }
