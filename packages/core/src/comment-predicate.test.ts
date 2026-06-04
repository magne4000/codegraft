import { describe, it, expect } from 'vitest'
import { leadingCommentPredicate } from './comment-predicate.js'
import type { RichNode } from './types.js'

// The predicate reads only node.leadingComments[].text, so stubs keep this a unit test.
function node(leadingTexts: string[]): RichNode {
  return { leadingComments: leadingTexts.map((text) => ({ text })) } as unknown as RichNode
}

describe('leadingCommentPredicate', () => {
  it('returns the first matching leading comment and the regex match', () => {
    const pred = leadingCommentPredicate(/@bati:\s*(\w+)/)
    const result = pred(node(['// docs', '// @bati: auth']))
    expect(result?.comment.text).toBe('// @bati: auth')
    expect(result?.match[1]).toBe('auth')
  })

  it('returns null when no leading comment matches', () => {
    const pred = leadingCommentPredicate(/@bati/)
    expect(pred(node(['// unrelated', '// also nope']))).toBeNull()
  })

  it('returns null when there are no leading comments', () => {
    expect(leadingCommentPredicate(/x/)(node([]))).toBeNull()
  })

  it('matches an HTML directive comment via the same mechanism', () => {
    const pred = leadingCommentPredicate(/@if (\w+)/)
    expect(pred(node(['<!-- @if auth -->']))?.match[1]).toBe('auth')
  })

  it('is reusable across calls with a global-flag regex (lastIndex reset)', () => {
    const pred = leadingCommentPredicate(/@bati/g)
    const n = node(['// @bati'])
    expect(pred(n)).not.toBeNull()
    expect(pred(n)).not.toBeNull() // would be null on the 2nd call if lastIndex carried over
  })
})
