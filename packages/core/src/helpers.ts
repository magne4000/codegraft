import type { RichNode } from './types.js'
import { assert } from './assert.js'

// TypeScript type-position navigation, so a rewrite needn't know tree-sitter field
// names. Public; `codegraft build` imports any a rewrite references (§8).

export function getPropertySignatures(objectType: RichNode): RichNode[] {
  return objectType.children.filter((child) => child.type === 'property_signature')
}

export function getPropertyName(signature: RichNode): string | null {
  return signature.child('name')?.text ?? null
}

/**
 * The `{ name, type }` branches of an object type, with each property's `: T` annotation
 * unwrapped to `T`. The canonical use is collapsing a `BATI.If<{ featureA: T; default: U }>`
 * conditional type to the branch whose name is an enabled feature (else `default`).
 */
export function getConditionalBranches(objectType: RichNode): Array<{ name: string; type: RichNode }> {
  const branches: Array<{ name: string; type: RichNode }> = []
  for (const signature of getPropertySignatures(objectType)) {
    const type = signature.child('type')?.children[0]
    if (!type) continue // a property without a type annotation isn't a branch
    const name = getPropertyName(signature)
    assert(name !== null, 'a property_signature is always named')
    branches.push({ name, type })
  }
  return branches
}
