import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Language, Parser as TreeSitter } from 'web-tree-sitter'
import type { Tree } from 'web-tree-sitter'
import type { GrammarId } from './types.js'
import { assert } from './assert.js'

// web-tree-sitter resolves the grammar `.wasm` from its npm package at runtime; the
// engine wasm (`tree-sitter.wasm`) is self-located by `Parser.init()`.
const require = createRequire(import.meta.url)

/**
 * The whole JS/TS/TSX family parses with the **tsx** grammar at runtime: it is a superset (plain JS,
 * JSX, and every TS form — generics, generic arrows, `as`-casts, `satisfies`), the lone exception
 * being the JSX-ambiguous angle-bracket cast `<T>x`, which modern code writes `x as T`. The
 * `javascript`/`typescript` {@link GrammarId}s survive only in the compile-time node-type unions
 * (narrower `find`/`type` typings); {@link runtimeGrammar} routes them here.
 *
 * tsx is **vendored** (resolved relative to this module): npm `tree-sitter-typescript` ships an
 * ABI-14 wasm that web-tree-sitter loads without supertype metadata (so `find` can't expand
 * `expression` etc.); we ship an ABI-15 rebuild — see `scripts/regen-ts-wasm.sh` — so it imposes no
 * peer dependency.
 */
const VENDORED_WASM: Partial<Record<GrammarId, string>> = {
  tsx: 'tree-sitter-tsx.wasm',
  // tree-sitter-yaml ships no prebuilt wasm on the bare `tree-sitter-yaml` package; we vendor the
  // one from `@tree-sitter-grammars/tree-sitter-yaml` so YAML imposes no peer dependency.
  yaml: 'tree-sitter-yaml.wasm',
}

/**
 * The npm specifier of each remaining built-in grammar's `.wasm` (these already ship the ABI we
 * need). Optional peer dependencies: resolved only when the grammar is requested, and a missing
 * package becomes an actionable error in `resolveBuiltinWasm`.
 */
const PEER_WASM: Partial<Record<GrammarId, string>> = {
  html: 'tree-sitter-html/tree-sitter-html.wasm',
  css: 'tree-sitter-css/tree-sitter-css.wasm',
}

/** The grammar a {@link GrammarId} is parsed with at runtime — the JS/TS/TSX family shares the tsx
 *  superset (see {@link VENDORED_WASM}), every other id is itself. So `javascript`/`typescript` never
 *  load a grammar of their own; they fold onto the single tsx language. */
function runtimeGrammar(id: GrammarId | string): GrammarId | string {
  return id === 'javascript' || id === 'typescript' ? 'tsx' : id
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
 * Lazily load a grammar, idempotent. The JS/TS/TSX family folds onto the tsx grammar
 * ({@link runtimeGrammar}); every other built-in {@link GrammarId} resolves its own `.wasm`, and an
 * external grammar (e.g. a {@link ZoneSplitter}'s shell) passes its `wasmPath` under an arbitrary `id`.
 */
async function loadGrammar(id: GrammarId | string, wasmPath?: string): Promise<void> {
  const key = runtimeGrammar(id)
  if (languages.has(key)) return
  let pending = loads.get(key)
  if (!pending) {
    pending = loadLanguage(key, wasmPath)
    loads.set(key, pending)
  }
  languages.set(key, await pending)
}

async function loadLanguage(id: string, wasmPath?: string): Promise<Language> {
  await init()
  const path = wasmPath ?? resolveBuiltinWasm(id)
  return Language.load(readFileSync(path))
}

function resolveBuiltinWasm(id: string): string {
  const vendored = VENDORED_WASM[id as GrammarId]
  if (vendored) return fileURLToPath(new URL(`../wasm/${vendored}`, import.meta.url))
  const spec = PEER_WASM[id as GrammarId]
  assert(spec, `grammar '${id}' is not built in; a ZoneSplitter must pass its own wasmPath to loadGrammar`)
  try {
    return require.resolve(spec)
  } catch {
    const pkg = spec.slice(0, spec.indexOf('/'))
    throw new Error(`[codegraft] grammar '${id}' requires the optional peer '${pkg}'; add it to your dependencies`)
  }
}

/** Parse `source` with an already-loaded grammar. Reuses one parser instance; safe
 *  because transforms run synchronously and trees are independent of the parser. */
function parse(source: string, id: GrammarId | string): Tree {
  const language = languages.get(runtimeGrammar(id))
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
  const key = runtimeGrammar(id)
  const language = languages.get(key)
  assert(language, `grammar '${id}' not loaded; call loadGrammar('${id}') first`)
  let perGrammar = subtypeCache.get(key)
  if (!perGrammar) subtypeCache.set(key, (perGrammar = new Map()))
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
