/** Notion-style formulas such as `prop("Estimate") * 2` or
 *  `if(prop("Done"), "✓", concat(prop("Name"), "!"))`: parsing to plain data and
 *  evaluating against a row. Pure. */

export type FormulaValue = number | string | boolean | null

export type Expr =
  | Readonly<{ _tag: 'Literal'; value: FormulaValue }>
  | Readonly<{ _tag: 'Call'; name: string; args: ReadonlyArray<Expr> }>
  | Readonly<{ _tag: 'Unary'; op: '-' | '!'; arg: Expr }>
  | Readonly<{ _tag: 'Binary'; op: string; left: Expr; right: Expr }>
  | Readonly<{ _tag: 'Conditional'; test: Expr; then: Expr; otherwise: Expr }>

export const MAX_FORMULA = 1000

/** Each function with its least and most arguments. */
export const FUNCTIONS: Readonly<Record<string, readonly [number, number]>> = {
  prop: [1, 1], if: [3, 3], ifs: [3, 99], empty: [1, 1], not: [1, 1],
  concat: [1, 99], length: [1, 1], lower: [1, 1], upper: [1, 1], trim: [1, 1], contains: [2, 2],
  replace: [3, 3], replaceall: [3, 3], substring: [2, 3], format: [1, 1], tonumber: [1, 1],
  round: [1, 2], floor: [1, 1], ceil: [1, 1], abs: [1, 1], sqrt: [1, 1], pow: [2, 2],
  min: [1, 99], max: [1, 99], sum: [1, 99],
}

class FormulaError extends Error {}

const fail = (message: string): never => {
  throw new FormulaError(message)
}

type Token = Readonly<{ kind: 'number'; value: number } | { kind: 'text'; value: string } | { kind: 'name'; value: string } | { kind: 'op'; value: string }>

const OPS = ['==', '!=', '>=', '<=', '&&', '||', '+', '-', '*', '/', '%', '^', '>', '<', '!', '(', ')', ',', '?', ':', '=']

const tokenize = (source: string): ReadonlyArray<Token> => {
  const tokens: Array<Token> = []
  let at = 0
  while (at < source.length) {
    const rest = source.slice(at)
    const char = source.charAt(at)
    const space = /^\s+/.exec(rest)?.[0]
    const number = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(rest)?.[0]
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)?.[0]
    if (space !== undefined) {
      at += space.length
    } else if (number !== undefined) {
      tokens.push({ kind: 'number', value: Number(number) })
      at += number.length
    } else if (name !== undefined) {
      tokens.push({ kind: 'name', value: name })
      at += name.length
    } else if (char === '"') {
      let text = ''
      at += 1
      while (at < source.length && source.charAt(at) !== '"') {
        if (source.charAt(at) === '\\' && at + 1 < source.length) at += 1
        text += source.charAt(at)
        at += 1
      }
      if (at >= source.length) fail('A text is missing its closing "')
      tokens.push({ kind: 'text', value: text })
      at += 1
    } else {
      const op = OPS.find(entry => rest.startsWith(entry)) ?? fail(`Unexpected "${char}"`)
      tokens.push({ kind: 'op', value: op })
      at += op.length
    }
  }
  return tokens
}

const KEYWORD_OPS: Readonly<Record<string, string>> = { and: '&&', or: '||', not: '!' }

const parseTokens = (tokens: ReadonlyArray<Token>): Expr => {
  let at = 0
  const peek = (): Token | undefined => tokens[at]
  const isOp = (...ops: ReadonlyArray<string>): string | null => {
    const token = peek()
    if (token?.kind === 'op' && ops.includes(token.value)) return token.value
    if (token?.kind === 'name' && ops.includes(KEYWORD_OPS[token.value.toLowerCase()] ?? '') && !(tokens[at + 1]?.kind === 'op' && tokens[at + 1]?.value === '(')) return KEYWORD_OPS[token.value.toLowerCase()] ?? null
    return null
  }
  const expect = (op: string): void => {
    if (isOp(op) === null) fail(peek() === undefined ? `Expected "${op}" at the end` : `Expected "${op}"`)
    at += 1
  }
  const binary = (next: () => Expr, ...ops: ReadonlyArray<string>) => (): Expr => {
    let left = next()
    for (let op = isOp(...ops); op !== null; op = isOp(...ops)) {
      at += 1
      left = { _tag: 'Binary', op: op === '=' ? '==' : op, left, right: next() }
    }
    return left
  }
  const primary = (): Expr => {
    const token = peek() ?? fail('The formula ends too early')
    at += 1
    if (token.kind === 'number') return { _tag: 'Literal', value: token.value }
    if (token.kind === 'text') return { _tag: 'Literal', value: token.value }
    if (token.kind === 'op') {
      if (token.value !== '(') return fail(`Unexpected "${token.value}"`)
      const inner = conditional()
      expect(')')
      return inner
    }
    const lower = token.value.toLowerCase()
    if (lower === 'true' || lower === 'false') return { _tag: 'Literal', value: lower === 'true' }
    const arity = FUNCTIONS[lower] ?? fail(`Unknown function "${token.value}"`)
    expect('(')
    const args: Array<Expr> = []
    if (isOp(')') === null) {
      args.push(conditional())
      while (isOp(',') !== null) {
        at += 1
        args.push(conditional())
      }
    }
    expect(')')
    if (args.length < arity[0] || args.length > arity[1]) fail(`${token.value}() takes ${arity[0] === arity[1] ? arity[0] : `${arity[0]} or more`} argument${arity[1] === 1 ? '' : 's'}`)
    return { _tag: 'Call', name: lower, args }
  }
  const power = (): Expr => {
    const base = primary()
    if (isOp('^') === null) return base
    at += 1
    return { _tag: 'Binary', op: '^', left: base, right: unary() }
  }
  const unary = (): Expr => {
    const op = isOp('-', '!')
    if (op === null) return power()
    at += 1
    return { _tag: 'Unary', op: op === '-' ? '-' : '!', arg: unary() }
  }
  const product = binary(unary, '*', '/', '%')
  const total = binary(product, '+', '-')
  const comparison = binary(total, '>', '<', '>=', '<=')
  const equality = binary(comparison, '==', '!=', '=')
  const and = binary(equality, '&&')
  const or = binary(and, '||')
  const conditional = (): Expr => {
    const test = or()
    if (isOp('?') === null) return test
    at += 1
    const then = conditional()
    expect(':')
    return { _tag: 'Conditional', test, then, otherwise: conditional() }
  }
  if (tokens.length === 0) fail('The formula is empty')
  const expr = conditional()
  const left = peek()
  if (left !== undefined) fail(`Unexpected "${left.value}"`)
  return expr
}

/** The formula as data, or why it can't be read. */
export const parse = (source: string): Expr | string => {
  if (source.length > MAX_FORMULA) return `A formula has up to ${MAX_FORMULA} characters.`
  try {
    return parseTokens(tokenize(source))
  } catch (error) {
    return error instanceof FormulaError ? error.message : 'That formula could not be read.'
  }
}

export const toText = (value: FormulaValue): string =>
  value === null ? '' : typeof value === 'number' ? String(Number(value.toFixed(10))) : String(value)

const num = (value: FormulaValue, name: string): number =>
  typeof value === 'number' ? value : value === null ? fail(`${name} needs a number, not an empty value`) : fail(`${name} needs a number`)

const bool = (value: FormulaValue, name: string): boolean => (typeof value === 'boolean' ? value : fail(`${name} needs true or false`))

const finite = (n: number): FormulaValue => (Number.isFinite(n) ? n : null)

/** A property's value by name; undefined when no property has that name. */
export type Lookup = (name: string) => FormulaValue | undefined

const run = (expr: Expr, lookup: Lookup): FormulaValue => {
  const go = (inner: Expr): FormulaValue => run(inner, lookup)
  switch (expr._tag) {
    case 'Literal': return expr.value
    case 'Conditional': return bool(go(expr.test), 'A condition') ? go(expr.then) : go(expr.otherwise)
    case 'Unary': return expr.op === '-' ? -num(go(expr.arg), '-') : !bool(go(expr.arg), 'not')
    case 'Binary': {
      if (expr.op === '&&') return bool(go(expr.left), 'and') && bool(go(expr.right), 'and')
      if (expr.op === '||') return bool(go(expr.left), 'or') || bool(go(expr.right), 'or')
      const left = go(expr.left)
      const right = go(expr.right)
      switch (expr.op) {
        case '==': return left === right
        case '!=': return left !== right
        case '+': return typeof left === 'string' || typeof right === 'string' ? toText(left) + toText(right) : finite(num(left, '+') + num(right, '+'))
        case '-': return finite(num(left, '-') - num(right, '-'))
        case '*': return finite(num(left, '*') * num(right, '*'))
        case '/': return finite(num(left, '/') / num(right, '/'))
        case '%': return finite(num(left, '%') % num(right, '%'))
        case '^': return finite(num(left, '^') ** num(right, '^'))
        default: {
          if (typeof left === 'string' && typeof right === 'string') return expr.op === '>' ? left > right : expr.op === '<' ? left < right : expr.op === '>=' ? left >= right : left <= right
          const a = num(left, expr.op)
          const b = num(right, expr.op)
          return expr.op === '>' ? a > b : expr.op === '<' ? a < b : expr.op === '>=' ? a >= b : a <= b
        }
      }
    }
    case 'Call': {
      const [first = null, second = null, third = null] = expr.name === 'if' || expr.name === 'ifs' ? [] : expr.args.map(go)
      const all = (): ReadonlyArray<number> => expr.args.map(arg => num(go(arg), `${expr.name}()`))
      switch (expr.name) {
        case 'prop': {
          const name = toText(first)
          const value = lookup(name)
          return value === undefined ? fail(`There is no property "${name}"`) : value
        }
        case 'if': {
          const [test, then, otherwise] = expr.args
          return test === undefined || then === undefined || otherwise === undefined ? null : bool(go(test), 'if()') ? go(then) : go(otherwise)
        }
        case 'ifs': {
          for (let at = 0; at + 1 < expr.args.length; at += 2) {
            const test = expr.args[at]
            const then = expr.args[at + 1]
            if (test !== undefined && then !== undefined && bool(go(test), 'ifs()')) return go(then)
          }
          const otherwise = expr.args.length % 2 === 1 ? expr.args.at(-1) : undefined
          return otherwise === undefined ? null : go(otherwise)
        }
        case 'empty': return first === null || first === '' || first === false || first === 0
        case 'not': return !bool(first, 'not()')
        case 'concat': return expr.args.map(arg => toText(go(arg))).join('')
        case 'length': return toText(first).length
        case 'lower': return toText(first).toLowerCase()
        case 'upper': return toText(first).toUpperCase()
        case 'trim': return toText(first).trim()
        case 'contains': return toText(first).includes(toText(second))
        case 'replace': return toText(first).replace(toText(second), toText(third))
        case 'replaceall': return toText(first).split(toText(second)).join(toText(third))
        case 'substring': return toText(first).substring(num(second, 'substring()'), third === null ? undefined : num(third, 'substring()'))
        case 'format': return toText(first)
        case 'tonumber': {
          const n = typeof first === 'boolean' ? Number(first) : Number(toText(first).trim())
          return toText(first).trim() === '' || !Number.isFinite(n) ? null : n
        }
        case 'round': {
          const places = second === null ? 0 : Math.round(num(second, 'round()'))
          return finite(Math.round(num(first, 'round()') * 10 ** places) / 10 ** places)
        }
        case 'floor': return Math.floor(num(first, 'floor()'))
        case 'ceil': return Math.ceil(num(first, 'ceil()'))
        case 'abs': return Math.abs(num(first, 'abs()'))
        case 'sqrt': return finite(Math.sqrt(num(first, 'sqrt()')))
        case 'pow': return finite(num(first, 'pow()') ** num(second, 'pow()'))
        case 'min': return Math.min(...all())
        case 'max': return Math.max(...all())
        case 'sum': return finite(all().reduce((total, n) => total + n, 0))
        default: return fail(`Unknown function "${expr.name}"`)
      }
    }
  }
}

export type Evaluated = Readonly<{ _tag: 'Ok'; value: FormulaValue } | { _tag: 'Error'; message: string }>

export const evaluate = (expr: Expr, lookup: Lookup): Evaluated => {
  try {
    return { _tag: 'Ok', value: run(expr, lookup) }
  } catch (error) {
    return { _tag: 'Error', message: error instanceof FormulaError ? error.message : 'That formula could not be worked out.' }
  }
}
