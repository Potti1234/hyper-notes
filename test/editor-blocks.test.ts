import { assert, describe, it } from '@effect/vitest'

import * as B from '@/app/editor/blocks'
import type { Block, Document } from '@/app/editor/schema'

const p = (id: string, children: ReadonlyArray<Block> = []): Block => ({ ...B.paragraph(id, id), children })
const shape = (doc: Document): unknown => doc.map(entry => (entry.children.length === 0 ? entry.id : { [entry.id]: shape(entry.children) }))
let counter = 0
const nextId = () => `n${++counter}`

describe('block tree', () => {
  const doc = [p('a'), p('b', [p('b1'), p('b2')]), p('c')]

  it('finds blocks, parents and paths', () => {
    assert.deepStrictEqual(B.pathOf(doc, 'b2'), [1, 1])
    assert.strictEqual(B.parentOf(doc, 'b1')?.id, 'b')
    assert.strictEqual(B.parentOf(doc, 'a'), null)
    assert.strictEqual(B.parentOf(doc, 'zz'), undefined)
  })

  it('reads in order, skipping closed toggles', () => {
    const toggle: Block = { ...B.block('t', { _tag: 'Toggle', isOpen: false }), children: [p('t1')] }
    assert.deepStrictEqual(B.visible([...doc, toggle]).map(entry => [entry.block.id, entry.depth]), [['a', 0], ['b', 0], ['b1', 1], ['b2', 1], ['c', 0], ['t', 0]])
    assert.strictEqual(B.nextText(doc, 'b2')?.id, 'c')
    assert.strictEqual(B.previousText(doc, 'b1')?.id, 'b')
  })

  it('keeps untouched blocks as the same objects', () => {
    const next = B.update(doc, 'b2', entry => ({ ...entry, color: 'red' }))
    assert.strictEqual(next[0], doc[0])
    assert.strictEqual(next[2], doc[2])
    assert.strictEqual(next[1]?.children[0], doc[1]?.children[0])
    assert.strictEqual(B.update(doc, 'missing', entry => entry), doc)
  })

  it('indents under the block before and outdents after the parent', () => {
    assert.deepStrictEqual(shape(B.indent(doc, 'c')), ['a', { b: ['b1', 'b2', 'c'] }])
    assert.deepStrictEqual(shape(B.indent(doc, 'a')), shape(doc))
    assert.deepStrictEqual(shape(B.outdent(doc, 'b1')), ['a', { b: ['b2'] }, 'b1', 'c'])
    assert.deepStrictEqual(shape(B.outdent(doc, 'a')), shape(doc))
  })

  it('opens a closed toggle it indents into', () => {
    const toggle = B.block('t', { _tag: 'Toggle', isOpen: false })
    const next = B.indent([toggle, p('x')], 'x')
    assert.deepStrictEqual(next[0]?.kind, { _tag: 'Toggle', isOpen: true })
  })

  it('moves blocks up and down, out of their parent at the ends', () => {
    assert.deepStrictEqual(shape(B.moveBy(doc, 'c', -1)), ['a', 'c', { b: ['b1', 'b2'] }])
    assert.deepStrictEqual(shape(B.moveBy(doc, 'b1', -1)), ['a', 'b1', { b: ['b2'] }, 'c'])
    assert.deepStrictEqual(shape(B.moveBy(doc, 'b2', 1)), ['a', { b: ['b1'] }, 'b2', 'c'])
  })

  it('drops blocks before, after, inside and beside others', () => {
    assert.deepStrictEqual(shape(B.moveBlocks(doc, ['a'], 'c', 'after', nextId)), [{ b: ['b1', 'b2'] }, 'c', 'a'])
    assert.deepStrictEqual(shape(B.moveBlocks(doc, ['c'], 'a', 'inside', nextId)), [{ a: ['c'] }, { b: ['b1', 'b2'] }])
    assert.strictEqual(B.moveBlocks(doc, ['b'], 'b1', 'after', nextId), doc)
    const columns = B.moveBlocks(doc, ['c'], 'a', 'right', nextId)
    assert.strictEqual(columns[0]?.kind._tag, 'ColumnList')
    assert.deepStrictEqual(columns[0]?.children.map(column => column.children.map(entry => entry.id)), [['a'], ['c']])
  })

  it('dissolves columns left with one column', () => {
    const columns = B.moveBlocks(doc, ['c'], 'a', 'right', nextId)
    const [without] = B.remove(columns, 'c')
    assert.deepStrictEqual(shape(B.tidyColumns(without)), ['a', { b: ['b1', 'b2'] }])
  })

  it('numbers runs of numbered items', () => {
    const n = (id: string) => B.block(id, { _tag: 'Numbered' })
    const list = [n('1'), n('2'), p('x'), n('3')]
    assert.deepStrictEqual([0, 1, 3].map(index => B.listNumber(list, index)), [1, 2, 1])
  })
})
