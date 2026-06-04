import type { RichNode } from './types.js'

/**
 * Navigation helpers for TypeScript type-position rewrites (e.g. collapsing a
 * `BATI.If<{ … }>` conditional type). Thin wrappers over `child(field)` so a rewrite
 * needn't know tree-sitter-typescript field names. Part of core's public API; `trast
 * build` imports any of these a rewrite references (§8).
 */

/** The `property_signature` members of an `object_type`. */
export function getPropertySignatures(objectType: RichNode): RichNode[] {
  return objectType.children.filter((child) => child.type === 'property_signature')
}

/** The name of a `property_signature` (its `name` field), or `null` if it has none. */
export function getPropertyName(signature: RichNode): string | null {
  return signature.child('name')?.text ?? null
}

/**
 * The `{ name, type }` branches of an object type — pairs each property's name with the
 * type inside its annotation (the `: T` is unwrapped to `T`), ready to select from in a
 * rewrite. The canonical use is a `BATI.If<{ featureA: T; default: U }>` conditional
 * type: pick the branch whose name is an enabled feature, else `default`.
 */
export function getConditionalBranches(objectType: RichNode): Array<{ name: string; type: RichNode }> {
  const branches: Array<{ name: string; type: RichNode }> = []
  for (const signature of getPropertySignatures(objectType)) {
    const name = getPropertyName(signature)
    const type = signature.child('type')?.children[0] // unwrap the `: T` type_annotation
    if (name !== null && type) branches.push({ name, type })
  }
  return branches
}
