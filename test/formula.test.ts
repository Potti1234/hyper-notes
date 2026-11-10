import { assert, describe, it } from '@effect/vitest'

import { evaluate, parse } from '@/app/formula'

const props: Readonly<Record<string, number | string | boolean | null>> = { Estimate: 3, Name: 'Ship it', Done: true, Empty: null }
const value = (source: string) => {
  const expr = parse(source)
  if (typeof expr === 'string') return `parse: ${expr}`
  const result = evaluate(expr, name => props[name])
  return result._tag === 'Ok' ? result.value : `error: ${result.message}`
}

describe('formulas', () => {
  it('works out arithmetic with precedence', () => {
    assert.strictEqual(value('1 + 2 * 3'), 7)
    assert.strictEqual(value('(1 + 2) * 3'), 9)
    assert.strictEqual(value('2 ^ 3 ^ 2'), 512)
    assert.strictEqual(value('-prop("Estimate") + 10 % 4'), -1)
    assert.isNull(value('1 / 0'))
  })

  it('reads properties, text and logic', () => {
    assert.strictEqual(value('prop("Estimate") * 2'), 6)
    assert.strictEqual(value('concat(prop("Name"), "!")'), 'Ship it!')
    assert.strictEqual(value('prop("Name") + " " + prop("Estimate")'), 'Ship it 3')
    assert.strictEqual(value('if(prop("Done"), "yes", "no")'), 'yes')
    assert.strictEqual(value('prop("Done") and not false ? upper("a") : "b"'), 'A')
    assert.strictEqual(value('ifs(prop("Estimate") > 5, "big", prop("Estimate") > 2, "medium", "small")'), 'medium')
    assert.strictEqual(value('length("abc") == 3'), true)
    assert.strictEqual(value('empty(prop("Empty"))'), true)
    assert.strictEqual(value('round(10 / 3, 2)'), 3.33)
    assert.strictEqual(value('max(1, prop("Estimate"), 2) + min(4, 5)'), 7)
    assert.strictEqual(value('replaceAll("a-b-c", "-", "+")'), 'a+b+c')
    assert.strictEqual(value('toNumber("42") + 1'), 43)
  })

  it('explains formulas it cannot read or work out', () => {
    assert.strictEqual(value(''), 'parse: The formula is empty')
    assert.strictEqual(value('1 +'), 'parse: The formula ends too early')
    assert.strictEqual(value('nope(1)'), 'parse: Unknown function "nope"')
    assert.strictEqual(value('if(true, 1)'), 'parse: if() takes 3 arguments')
    assert.strictEqual(value('"open'), 'parse: A text is missing its closing "')
    assert.strictEqual(value('1 2'), 'parse: Unexpected "2"')
    assert.strictEqual(value('prop("Missing")'), 'error: There is no property "Missing"')
    assert.strictEqual(value('prop("Name") * 2'), 'error: * needs a number')
    assert.strictEqual(value('if(1, 2, 3)'), 'error: if() needs true or false')
  })
})
