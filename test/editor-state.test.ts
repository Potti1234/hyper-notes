import { assert, describe, it } from '@effect/vitest'

import * as B from '@/app/editor/blocks'
import { type Action, type EditorState, apply, caret, initial } from '@/app/editor/state'
import { caretText, hasMark } from '@/app/editor/text'
import * as T from '@/app/editor/text'
import type { Document } from '@/app/editor/schema'

/* The editor's keys and inputs, as Notion handles them, on the pure state
   machine (no DOM). */

const at = (doc: Document, blockId: string, offset: number): EditorState => ({ ...initial(doc, 'n'), selection: caret(blockId, offset) })
const run = (state: EditorState, ...actions: ReadonlyArray<Action>) => actions.reduce(apply, state)
const type = (state: EditorState, text: string) => [...text].reduce((next, char) => apply(next, { _tag: 'InsertText', text: char }), state)
const textOf = (state: EditorState, id: string) => caretText(B.find(state.doc, id)?.text ?? [])
const kinds = (state: EditorState) => state.doc.map(entry => entry.kind._tag)

describe('editor: typing and markdown shortcuts', () => {
  it('turns "# ", "- ", "1. ", "[] ", "> " and quotes into blocks', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [['# ', 'Heading'], ['- ', 'Bulleted'], ['* ', 'Bulleted'], ['1. ', 'Numbered'], ['[] ', 'Todo'], ['> ', 'Toggle'], ['" ', 'Quote']]
    for (const [prefix, tag] of cases) {
      const state = type(at([B.paragraph('a')], 'a', 0), `${prefix}Hi`)
      assert.strictEqual(state.doc[0]?.kind._tag, tag, prefix)
      assert.strictEqual(textOf(state, 'a'), 'Hi')
    }
    const h3 = type(at([B.paragraph('a')], 'a', 0), '### x')
    assert.deepStrictEqual(h3.doc[0]?.kind, { _tag: 'Heading', level: 3, isToggleable: false, isOpen: true })
  })

  it('makes code blocks with ``` and dividers with ---', () => {
    assert.strictEqual(type(at([B.paragraph('a')], 'a', 0), '```').doc[0]?.kind._tag, 'Code')
    const divided = type(at([B.paragraph('a')], 'a', 0), '---')
    assert.deepStrictEqual(kinds(divided), ['Divider', 'Paragraph'])
    assert.deepStrictEqual(divided.selection, caret(divided.doc[1]!.id, 0))
  })

  it('applies **bold**, *italic*, `code` and ~strike~ as they close', () => {
    const bold = type(at([B.paragraph('a')], 'a', 0), 'a **b** c')
    assert.strictEqual(textOf(bold, 'a'), 'a b c')
    const text = B.find(bold.doc, 'a')!.text
    assert.isTrue(hasMark(text, 2, 3, 'bold'))
    assert.isFalse(hasMark(text, 3, 5, 'bold'))
    assert.isTrue(hasMark(B.find(type(at([B.paragraph('a')], 'a', 0), '*x*').doc, 'a')!.text, 0, 1, 'italic'))
    assert.isTrue(hasMark(B.find(type(at([B.paragraph('a')], 'a', 0), '`x`').doc, 'a')!.text, 0, 1, 'code'))
    assert.isTrue(hasMark(B.find(type(at([B.paragraph('a')], 'a', 0), '~x~').doc, 'a')!.text, 0, 1, 'strike'))
  })

  it('leaves markdown alone inside code blocks', () => {
    const state = type(at([B.block('a', { _tag: 'Code', language: 'ts', isWrapped: false })], 'a', 0), '# **x**')
    assert.strictEqual(textOf(state, 'a'), '# **x**')
  })

  it('Ctrl+B with nothing selected makes the next characters bold', () => {
    const state = type(run(at([B.paragraph('a', 'ab')], 'a', 2), { _tag: 'ToggleMark', mark: 'bold' }), 'cd')
    assert.isTrue(hasMark(B.find(state.doc, 'a')!.text, 2, 4, 'bold'))
    assert.isFalse(hasMark(B.find(state.doc, 'a')!.text, 0, 2, 'bold'))
  })

  it('toggles a mark across blocks: on unless all of it has it', () => {
    const doc = [B.paragraph('a', 'one'), B.paragraph('b', 'two')]
    const state: EditorState = { ...initial(doc, 'n'), selection: { _tag: 'TextSelection', anchor: { blockId: 'a', offset: 1 }, focus: { blockId: 'b', offset: 2 } } }
    const once = apply(state, { _tag: 'ToggleMark', mark: 'italic' })
    assert.isTrue(hasMark(B.find(once.doc, 'a')!.text, 1, 3, 'italic'))
    assert.isTrue(hasMark(B.find(once.doc, 'b')!.text, 0, 2, 'italic'))
    const twice = apply(once, { _tag: 'ToggleMark', mark: 'italic' })
    assert.isFalse(hasMark(B.find(twice.doc, 'a')!.text, 0, 3, 'italic'))
  })
})

describe('editor: Enter and Backspace', () => {
  it('splits a block and continues lists and to-dos unchecked', () => {
    const state = run(at([B.block('a', { _tag: 'Todo', isChecked: true }, B.paragraph('x', 'buy milk').text)], 'a', 3), { _tag: 'Enter' })
    assert.deepStrictEqual(state.doc.map(entry => caretText(entry.text)), ['buy', ' milk'])
    assert.deepStrictEqual(state.doc[1]?.kind, { _tag: 'Todo', isChecked: false })
    assert.deepStrictEqual(state.selection, caret(state.doc[1]!.id, 0))
  })

  it('makes headings continue as text and an empty list item turn back into text', () => {
    assert.strictEqual(run(at([B.block('a', B.kindOf('Heading', 1), B.paragraph('x', 'Title').text)], 'a', 5), { _tag: 'Enter' }).doc[1]?.kind._tag, 'Paragraph')
    assert.strictEqual(run(at([B.block('a', { _tag: 'Bulleted' })], 'a', 0), { _tag: 'Enter' }).doc[0]?.kind._tag, 'Paragraph')
  })

  it('Enter at the start of a block opens an empty one above and keeps the caret', () => {
    const state = run(at([B.paragraph('a', 'text')], 'a', 0), { _tag: 'Enter' })
    assert.deepStrictEqual(state.doc.map(entry => caretText(entry.text)), ['', 'text'])
    assert.deepStrictEqual(state.selection, caret('a', 0))
  })

  it('Enter in an open toggle goes inside it; in code it is a newline', () => {
    const toggle = run(at([B.block('a', { _tag: 'Toggle', isOpen: true }, B.paragraph('x', 'Q').text)], 'a', 1), { _tag: 'Enter' })
    assert.strictEqual(toggle.doc.length, 1)
    assert.strictEqual(toggle.doc[0]?.children.length, 1)
    const code = run(at([B.block('a', { _tag: 'Code', language: 'ts', isWrapped: false }, B.paragraph('x', 'ab').text)], 'a', 1), { _tag: 'Enter' })
    assert.strictEqual(textOf(code, 'a'), 'a\nb')
  })

  it('Backspace at the start turns a list item into text, then outdents, then joins the block above', () => {
    const doc = [B.paragraph('a', 'one'), B.block('b', { _tag: 'Bulleted' }, B.paragraph('x', 'two').text)]
    let state = run(at(doc, 'b', 0), { _tag: 'DeleteBackward', unit: 'char' })
    assert.deepStrictEqual(kinds(state), ['Paragraph', 'Paragraph'])
    state = apply(state, { _tag: 'DeleteBackward', unit: 'char' })
    assert.deepStrictEqual(state.doc.map(entry => caretText(entry.text)), ['onetwo'])
    assert.deepStrictEqual(state.selection, caret('a', 3))
    const nested = run(at([{ ...B.paragraph('p', 'parent'), children: [B.paragraph('c', 'child')] }], 'c', 0), { _tag: 'DeleteBackward', unit: 'char' })
    assert.deepStrictEqual(nested.doc.map(entry => entry.id), ['p', 'c'])
  })

  it('deletes words and lines, and selected text across blocks', () => {
    assert.strictEqual(textOf(run(at([B.paragraph('a', 'hello big world')], 'a', 15), { _tag: 'DeleteBackward', unit: 'word' }), 'a'), 'hello big ')
    assert.strictEqual(textOf(run(at([B.paragraph('a', 'hello world')], 'a', 6), { _tag: 'DeleteBackward', unit: 'line' }), 'a'), 'world')
    const doc = [B.paragraph('a', 'one'), B.paragraph('b', 'two'), B.paragraph('c', 'three')]
    const state: EditorState = { ...initial(doc, 'n'), selection: { _tag: 'TextSelection', anchor: { blockId: 'c', offset: 2 }, focus: { blockId: 'a', offset: 1 } } }
    const after = apply(state, { _tag: 'InsertText', text: 'X' })
    assert.deepStrictEqual(after.doc.map(entry => caretText(entry.text)), ['oXree'])
  })

  it('Backspace after a divider selects it; Delete in selected blocks removes them', () => {
    const doc = [B.block('d', { _tag: 'Divider' }), B.paragraph('a', 'x')]
    const state = run(at(doc, 'a', 0), { _tag: 'DeleteBackward', unit: 'char' })
    assert.deepStrictEqual(state.selection, { _tag: 'BlockSelection', ids: ['d'], anchorId: 'd' })
    const removed = apply(state, { _tag: 'DeleteBackward', unit: 'char' })
    assert.deepStrictEqual(removed.doc.map(entry => entry.id), ['a'])
  })
})

describe('editor: blocks, menus and history', () => {
  it('Tab nests a block under the one above; Shift+Tab moves it out', () => {
    const doc = [B.paragraph('a', 'one'), B.paragraph('b', 'two')]
    const nested = run(at(doc, 'b', 0), { _tag: 'Indent', isOutdent: false })
    assert.deepStrictEqual(nested.doc[0]?.children.map(entry => entry.id), ['b'])
    assert.deepStrictEqual(run(nested, { _tag: 'Indent', isOutdent: true }).doc.map(entry => entry.id), ['a', 'b'])
  })

  it('Esc selects the block, arrows move and extend the selection, Enter edits it', () => {
    const doc = [B.paragraph('a', 'one'), B.paragraph('b', 'two'), B.paragraph('c', 'three')]
    let state = run(at(doc, 'a', 1), { _tag: 'Escape' })
    assert.deepStrictEqual(state.selection, { _tag: 'BlockSelection', ids: ['a'], anchorId: 'a' })
    state = run(state, { _tag: 'MoveBlockSelection', direction: 1, isExtending: true })
    assert.deepStrictEqual(state.selection._tag === 'BlockSelection' ? state.selection.ids : [], ['a', 'b'])
    state = run(state, { _tag: 'MoveBy', direction: 1 })
    assert.deepStrictEqual(state.doc.map(entry => entry.id), ['c', 'a', 'b'])
    assert.deepStrictEqual(run(state, { _tag: 'EditSelectedBlock' }).selection, caret('b', 3))
  })

  it('Ctrl+A selects the block text, then every block', () => {
    const doc = [B.paragraph('a', 'one'), B.paragraph('b', 'two')]
    const once = run(at(doc, 'a', 1), { _tag: 'SelectAll' })
    assert.deepStrictEqual(once.selection, { _tag: 'TextSelection', anchor: { blockId: 'a', offset: 0 }, focus: { blockId: 'a', offset: 3 } })
    assert.deepStrictEqual(run(once, { _tag: 'SelectAll' }).selection, { _tag: 'BlockSelection', ids: ['a', 'b'], anchorId: 'a' })
  })

  it('opens the slash menu after "/" at a word start, filters it and turns the block', () => {
    let state = type(at([B.paragraph('a')], 'a', 0), '/hea')
    assert.deepStrictEqual(state.menu, { _tag: 'SlashMenu', blockId: 'a', from: 0, query: 'hea', active: 0 })
    state = apply(state, { _tag: 'ChooseSlash', tag: 'Heading', level: 2 })
    assert.strictEqual(textOf(state, 'a'), '')
    assert.deepStrictEqual(state.doc[0]?.kind, { _tag: 'Heading', level: 2, isToggleable: false, isOpen: true })
    assert.strictEqual(state.menu._tag, 'NoMenu')
    assert.strictEqual(type(at([B.paragraph('a', 'a')], 'a', 1), '/').menu._tag, 'NoMenu')
    const closed = apply(type(at([B.paragraph('a')], 'a', 0), '/x'), { _tag: 'DeleteBackward', unit: 'char' })
    assert.strictEqual(apply(closed, { _tag: 'DeleteBackward', unit: 'char' }).menu._tag, 'NoMenu')
  })

  it('choosing from the slash menu in a block with text adds the block below', () => {
    const state = apply(type(at([B.paragraph('a', 'Intro ')], 'a', 6), '/div'), { _tag: 'ChooseSlash', tag: 'Divider', level: 1 })
    assert.deepStrictEqual(kinds(state), ['Paragraph', 'Divider'])
    assert.strictEqual(textOf(state, 'a'), 'Intro ')
  })

  it('undoes typing as one step and other edits one by one, then redoes them', () => {
    let state = type(at([B.paragraph('a')], 'a', 0), 'hello')
    state = apply(state, { _tag: 'Enter' })
    state = type(state, 'x')
    state = apply(state, { _tag: 'Undo' })
    assert.strictEqual(state.doc.length, 2)
    state = run(state, { _tag: 'Undo' }, { _tag: 'Undo' })
    assert.deepStrictEqual(state.doc.map(entry => caretText(entry.text)), [''])
    state = run(state, { _tag: 'Redo' }, { _tag: 'Redo' }, { _tag: 'Redo' })
    assert.deepStrictEqual(state.doc.map(entry => caretText(entry.text)), ['hello', 'x'])
  })

  it('pastes lines as blocks and a link over selected text', () => {
    const pasted = run(at([B.paragraph('a')], 'a', 0), { _tag: 'PasteText', text: '# Title\n- one\n[] two\nplain' })
    assert.deepStrictEqual(kinds(pasted), ['Heading', 'Bulleted', 'Todo', 'Paragraph'])
    const doc = [B.paragraph('a', 'see docs')]
    const state: EditorState = { ...initial(doc, 'n'), selection: { _tag: 'TextSelection', anchor: { blockId: 'a', offset: 4 }, focus: { blockId: 'a', offset: 8 } } }
    const linked = apply(state, { _tag: 'PasteText', text: 'https://example.com' })
    assert.strictEqual(textOf(linked, 'a'), 'see docs')
    const piece = B.find(linked.doc, 'a')!.text.at(-1)
    assert.strictEqual(piece?._tag === 'Text' ? piece.marks.link : null, 'https://example.com')
  })

  it('duplicates the current block with fresh ids, and keeps an empty document editable', () => {
    const dup = run(at([B.paragraph('a', 'x')], 'a', 0), { _tag: 'Duplicate' })
    assert.strictEqual(dup.doc.length, 2)
    assert.notStrictEqual(dup.doc[1]?.id, 'a')
    const empty = run({ ...initial([B.paragraph('a', 'x')], 'n'), selection: { _tag: 'BlockSelection', ids: ['a'], anchorId: 'a' } }, { _tag: 'DeleteBlocks' })
    assert.strictEqual(empty.doc.length, 1)
    assert.strictEqual(empty.selection._tag, 'TextSelection')
  })
})

describe('editor: @ mentions and : emoji', () => {
  const PLAIN = { bold: false, italic: false, underline: false, strike: false, code: false, color: 'default', link: null, comment: null } as const

  it('"@" after a space opens the mention menu, which follows the query and closes when the "@" goes', () => {
    const opened = type(at([B.paragraph('a')], 'a', 0), 'Hi @mor')
    assert.deepStrictEqual(opened.menu, { _tag: 'InlineMenu', trigger: '@', blockId: 'a', from: 3, query: 'mor', active: 0 })
    const back = run(opened, { _tag: 'DeleteBackward', unit: 'word' })
    assert.strictEqual(back.menu._tag, 'InlineMenu')
    assert.strictEqual(run(back, { _tag: 'DeleteBackward', unit: 'char' }).menu._tag, 'NoMenu')
    assert.strictEqual(type(at([B.paragraph('a')], 'a', 0), 'me@x').menu._tag, 'NoMenu')
  })

  it('choosing a person puts a mention and a space in place of "@query"', () => {
    const chosen = run(type(at([B.paragraph('a')], 'a', 0), 'Hi @mor'), { _tag: 'ChooseInline', piece: { _tag: 'PersonMention', memberId: 'morgan', marks: PLAIN } })
    const text = B.find(chosen.doc, 'a')!.text
    assert.deepStrictEqual(text.map(piece => piece._tag), ['Text', 'PersonMention', 'Text'])
    assert.strictEqual(caretText(text), 'Hi \uFFFC ')
    assert.deepStrictEqual(chosen.selection, caret('a', 5))
    assert.strictEqual(chosen.menu._tag, 'NoMenu')
    assert.strictEqual(caretText(B.find(run(chosen, { _tag: 'Undo' }).doc, 'a')!.text), 'Hi @mor')
  })

  it('":" and a letter opens the emoji menu; a space or a bare ":" does not', () => {
    const opened = type(at([B.paragraph('a')], 'a', 0), 'Go :roc')
    assert.deepStrictEqual(opened.menu, { _tag: 'InlineMenu', trigger: ':', blockId: 'a', from: 3, query: 'roc', active: 0 })
    assert.strictEqual(type(opened, ' ').menu._tag, 'NoMenu')
    assert.strictEqual(type(at([B.paragraph('a')], 'a', 0), 'Time: 10').menu._tag, 'NoMenu')
    assert.strictEqual(type(at([B.paragraph('a')], 'a', 0), '10:30').menu._tag, 'NoMenu')
    const chosen = run(opened, { _tag: 'ChooseInline', piece: { _tag: 'Text', text: 'R', marks: PLAIN } })
    assert.strictEqual(textOf(chosen, 'a'), 'Go R')
  })

  it('no menus open inside code', () => {
    const code = { ...initial([B.block('c', { _tag: 'Code', language: 'ts', isWrapped: false }, [])], 'n'), selection: caret('c', 0) }
    assert.strictEqual(type(code, 'a @b :c /d').menu._tag, 'NoMenu')
  })
})

describe('editor: code blocks', () => {
  const code = (text: string, offset: number) => ({ ...initial([{ ...B.block('c', { _tag: 'Code', language: 'ts', isWrapped: false }), text: T.plain(text) }], 'n'), selection: caret('c', offset) })

  it('Tab types two spaces and Shift+Tab takes them from the start of the line', () => {
    const tabbed = run(code('a\nb', 2), { _tag: 'Indent', isOutdent: false })
    assert.strictEqual(textOf(tabbed, 'c'), 'a\n  b')
    assert.deepStrictEqual(tabbed.selection, caret('c', 4))
    const back = run(tabbed, { _tag: 'Indent', isOutdent: true })
    assert.strictEqual(textOf(back, 'c'), 'a\nb')
    assert.deepStrictEqual(back.selection, caret('c', 2))
    assert.strictEqual(run(back, { _tag: 'Indent', isOutdent: true }), back)
    assert.strictEqual(textOf(run(code(' x', 2), { _tag: 'Indent', isOutdent: true }), 'c'), 'x')
  })

  it('Tab in a code block does not nest it', () => {
    const doc = [B.paragraph('a', 'x'), { ...B.block('c', { _tag: 'Code', language: 'ts', isWrapped: false }), text: T.plain('y') }]
    const state = run({ ...initial(doc, 'n'), selection: caret('c', 1) }, { _tag: 'Indent', isOutdent: false })
    assert.deepStrictEqual(state.doc.map(entry => entry.id), ['a', 'c'])
  })

  it('LeaveBlock puts a new text block below with the caret in it, undoably', () => {
    const left = run(code('a', 1), { _tag: 'LeaveBlock' })
    assert.deepStrictEqual(left.doc.map(entry => entry.kind._tag), ['Code', 'Paragraph'])
    assert.deepStrictEqual(left.selection, caret(left.doc[1]!.id, 0))
    assert.strictEqual(run(left, { _tag: 'Undo' }).doc.length, 1)
  })
})

describe('editor: simple tables', () => {
  const table = () => ({ ...initial([B.block('t', { _tag: 'Table', hasHeaderRow: false, hasHeaderColumn: false, rows: [[T.plain('a'), []], [[], []]] })], 'n'), selection: caret('t~0~0', 1) })
  const rows = (state: EditorState) => {
    const kind = state.doc[0]!.kind
    return kind._tag === 'Table' ? kind.rows.map(row => row.map(cell => caretText(cell))) : []
  }

  it('cells are typed into like text blocks', () => {
    const typed = type(table(), 'b')
    assert.deepStrictEqual(rows(typed), [['ab', ''], ['', '']])
    assert.deepStrictEqual(rows(run(typed, { _tag: 'Undo' })), [['a', ''], ['', '']])
  })

  it('Tab goes to the next cell, wraps to the next row and adds a row past the last cell; Shift+Tab goes back', () => {
    const tab = { _tag: 'Indent', isOutdent: false } as const
    const next = run(table(), tab)
    assert.deepStrictEqual(next.selection, caret('t~0~1', 0))
    assert.deepStrictEqual(run(next, tab).selection, caret('t~1~0', 0))
    const grown = run(next, tab, tab, tab)
    assert.deepStrictEqual(rows(grown), [['a', ''], ['', ''], ['', '']])
    assert.deepStrictEqual(grown.selection, caret('t~2~0', 0))
    assert.deepStrictEqual(run(next, { _tag: 'Indent', isOutdent: true }).selection, caret('t~0~0', 1))
    assert.deepStrictEqual(run(table(), { _tag: 'Indent', isOutdent: true }).selection, caret('t~0~0', 1))
  })

  it('Enter goes to the cell below, adding a row at the bottom', () => {
    const down = run(table(), { _tag: 'Enter' })
    assert.deepStrictEqual(down.selection, caret('t~1~0', 0))
    assert.strictEqual(rows(run(down, { _tag: 'Enter' })).length, 3)
  })

  it('Backspace at the start of a cell and Delete at its end do nothing; no Markdown or menus in cells', () => {
    const start = { ...table(), selection: caret('t~0~0', 0) }
    assert.strictEqual(run(start, { _tag: 'DeleteBackward', unit: 'char' }), start)
    const end = table()
    assert.strictEqual(run(end, { _tag: 'DeleteForward', unit: 'char' }), end)
    const empty = { ...table(), selection: caret('t~1~1', 0) }
    assert.deepStrictEqual(rows(type(empty, '# x')), [['a', ''], ['', '# x']])
    assert.strictEqual(type(empty, '/').menu._tag, 'NoMenu')
    assert.strictEqual(type(empty, '@').menu._tag, 'NoMenu')
  })

  it('Esc selects the whole table', () => {
    assert.deepStrictEqual(run(table(), { _tag: 'Escape' }).selection, { _tag: 'BlockSelection', ids: ['t'], anchorId: 't' })
  })
})
