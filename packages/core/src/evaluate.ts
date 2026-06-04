import type { RichNode } from './types.js'
import { Parser } from './parser.js'
import { wrapNode } from './rich-node.js'
import { assert } from './assert.js'

/**
 * Evaluate a build-time condition against a context value — without `eval`.
 *
 * The expression's identifier root resolves to `context`, so `$$.BATI.has("auth")`
 * computes `context.BATI.has("auth")`, and `!` / `&&` / `||` / comparisons compose as
 * in JS. The input is either a parsed node (a captured `if`/ternary condition) or a
 * string (a directive comment's expression, parsed as TypeScript).
 *
 * The supported subset is exactly what a pure-over-context condition needs; anything
 * else — a runtime variable, an unsupported operator — asserts and names the offending
 * node, so a condition that isn't statically decidable fails loudly rather than wrong.
 */
export function evaluate(input: RichNode | string, context: unknown): unknown {
  return evalNode(typeof input === 'string' ? parseExpression(input) : input, context)
}

/** Parse a bare expression (a comment's directive) as TypeScript and unwrap it. */
function parseExpression(text: string): RichNode {
  const root = wrapNode(Parser.parse(text, 'typescript').rootNode, 'typescript', 0)
  const expression = root.children[0]?.children[0]
  assert(
    root.children[0]?.type === 'expression_statement' && expression !== undefined,
    `not an expression: '${text}'`,
  )
  return expression
}

function evalNode(node: RichNode, context: unknown): unknown {
  switch (node.type) {
    case 'parenthesized_expression':
      return evalNode(only(node), context)
    case 'unary_expression':
      assert(field(node, 'operator').text === '!', `unsupported unary operator in '${node.text}'`)
      return !evalNode(field(node, 'argument'), context)
    case 'binary_expression':
      return evalBinary(node, context)
    case 'member_expression': {
      const object = evalNode(field(node, 'object'), context) as Record<string, unknown>
      return object[field(node, 'property').text]
    }
    case 'call_expression': {
      const callee = evalNode(field(node, 'function'), context)
      assert(typeof callee === 'function', `not callable: '${field(node, 'function').text}'`)
      const args = field(node, 'arguments').children.map((arg) => evalNode(arg, context))
      return (callee as (...args: unknown[]) => unknown)(...args)
    }
    case 'identifier':
      return context // the namespace root resolves to the context value
    case 'string':
      return node.children[0]?.text ?? '' // the string_fragment, or '' for an empty string
    case 'number':
      return Number(node.text)
    case 'true':
      return true
    case 'false':
      return false
    case 'null':
      return null
    default:
      assert(false, `cannot evaluate '${node.type}' in condition '${node.text}'`)
  }
}

function evalBinary(node: RichNode, context: unknown): unknown {
  const operator = field(node, 'operator').text
  const left = () => evalNode(field(node, 'left'), context)
  const right = () => evalNode(field(node, 'right'), context)
  switch (operator) {
    case '&&':
      return left() && right()
    case '||':
      return left() || right()
    case '===':
      return left() === right()
    case '!==':
      return left() !== right()
    case '<':
      return (left() as number) < (right() as number)
    case '<=':
      return (left() as number) <= (right() as number)
    case '>':
      return (left() as number) > (right() as number)
    case '>=':
      return (left() as number) >= (right() as number)
    default:
      assert(false, `unsupported operator '${operator}' in condition '${node.text}'`)
  }
}

function field(node: RichNode, name: string): RichNode {
  const child = node.child(name)
  assert(child, `${node.type} is missing field '${name}'`)
  return child
}

function only(node: RichNode): RichNode {
  assert(node.children.length === 1, `expected a single child of '${node.type}'`)
  return node.children[0]
}
