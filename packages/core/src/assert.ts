/**
 * Internal invariant check. The plan favours assertions over defensive branches for
 * unreachable states: a failed `assert` means a bug in Codegraft (or a misuse of an
 * internal API), not a recoverable runtime condition. The `asserts` predicate also
 * narrows types for the caller.
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[codegraft] ${message}`)
}
