import { assert, describe, it } from '@effect/vitest'

import { Schema as S } from 'effect'

import { Document, PLAIN, type RichText } from '@/app/editor/schema'
import * as T from '@/app/editor/text'

const bold = { ...PLAIN, bold: true }
const link = { ...PLAIN, link: 'https://example.com' }
const text = (value: string, marks = PLAIN): RichText => T.plain(value, marks)
const mention: RichText = [{ _tag: 'PageMention', pageId: 'p1', marks: PLAIN }]

describe('rich text', () => {
  it('measures atoms as one caret step', () => {
    const value = T.concat(text('ab'), mention, text('cd'))
    assert.strictEqual(T.lengthOf(value), 5)
    assert.strictEqual(T.caretText(value), 'ab\uFFFCcd')
    assert.deepStrictEqual(T.slice(value, 2, 3), mention)
  })

  it('merges neighbours with the same marks and drops empty text', () => {
    assert.deepStrictEqual(T.concat(text('a'), text(''), text('b')), text('ab'))
    assert.deepStrictEqual(T.normalize([{ _tag: 'Text', text: '', marks: bold }]), [])
  })

  it('inserts, removes and splits by offset', () => {
    const value = text('hello world')
    assert.deepStrictEqual(T.insertText(value, 5, ',', PLAIN), text('hello, world'))
    assert.deepStrictEqual(T.remove(value, 5, 11), text('hello'))
    assert.deepStrictEqual(T.splitAt(value, 6), [text('hello '), text('world')])
  })

  it('toggles a mark on when part of the range lacks it, else off', () => {
    const value = T.concat(text('ab', bold), text('cd'))
    const all = T.toggleMark(value, 0, 4, 'bold')
    assert.deepStrictEqual(all, text('abcd', bold))
    assert.deepStrictEqual(T.toggleMark(all, 0, 4, 'bold'), text('abcd'))
    assert.isTrue(T.hasMark(all, 1, 3, 'bold'))
  })

  it('marks a range with a discussion that typing extends only inside it', () => {
    const value = T.setComment(text('one two three'), 4, 7, 'c1')
    assert.deepStrictEqual(value.map(piece => piece.marks.comment), [null, 'c1', null])
    assert.strictEqual(T.typingMarksAt(value, 5).comment, 'c1')
    assert.isNull(T.typingMarksAt(value, 7).comment)
    assert.isNull(T.typingMarksAt(T.setComment(text('ab'), 0, 2, 'c1'), 0).comment)
    assert.deepStrictEqual(T.setComment(value, 0, 13, null), text('one two three'))
  })

  it('reads documents saved before comment marks existed', () => {
    const decoded = S.decodeUnknownSync(Document)([{ id: 'b', kind: { _tag: 'Paragraph' }, color: 'default', children: [], text: [{ _tag: 'Text', text: 'old', marks: { bold: false, italic: false, underline: false, strike: false, code: false, link: null, color: 'default' } }] }])
    assert.isNull(decoded[0]!.text[0]!.marks.comment)
  })

  it('does not grow links or inline code past their end', () => {
    const value = T.concat(text('see '), text('docs', link))
    assert.strictEqual(T.typingMarksAt(value, 8).link, null)
    assert.strictEqual(T.typingMarksAt(value, 6).link, 'https://example.com')
    assert.isTrue(T.typingMarksAt(text('ab', bold), 2).bold)
  })

  it('finds the whole link around the caret', () => {
    const value = T.concat(text('see '), text('docs', link), text(' now'))
    assert.deepStrictEqual(T.linkRange(value, 6), [4, 8])
    assert.strictEqual(T.linkRange(value, 1), null)
  })

  it('steps by words and keeps emoji whole', () => {
    assert.strictEqual(T.wordStartBefore('hello big world', 15), 10)
    assert.strictEqual(T.wordStartBefore('hello big ', 10), 6)
    assert.strictEqual(T.wordEndAfter('hello big', 0), 5)
    assert.strictEqual(T.charBefore('a🔥', 3), 1)
    assert.strictEqual(T.charAfter('🔥a', 0), 2)
  })
})
