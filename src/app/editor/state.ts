import { Schema as S } from 'effect'

import * as B from './blocks'
import { type Block, type Color, Document, type Inline, type Kind, type KindTag, Marks, type RichText, type ToggleMark, hasText } from './schema'
import * as T from './text'

/* The editor as a pure state machine: a document, a selection, the open
   menu, the marks the next typed character takes, and the undo history.
   Every key, input and click becomes an `Action`; `apply` returns the next
   state. The browser island only translates DOM events into Actions and the
   state back into DOM; everything Notion does on a key lives here. */

// STATE

export const Point = S.Struct({ blockId: S.String, offset: S.Number })
export type Point = typeof Point.Type

export const TextSelection = S.TaggedStruct('TextSelection', { anchor: Point, focus: Point })
/** Whole blocks (Esc, a click on the handle, dragging across blocks). */
export const BlockSelection = S.TaggedStruct('BlockSelection', { ids: S.Array(S.String), anchorId: S.String })
export const NoSelection = S.TaggedStruct('NoSelection', {})
export const Selection = S.Union([TextSelection, BlockSelection, NoSelection])
export type Selection = typeof Selection.Type

export const NoMenu = S.TaggedStruct('NoMenu', {})
/** The `/` menu: typed after `/` at `from` filters it. */
export const SlashMenu = S.TaggedStruct('SlashMenu', { blockId: S.String, from: S.Number, query: S.String, active: S.Number })
/** `@` (people, pages, dates) or `:` and a letter (emoji): typed after the trigger at `from` filters it. */
export const InlineMenu = S.TaggedStruct('InlineMenu', { trigger: S.Literals(['@', ':']), blockId: S.String, from: S.Number, query: S.String, active: S.Number })
export type InlineMenu = typeof InlineMenu.Type
export const Menu = S.Union([NoMenu, SlashMenu, InlineMenu])
export type Menu = typeof Menu.Type

const Snapshot = S.Struct({ doc: Document, selection: Selection })
type Snapshot = typeof Snapshot.Type

export const LastEdit = S.Literals(['none', 'typing', 'deleting'])

export const EditorState = S.Struct({
  doc: Document,
  selection: Selection,
  menu: Menu,
  /** Marks for the next typed text (Ctrl+B with nothing selected); null: those around the caret. */
  typingMarks: S.NullOr(Marks),
  undo: S.Array(Snapshot),
  redo: S.Array(Snapshot),
  lastEdit: LastEdit,
  /** New block ids are `${idPrefix}${idCount}`: deterministic, so apply stays pure. */
  idPrefix: S.String,
  idCount: S.Number,
})
export type EditorState = typeof EditorState.Type

export const UNDO_LIMIT = 200

export const caret = (blockId: string, offset: number): Selection => ({ _tag: 'TextSelection', anchor: { blockId, offset }, focus: { blockId, offset } })

export const initial = (doc: Document, idPrefix: string): EditorState => {
  const content = doc.length === 0 ? [B.paragraph(`${idPrefix}0`)] : doc
  return { doc: content, selection: { _tag: 'NoSelection' }, menu: { _tag: 'NoMenu' }, typingMarks: null, undo: [], redo: [], lastEdit: 'none', idPrefix, idCount: 1 }
}

// ACTIONS

export type Unit = 'char' | 'word' | 'line'

export type Action =
  | Readonly<{ _tag: 'Select'; selection: Selection }>
  | Readonly<{ _tag: 'InsertText'; text: string }>
  | Readonly<{ _tag: 'DeleteBackward'; unit: Unit }>
  | Readonly<{ _tag: 'DeleteForward'; unit: Unit }>
  | Readonly<{ _tag: 'Enter' }>
  | Readonly<{ _tag: 'SoftBreak' }>
  | Readonly<{ _tag: 'Indent'; isOutdent: boolean }>
  /** Ctrl+Enter in a code block: a new text block below, with the caret in it. */
  | Readonly<{ _tag: 'LeaveBlock' }>
  | Readonly<{ _tag: 'ToggleMark'; mark: ToggleMark }>
  | Readonly<{ _tag: 'SetLink'; url: string | null }>
  | Readonly<{ _tag: 'SetTextColor'; color: Color }>
  | Readonly<{ _tag: 'SetBlockColor'; color: Color }>
  | Readonly<{ _tag: 'TurnInto'; tag: KindTag; level: 1 | 2 | 3 }>
  | Readonly<{ _tag: 'MoveBy'; direction: -1 | 1 }>
  | Readonly<{ _tag: 'Duplicate' }>
  | Readonly<{ _tag: 'DeleteBlocks' }>
  | Readonly<{ _tag: 'SelectAll' }>
  | Readonly<{ _tag: 'Escape' }>
  | Readonly<{ _tag: 'MoveBlockSelection'; direction: -1 | 1; isExtending: boolean }>
  | Readonly<{ _tag: 'EditSelectedBlock' }>
  | Readonly<{ _tag: 'ToggleTodo'; blockId: string }>
  | Readonly<{ _tag: 'ToggleOpen'; blockId: string }>
  | Readonly<{ _tag: 'SetKind'; blockId: string; kind: Kind }>
  | Readonly<{ _tag: 'InsertBlocks'; blocks: ReadonlyArray<Block> }>
  | Readonly<{ _tag: 'PasteText'; text: string }>
  | Readonly<{ _tag: 'MoveSlash'; active: number }>
  | Readonly<{ _tag: 'ChooseSlash'; tag: KindTag; level: 1 | 2 | 3 }>
  | Readonly<{ _tag: 'ChooseInline'; piece: Inline }>
  | Readonly<{ _tag: 'CloseMenu' }>
  | Readonly<{ _tag: 'Undo' }>
  | Readonly<{ _tag: 'Redo' }>
  | Readonly<{ _tag: 'ReplaceDocument'; doc: Document }>
  | Readonly<{ _tag: 'Drop'; ids: ReadonlyArray<string>; targetId: string; place: B.DropPlace }>

// HELPERS

const textOf = (doc: Document, id: string): RichText => B.find(doc, id)?.text ?? []

const order = (doc: Document): ReadonlyMap<string, number> => new Map(B.textBlocks(doc).map((entry, index) => [entry.id, index]))

/** The selection's start and end in document order. */
export const ordered = (doc: Document, selection: Extract<Selection, { _tag: 'TextSelection' }>): readonly [Point, Point] => {
  const { anchor, focus } = selection
  if (anchor.blockId === focus.blockId) return anchor.offset <= focus.offset ? [anchor, focus] : [focus, anchor]
  const index = order(doc)
  return (index.get(anchor.blockId) ?? 0) <= (index.get(focus.blockId) ?? 0) ? [anchor, focus] : [focus, anchor]
}

export const isCollapsed = (selection: Selection): boolean =>
  selection._tag === 'TextSelection' && selection.anchor.blockId === selection.focus.blockId && selection.anchor.offset === selection.focus.offset

const clampPoint = (doc: Document, point: Point): Point | null => {
  const target = B.find(doc, point.blockId)
  return target === null || !hasText(target.kind) ? null : { blockId: point.blockId, offset: Math.max(0, Math.min(point.offset, T.lengthOf(target.text))) }
}

const ids = (state: EditorState) => {
  let count = state.idCount
  return { next: () => `${state.idPrefix}${count++}`, count: () => count }
}

const withHistory = (before: EditorState, after: EditorState, kind: 'typing' | 'deleting' | 'none'): EditorState => {
  if (after.doc === before.doc) return { ...after, lastEdit: kind === 'none' ? before.lastEdit : kind }
  const coalesce = kind !== 'none' && before.lastEdit === kind
  const undo = coalesce ? before.undo : [...before.undo, { doc: before.doc, selection: before.selection }].slice(-UNDO_LIMIT)
  return { ...after, undo, redo: [], lastEdit: kind }
}

/** Removes the text between two points; blocks between them go, and the last
 *  block's text and children join the first. */
const deleteRange = (doc: Document, start: Point, end: Point): Document => {
  if (start.blockId === end.blockId) return B.update(doc, start.blockId, target => ({ ...target, text: T.remove(target.text, start.offset, end.offset) }))
  if (B.isCell(start.blockId) || B.isCell(end.blockId)) return doc
  const blocks = B.textBlocks(doc)
  const from = blocks.findIndex(entry => entry.id === start.blockId)
  const to = blocks.findIndex(entry => entry.id === end.blockId)
  const last = blocks[to]
  if (from < 0 || to < 0 || last === undefined) return doc
  let next = doc
  for (const entry of blocks.slice(from + 1, to + 1)) next = B.remove(next, entry.id)[0]
  return B.update(next, start.blockId, target => ({
    ...target,
    text: T.concat(T.slice(target.text, 0, start.offset), T.slice(last.text, end.offset)),
    children: [...target.children, ...last.children],
  }))
}

/** Deletes a non-collapsed text selection; the caret ends at its start. */
const deleteSelection = (state: EditorState): readonly [Document, Point] | null => {
  if (state.selection._tag !== 'TextSelection' || isCollapsed(state.selection)) return null
  const [start, end] = ordered(state.doc, state.selection)
  return [deleteRange(state.doc, start, end), start]
}

const caretPoint = (state: EditorState): Point | null => {
  if (state.selection._tag !== 'TextSelection') return null
  const deleted = deleteSelection(state)
  return deleted === null ? clampPoint(state.doc, state.selection.focus) : deleted[1]
}

/** Blocks an action on "the current block" applies to. */
export const targetIds = (state: EditorState): ReadonlyArray<string> => {
  const { selection } = state
  if (selection._tag === 'BlockSelection') return selection.ids
  if (selection._tag !== 'TextSelection') return []
  const [start, end] = ordered(state.doc, selection)
  const blocks = B.textBlocks(state.doc)
  const from = blocks.findIndex(entry => entry.id === start.blockId)
  const to = blocks.findIndex(entry => entry.id === end.blockId)
  return from < 0 || to < 0 ? [] : [...new Set(blocks.slice(from, to + 1).map(entry => B.ownerId(entry.id)))]
}

const CONTINUES: ReadonlySet<KindTag> = new Set(['Bulleted', 'Numbered', 'Todo', 'Toggle'])
const CONVERTS_ON_EMPTY: ReadonlySet<KindTag> = new Set(['Bulleted', 'Numbered', 'Todo', 'Toggle', 'Quote', 'Heading', 'Callout'])

const continuation = (kind: Kind): Kind => {
  switch (kind._tag) {
    case 'Todo': return { _tag: 'Todo', isChecked: false }
    case 'Toggle': return { _tag: 'Toggle', isOpen: false }
    default: return CONTINUES.has(kind._tag) ? kind : { _tag: 'Paragraph' }
  }
}

const isNested = (doc: Document, id: string): boolean => {
  const parent = B.parentOf(doc, id)
  return parent !== null && parent !== undefined && parent.kind._tag !== 'Column'
}

const isOpenContainer = (target: Block): boolean =>
  (target.kind._tag === 'Toggle' && target.kind.isOpen) || (target.kind._tag === 'Heading' && target.kind.isToggleable && target.kind.isOpen) || target.kind._tag === 'Callout'

// MARKDOWN

const BLOCK_SHORTCUTS: ReadonlyArray<readonly [RegExp, (match: RegExpMatchArray) => Kind]> = [
  [/^###$/, () => B.kindOf('Heading', 3)],
  [/^##$/, () => B.kindOf('Heading', 2)],
  [/^#$/, () => B.kindOf('Heading', 1)],
  [/^[-*+]$/, () => ({ _tag: 'Bulleted' })],
  [/^(\d+|[a-z]|[ivx]+)\.$/, () => ({ _tag: 'Numbered' })],
  [/^\[ ?\]$/, () => ({ _tag: 'Todo', isChecked: false })],
  [/^\[x\]$/i, () => ({ _tag: 'Todo', isChecked: true })],
  [/^"$/, () => ({ _tag: 'Quote' })],
  [/^>$/, () => ({ _tag: 'Toggle', isOpen: true })],
  [/^>#$/, () => ({ _tag: 'Heading', level: 1, isToggleable: true, isOpen: true })],
  [/^>##$/, () => ({ _tag: 'Heading', level: 2, isToggleable: true, isOpen: true })],
  [/^>###$/, () => ({ _tag: 'Heading', level: 3, isToggleable: true, isOpen: true })],
]

const INLINE_SHORTCUTS: ReadonlyArray<readonly [RegExp, ToggleMark, number]> = [
  [/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, 'bold', 2],
  [/__([^_\s](?:[^_]*[^_\s])?)__$/, 'bold', 2],
  [/(?:^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, 'italic', 1],
  [/(?:^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, 'italic', 1],
  [/`([^`]+)`$/, 'code', 1],
  [/(?:^|[^~])~([^~\s](?:[^~]*[^~\s])?)~$/, 'strike', 1],
]

/** After a space at a block's start: `#`, `-`, `1.`, `[]`, `"`, `>` and the like turn it into that block. */
const blockShortcut = (target: Block, offset: number): Kind | null => {
  if (target.kind._tag !== 'Paragraph' && target.kind._tag !== 'Bulleted' && target.kind._tag !== 'Numbered' && target.kind._tag !== 'Todo') return null
  const before = T.caretText(target.text).slice(0, offset)
  for (const [pattern, kind] of BLOCK_SHORTCUTS) {
    const match = before.match(pattern)
    if (match !== null) return kind(match)
  }
  return null
}

const inlineShortcut = (text: RichText, offset: number): readonly [RichText, number, Marks] | null => {
  const before = T.caretText(text).slice(0, offset)
  for (const [pattern, mark, width] of INLINE_SHORTCUTS) {
    const match = before.match(pattern)
    const inner = match?.[1]
    if (match === null || inner === undefined) continue
    const end = offset
    const start = end - inner.length - width * 2
    if (T.hasMark(text, start + width, end - width, 'code') && mark !== 'code') continue
    const stripped = T.remove(T.remove(text, end - width, end), start, start + width)
    const marked = T.toggleMark(stripped, start, start + inner.length, mark)
    return [marked, start + inner.length, { ...T.marksAt(marked, start + inner.length), [mark]: false }]
  }
  return null
}

// APPLY

const insertText = (state: EditorState, value: string): EditorState => {
  if (state.selection._tag === 'BlockSelection') {
    // Typing over selected blocks replaces them with a paragraph holding the text.
    const removed = removeBlocks(state, state.selection.ids)
    return insertText(removed, value)
  }
  const deleted = deleteSelection(state)
  const doc = deleted?.[0] ?? state.doc
  const point = deleted?.[1] ?? caretPoint(state)
  if (point === null) return state
  const target = B.find(doc, point.blockId)
  if (target === null) return state
  const marks = state.typingMarks ?? T.typingMarksAt(target.text, point.offset)
  let text = T.insertText(target.text, point.offset, value, marks)
  let offset = point.offset + value.length
  let kind = target.kind
  let typingMarks: Marks | null = state.typingMarks
  let menu: Menu = state.menu
  const inCell = B.isCell(target.id)
  if (value === ' ' && target.kind._tag !== 'Code' && !inCell) {
    const shortcut = blockShortcut({ ...target, text }, point.offset)
    if (shortcut !== null) {
      text = T.slice(text, offset)
      offset = 0
      kind = shortcut
    }
  }
  const plainBefore = T.caretText(text).slice(0, offset)
  if (!inCell && target.kind._tag === 'Paragraph' && plainBefore === '```' && offset === T.lengthOf(text)) {
    return withHistory(state, { ...state, doc: B.update(doc, target.id, entry => ({ ...entry, kind: { _tag: 'Code', language: 'plain text', isWrapped: false }, text: [] })), selection: caret(target.id, 0), typingMarks: null }, 'none')
  }
  if (!inCell && target.kind._tag === 'Paragraph' && plainBefore === '---' && offset === T.lengthOf(text)) {
    const id = ids(state)
    const next = B.paragraph(id.next())
    const replaced = B.insertAfter(B.update(doc, target.id, entry => ({ ...entry, kind: { _tag: 'Divider' }, text: [] })), target.id, [next])
    return withHistory(state, { ...state, doc: replaced, selection: caret(next.id, 0), idCount: id.count(), typingMarks: null }, 'none')
  }
  if (value.length === 1 && '*_`~'.includes(value) && target.kind._tag !== 'Code' && !marks.code) {
    const inline = inlineShortcut(text, offset)
    if (inline !== null) [text, offset, typingMarks] = inline
  }
  const previous = point.offset === 0 ? ' ' : (T.caretText(target.text)[point.offset - 1] ?? ' ')
  const isOpening = menu._tag === 'NoMenu' && kind._tag !== 'Code' && !marks.code && !inCell
  if (isOpening && value === '/' && /\s/.test(previous)) menu = { _tag: 'SlashMenu', blockId: target.id, from: point.offset, query: '', active: 0 }
  else if (isOpening && value === '@' && /\s/.test(previous)) menu = { _tag: 'InlineMenu', trigger: '@', blockId: target.id, from: point.offset, query: '', active: 0 }
  else if (isOpening && /^[a-z0-9]$/i.test(value) && previous === ':' && /\s/.test(point.offset < 2 ? ' ' : (T.caretText(target.text)[point.offset - 2] ?? ' '))) {
    menu = { _tag: 'InlineMenu', trigger: ':', blockId: target.id, from: point.offset - 1, query: value, active: 0 }
  } else if (menu._tag !== 'NoMenu') menu = menuAfter(menu, target.id, text, offset)
  const next: EditorState = { ...state, doc: B.update(doc, target.id, entry => ({ ...entry, kind, text })), selection: caret(target.id, offset), typingMarks, menu }
  return withHistory(state, next, kind === target.kind && deleted === null ? 'typing' : 'none')
}

type OpenMenu = Exclude<Menu, { _tag: 'NoMenu' }>
const triggerOf = (menu: OpenMenu): string => (menu._tag === 'SlashMenu' ? '/' : menu.trigger)

/** A menu follows what is typed after its trigger; it closes when the trigger goes, the caret leaves or the query runs on (emoji: at a space). */
const menuAfter = (menu: OpenMenu, blockId: string, text: RichText, offset: number): Menu => {
  const plain = T.caretText(text)
  if (blockId !== menu.blockId || offset <= menu.from || plain[menu.from] !== triggerOf(menu)) return { _tag: 'NoMenu' }
  const query = plain.slice(menu.from + 1, offset)
  const isOver = query.length > 24 || /\s\s/.test(query) || /^\s/.test(query) || (triggerOf(menu) === ':' && (query === '' || /\s/.test(query)))
  return isOver ? { _tag: 'NoMenu' } : { ...menu, query, active: query === menu.query ? menu.active : 0 }
}

const removeBlocks = (state: EditorState, blockIds: ReadonlyArray<string>): EditorState => {
  const first = blockIds[0]
  if (first === undefined) return state
  const id = ids(state)
  const before = B.previousText(state.doc, first)
  let doc = state.doc
  for (const blockId of blockIds) doc = B.remove(doc, blockId)[0]
  doc = B.tidyColumns(doc)
  const firstText = B.textBlocks(doc)[0]
  if (before === null && firstText !== undefined) return { ...state, doc, selection: caret(firstText.id, 0), menu: { _tag: 'NoMenu' } }
  if (doc.length === 0 || before === null) {
    const fresh = B.paragraph(id.next())
    const into = doc[0]
    doc = into === undefined ? [fresh] : B.insertBefore(doc, into.id, [fresh])
    return { ...state, doc, selection: caret(fresh.id, 0), idCount: id.count(), menu: { _tag: 'NoMenu' } }
  }
  const kept = B.find(doc, before.id)
  return { ...state, doc, selection: kept === null ? { _tag: 'NoSelection' } : caret(kept.id, T.lengthOf(kept.text)), menu: { _tag: 'NoMenu' } }
}

const deleteBackward = (state: EditorState, unit: Unit): EditorState => {
  if (state.selection._tag === 'BlockSelection') return withHistory(state, removeBlocks(state, state.selection.ids), 'none')
  const deleted = deleteSelection(state)
  if (deleted !== null) return withHistory(state, { ...state, doc: deleted[0], selection: caret(deleted[1].blockId, deleted[1].offset), menu: { _tag: 'NoMenu' } }, 'deleting')
  const point = caretPoint(state)
  if (point === null) return state
  const target = B.find(state.doc, point.blockId)
  if (target === null) return state
  if (point.offset > 0) {
    const plain = T.caretText(target.text)
    const from = unit === 'line' ? 0 : unit === 'word' ? T.wordStartBefore(plain, point.offset) : T.charBefore(plain, point.offset)
    const text = T.remove(target.text, from, point.offset)
    const menu = state.menu._tag === 'NoMenu' ? state.menu : menuAfter(state.menu, target.id, text, from)
    return withHistory(state, { ...state, doc: B.update(state.doc, target.id, entry => ({ ...entry, text })), selection: caret(target.id, from), menu, typingMarks: null }, 'deleting')
  }
  if (B.isCell(target.id)) return state
  // At the start: a list item, heading or quote turns into text first, then nested text moves out, then it joins the block above.
  if (target.kind._tag !== 'Paragraph' && target.kind._tag !== 'Code') {
    return withHistory(state, { ...state, doc: B.update(state.doc, target.id, entry => ({ ...entry, kind: { _tag: 'Paragraph' } })) }, 'none')
  }
  if (isNested(state.doc, target.id) && B.nextVisible(state.doc, target.id) === null || isNested(state.doc, target.id) && B.siblingsOf(state.doc, target.id).at(-1)?.id === target.id) {
    return withHistory(state, { ...state, doc: B.outdent(state.doc, target.id) }, 'none')
  }
  const previous = B.previousVisible(state.doc, target.id)
  if (previous === null) return state
  if (!hasText(previous.kind)) {
    if (T.lengthOf(target.text) === 0 && target.children.length === 0) return withHistory(state, { ...state, doc: B.remove(state.doc, target.id)[0], selection: { _tag: 'BlockSelection', ids: [previous.id], anchorId: previous.id } }, 'none')
    return { ...state, selection: { _tag: 'BlockSelection', ids: [previous.id], anchorId: previous.id } }
  }
  const offset = T.lengthOf(previous.text)
  const [without] = B.remove(state.doc, target.id)
  const doc = B.update(without, previous.id, entry => ({ ...entry, text: T.concat(entry.text, target.text), children: [...entry.children, ...target.children] }))
  return withHistory(state, { ...state, doc, selection: caret(previous.id, offset) }, 'none')
}

const deleteForward = (state: EditorState, unit: Unit): EditorState => {
  if (state.selection._tag === 'BlockSelection' || deleteSelection(state) !== null) return deleteBackward(state, unit)
  const point = caretPoint(state)
  if (point === null) return state
  const target = B.find(state.doc, point.blockId)
  if (target === null) return state
  const plain = T.caretText(target.text)
  if (point.offset < plain.length) {
    const to = unit === 'line' ? plain.length : unit === 'word' ? T.wordEndAfter(plain, point.offset) : T.charAfter(plain, point.offset)
    return withHistory(state, { ...state, doc: B.update(state.doc, target.id, entry => ({ ...entry, text: T.remove(entry.text, point.offset, to) })), typingMarks: null }, 'deleting')
  }
  if (B.isCell(target.id)) return state
  const next = B.nextVisible(state.doc, target.id)
  if (next === null) return state
  if (!hasText(next.kind)) return withHistory(state, { ...state, doc: B.remove(state.doc, next.id)[0] }, 'none')
  const [without] = B.remove(state.doc, next.id)
  const doc = B.update(without, target.id, entry => ({ ...entry, text: T.concat(entry.text, next.text), children: [...entry.children, ...next.children] }))
  return withHistory(state, { ...state, doc }, 'none')
}

/** Tab/Shift+Tab and Enter in a table: the next, previous or lower cell, with a new row past the last one. */
const moveToCell = (state: EditorState, id: string, step: 'down' | 'next' | 'previous'): EditorState => {
  const cell = B.parseCell(id)
  const table = cell === null ? null : B.find(state.doc, cell.tableId)
  if (cell === null || table === null || table.kind._tag !== 'Table') return state
  const { rows } = table.kind
  const width = rows[0]?.length ?? 0
  let { row, column } = cell
  if (step === 'down') row += 1
  else if (step === 'next') [row, column] = column + 1 >= width ? [row + 1, 0] : [row, column + 1]
  else [row, column] = column === 0 ? [row - 1, width - 1] : [row, column - 1]
  if (row < 0) return state
  const doc = row >= rows.length ? B.update(state.doc, table.id, entry => ({ ...entry, kind: B.addRow(table.kind as Extract<Kind, { _tag: 'Table' }>) })) : state.doc
  const target = B.cellId(table.id, row, column)
  const selection = caret(target, T.lengthOf(B.find(doc, target)?.text ?? []))
  return doc === state.doc ? { ...state, selection, menu: { _tag: 'NoMenu' }, typingMarks: null, lastEdit: 'none' } : withHistory(state, { ...state, doc, selection, menu: { _tag: 'NoMenu' } }, 'none')
}

/** Tab in a code block types two spaces; Shift+Tab takes up to two from the start of the line. */
const codeIndent = (state: EditorState, isOutdent: boolean): EditorState | null => {
  const { selection } = state
  if (selection._tag !== 'TextSelection' || selection.anchor.blockId !== selection.focus.blockId) return null
  const target = B.find(state.doc, selection.focus.blockId)
  if (target === null || target.kind._tag !== 'Code') return null
  if (!isOutdent) return insertText(state, '  ')
  const offset = ordered(state.doc, selection)[0].offset
  const value = T.caretText(target.text)
  const lineStart = value.lastIndexOf('\n', offset - 1) + 1
  const spaces = value.slice(lineStart, lineStart + 2) === '  ' ? 2 : value[lineStart] === ' ' ? 1 : 0
  if (spaces === 0) return state
  const doc = B.update(state.doc, target.id, entry => ({ ...entry, text: T.remove(entry.text, lineStart, lineStart + spaces) }))
  return withHistory(state, { ...state, doc, selection: caret(target.id, Math.max(lineStart, offset - spaces)) }, 'none')
}

const enter = (state: EditorState): EditorState => {
  if (state.selection._tag === 'BlockSelection') return apply(state, { _tag: 'EditSelectedBlock' })
  const deleted = deleteSelection(state)
  const doc = deleted?.[0] ?? state.doc
  const point = deleted?.[1] ?? caretPoint(state)
  if (point === null) return state
  const target = B.find(doc, point.blockId)
  if (target === null) return state
  if (target.kind._tag === 'Code') return insertText({ ...state, doc, selection: caret(point.blockId, point.offset) }, '\n')
  if (B.isCell(target.id)) return moveToCell({ ...state, doc }, target.id, 'down')
  const id = ids(state)
  const length = T.lengthOf(target.text)
  if (length === 0 && CONVERTS_ON_EMPTY.has(target.kind._tag) && target.children.length === 0) {
    const next = isNested(doc, target.id) ? B.outdent(doc, target.id) : B.update(doc, target.id, entry => ({ ...entry, kind: { _tag: 'Paragraph' } }))
    return withHistory(state, { ...state, doc: next, selection: caret(target.id, 0), menu: { _tag: 'NoMenu' } }, 'none')
  }
  if (point.offset === 0 && length > 0) {
    const fresh = B.block(id.next(), continuation(target.kind))
    return withHistory(state, { ...state, doc: B.insertBefore(doc, target.id, [fresh]), selection: caret(target.id, 0), idCount: id.count(), menu: { _tag: 'NoMenu' } }, 'none')
  }
  const [before, after] = T.splitAt(target.text, point.offset)
  const updated = B.update(doc, target.id, entry => ({ ...entry, text: before }))
  if (isOpenContainer(target)) {
    const child = B.block(id.next(), { _tag: 'Paragraph' }, after)
    return withHistory(state, { ...state, doc: B.prependChildren(updated, target.id, [child]), selection: caret(child.id, 0), idCount: id.count(), menu: { _tag: 'NoMenu' }, typingMarks: null }, 'none')
  }
  const fresh = { ...B.block(id.next(), continuation(target.kind), after), color: CONTINUES.has(target.kind._tag) ? target.color : 'default' as const }
  return withHistory(state, { ...state, doc: B.insertAfter(updated, target.id, [fresh]), selection: caret(fresh.id, 0), idCount: id.count(), menu: { _tag: 'NoMenu' }, typingMarks: null }, 'none')
}

const mapTextRange = (state: EditorState, change: (text: RichText, from: number, to: number) => RichText): EditorState => {
  if (state.selection._tag === 'BlockSelection') {
    let doc = state.doc
    for (const blockId of state.selection.ids) doc = B.update(doc, blockId, entry => ({ ...entry, text: change(entry.text, 0, T.lengthOf(entry.text)) }))
    return withHistory(state, { ...state, doc }, 'none')
  }
  if (state.selection._tag !== 'TextSelection') return state
  const [start, end] = ordered(state.doc, state.selection)
  let doc = state.doc
  for (const blockId of targetIds(state)) {
    doc = B.update(doc, blockId, entry => ({
      ...entry,
      text: change(entry.text, blockId === start.blockId ? start.offset : 0, blockId === end.blockId ? end.offset : T.lengthOf(entry.text)),
    }))
  }
  return withHistory(state, { ...state, doc }, 'none')
}

const toggleMark = (state: EditorState, mark: ToggleMark): EditorState => {
  if (isCollapsed(state.selection) && state.selection._tag === 'TextSelection') {
    const point = state.selection.focus
    const marks = state.typingMarks ?? T.typingMarksAt(textOf(state.doc, point.blockId), point.offset)
    return { ...state, typingMarks: { ...marks, [mark]: !marks[mark] } }
  }
  // One state for the whole range: on unless every part has it.
  const blocks = targetIds(state)
  const all = state.selection._tag === 'TextSelection' ? ordered(state.doc, state.selection) : null
  const isOn = blocks.every(blockId => {
    const text = textOf(state.doc, blockId)
    const from = all !== null && blockId === all[0].blockId ? all[0].offset : 0
    const to = all !== null && blockId === all[1].blockId ? all[1].offset : T.lengthOf(text)
    return from === to || T.hasMark(text, from, to, mark)
  })
  return mapTextRange(state, (text, from, to) => (T.hasMark(text, from, to, mark) === isOn ? T.toggleMark(text, from, to, mark) : text))
}

const turnInto = (state: EditorState, kind: (target: Block) => Kind): EditorState => {
  let doc = state.doc
  for (const blockId of targetIds(state)) doc = B.update(doc, blockId, entry => {
    const next = kind(entry)
    return { ...entry, kind: next, text: hasText(next) ? entry.text : [] }
  })
  return withHistory(state, { ...state, doc, menu: { _tag: 'NoMenu' } }, 'none')
}

const parseLines = (text: string, next: () => string): ReadonlyArray<Block> =>
  text.replace(/\r\n?/g, '\n').split('\n').map(line => {
    for (const [pattern, kind] of BLOCK_SHORTCUTS) {
      const match = line.match(new RegExp(pattern.source.replace(/\$$/, '\\s+')))
      if (match !== null) return B.block(next(), kind(match), T.plain(line.slice(match[0].length)))
    }
    return /^(---|\*\*\*)$/.test(line.trim()) ? B.block(next(), { _tag: 'Divider' }) : B.block(next(), { _tag: 'Paragraph' }, T.plain(line))
  })

const insertBlocks = (state: EditorState, blocks: ReadonlyArray<Block>): EditorState => {
  const lastText = [...blocks].reverse().find(entry => hasText(entry.kind))
  if (blocks.length === 0) return state
  const point = state.selection._tag === 'TextSelection' ? caretPoint(state) : null
  const deleted = deleteSelection(state)
  const doc = deleted?.[0] ?? state.doc
  const anchorId = point?.blockId ?? (state.selection._tag === 'BlockSelection' ? state.selection.ids.at(-1) : undefined) ?? doc.at(-1)?.id
  if (anchorId === undefined) return state
  const target = B.find(doc, anchorId)
  const isEmptyText = target !== null && target.kind._tag === 'Paragraph' && T.lengthOf(target.text) === 0 && target.children.length === 0
  const placed = isEmptyText ? B.remove(B.insertAfter(doc, anchorId, blocks), anchorId)[0] : B.insertAfter(doc, anchorId, blocks)
  return withHistory(state, { ...state, doc: placed, selection: lastText === undefined ? { _tag: 'BlockSelection', ids: blocks.map(entry => entry.id), anchorId: blocks[0]?.id ?? '' } : caret(lastText.id, T.lengthOf(lastText.text)), menu: { _tag: 'NoMenu' } }, 'none')
}

export const apply = (state: EditorState, action: Action): EditorState => {
  switch (action._tag) {
    case 'Select': {
      const menu = state.menu._tag !== 'NoMenu' && (action.selection._tag !== 'TextSelection' || action.selection.focus.blockId !== state.menu.blockId || action.selection.focus.offset <= state.menu.from) ? { _tag: 'NoMenu' as const } : state.menu
      return { ...state, selection: action.selection, typingMarks: null, lastEdit: 'none', menu }
    }
    case 'InsertText': return action.text === '' ? state : insertText(state, action.text)
    case 'DeleteBackward': return deleteBackward(state, action.unit)
    case 'DeleteForward': return deleteForward(state, action.unit)
    case 'Enter': return enter(state)
    case 'SoftBreak': return insertText(state, '\n')
    case 'Indent': {
      if (state.selection._tag === 'TextSelection' && B.isCell(state.selection.focus.blockId)) return moveToCell(state, state.selection.focus.blockId, action.isOutdent ? 'previous' : 'next')
      const inCode = codeIndent(state, action.isOutdent)
      if (inCode !== null) return inCode
      const blockIds = targetIds(state)
      let doc = state.doc
      for (const blockId of action.isOutdent ? [...blockIds].reverse() : blockIds) doc = action.isOutdent ? B.outdent(doc, blockId) : B.indent(doc, blockId)
      return withHistory(state, { ...state, doc }, 'none')
    }
    case 'LeaveBlock': {
      const point = caretPoint(state)
      if (point === null) return state
      const id = ids(state)
      const fresh = B.paragraph(id.next())
      return withHistory(state, { ...state, doc: B.insertAfter(state.doc, point.blockId, [fresh]), idCount: id.count(), selection: caret(fresh.id, 0), menu: { _tag: 'NoMenu' } }, 'none')
    }
    case 'ToggleMark': return toggleMark(state, action.mark)
    case 'SetLink': return mapTextRange(state, (text, from, to) => (from === to ? text : T.setLink(text, from, to, action.url)))
    case 'SetTextColor': return mapTextRange(state, (text, from, to) => T.setColor(text, from, to, action.color))
    case 'SetBlockColor': {
      let doc = state.doc
      for (const blockId of targetIds(state)) doc = B.update(doc, blockId, entry => ({ ...entry, color: action.color }))
      return withHistory(state, { ...state, doc }, 'none')
    }
    case 'TurnInto': return turnInto(state, entry => {
      const kind = B.kindOf(action.tag, action.level)
      return kind._tag === 'Heading' && entry.kind._tag === 'Heading' ? { ...kind, isToggleable: entry.kind.isToggleable, isOpen: entry.kind.isOpen } : kind
    })
    case 'MoveBy': {
      const blockIds = targetIds(state)
      let doc = state.doc
      for (const blockId of action.direction === 1 ? [...blockIds].reverse() : blockIds) doc = B.moveBy(doc, blockId, action.direction)
      return withHistory(state, { ...state, doc }, 'none')
    }
    case 'Duplicate': {
      const blockIds = targetIds(state)
      const last = blockIds.at(-1)
      if (last === undefined) return state
      const id = ids(state)
      const copies = blockIds.flatMap(blockId => {
        const found = B.find(state.doc, blockId)
        return found === null ? [] : [B.copyWithIds(found, id.next)]
      })
      return withHistory(state, { ...state, doc: B.insertAfter(state.doc, last, copies), idCount: id.count(), selection: { _tag: 'BlockSelection', ids: copies.map(entry => entry.id), anchorId: copies[0]?.id ?? '' } }, 'none')
    }
    case 'DeleteBlocks': return withHistory(state, removeBlocks(state, targetIds(state)), 'none')
    case 'SelectAll': {
      if (state.selection._tag === 'TextSelection') {
        const [start, end] = ordered(state.doc, state.selection)
        const length = T.lengthOf(textOf(state.doc, start.blockId))
        if (start.blockId === end.blockId && !(start.offset === 0 && end.offset === length)) {
          return { ...state, selection: { _tag: 'TextSelection', anchor: { blockId: start.blockId, offset: 0 }, focus: { blockId: start.blockId, offset: length } } }
        }
      }
      return { ...state, selection: { _tag: 'BlockSelection', ids: state.doc.map(entry => entry.id), anchorId: state.doc[0]?.id ?? '' }, menu: { _tag: 'NoMenu' } }
    }
    case 'Escape': {
      if (state.menu._tag !== 'NoMenu') return { ...state, menu: { _tag: 'NoMenu' } }
      if (state.selection._tag === 'TextSelection') {
        const blockIds = targetIds(state)
        return { ...state, selection: { _tag: 'BlockSelection', ids: blockIds, anchorId: blockIds[0] ?? '' } }
      }
      return { ...state, selection: { _tag: 'NoSelection' } }
    }
    case 'MoveBlockSelection': {
      if (state.selection._tag !== 'BlockSelection') return state
      const edge = action.direction === 1 ? state.selection.ids.at(-1) : state.selection.ids[0]
      if (edge === undefined) return state
      const next = action.direction === 1 ? B.nextVisible(state.doc, edge) : B.previousVisible(state.doc, edge)
      if (next === null) return state
      const blockIds = action.isExtending ? (action.direction === 1 ? [...state.selection.ids, next.id] : [next.id, ...state.selection.ids]) : [next.id]
      return { ...state, selection: { _tag: 'BlockSelection', ids: blockIds, anchorId: action.isExtending ? state.selection.anchorId : next.id } }
    }
    case 'EditSelectedBlock': {
      if (state.selection._tag !== 'BlockSelection') return state
      const target = B.find(state.doc, state.selection.ids.at(-1) ?? '')
      return target === null || !hasText(target.kind) ? state : { ...state, selection: caret(target.id, T.lengthOf(target.text)) }
    }
    case 'ToggleTodo': return withHistory(state, { ...state, doc: B.update(state.doc, action.blockId, entry => (entry.kind._tag === 'Todo' ? { ...entry, kind: { ...entry.kind, isChecked: !entry.kind.isChecked } } : entry)) }, 'none')
    case 'ToggleOpen': return {
      ...state,
      doc: B.update(state.doc, action.blockId, entry =>
        entry.kind._tag === 'Toggle' || (entry.kind._tag === 'Heading' && entry.kind.isToggleable) ? { ...entry, kind: { ...entry.kind, isOpen: !entry.kind.isOpen } } : entry),
    }
    case 'SetKind': return withHistory(state, { ...state, doc: B.update(state.doc, action.blockId, entry => ({ ...entry, kind: action.kind, text: hasText(action.kind) ? entry.text : [] })) }, 'none')
    case 'InsertBlocks': return insertBlocks(state, action.blocks)
    case 'PasteText': {
      if (!action.text.includes('\n')) {
        const isUrl = /^https?:\/\/\S+$/.test(action.text.trim())
        const selected = state.selection._tag === 'TextSelection' && !isCollapsed(state.selection)
        if (isUrl && selected) return apply(state, { _tag: 'SetLink', url: action.text.trim() })
        const inserted = insertText({ ...state, lastEdit: 'none' }, action.text)
        if (!isUrl || state.selection._tag !== 'TextSelection') return inserted
        const point = caretPoint(state)
        return point === null ? inserted : { ...inserted, doc: B.update(inserted.doc, point.blockId, entry => ({ ...entry, text: T.setLink(entry.text, point.offset, point.offset + action.text.length, action.text.trim()) })) }
      }
      const id = ids(state)
      const blocks = parseLines(action.text, id.next)
      return insertBlocks({ ...state, idCount: id.count() }, blocks)
    }
    case 'MoveSlash': return state.menu._tag === 'NoMenu' ? state : { ...state, menu: { ...state.menu, active: Math.max(0, action.active) } }
    case 'ChooseInline': {
      // The trigger and query become the mention (and a space after it, like Notion) or the emoji.
      if (state.menu._tag !== 'InlineMenu') return state
      const { blockId, from, query } = state.menu
      const target = B.find(state.doc, blockId)
      if (target === null) return { ...state, menu: { _tag: 'NoMenu' } }
      const marks = T.marksAt(target.text, from)
      const pieces: RichText = action.piece._tag === 'Text' ? T.plain(action.piece.text, marks) : [{ ...action.piece, marks }, ...T.plain(' ', marks)]
      const text = T.insert(T.remove(target.text, from, from + 1 + query.length), from, pieces)
      const offset = from + T.lengthOf(pieces)
      return withHistory(state, { ...state, doc: B.update(state.doc, blockId, entry => ({ ...entry, text })), menu: { _tag: 'NoMenu' }, selection: caret(blockId, offset), typingMarks: null }, 'none')
    }
    case 'ChooseSlash': {
      if (state.menu._tag !== 'SlashMenu') return state
      const { blockId, from, query } = state.menu
      const target = B.find(state.doc, blockId)
      if (target === null) return { ...state, menu: { _tag: 'NoMenu' } }
      const text = T.remove(target.text, from, from + 1 + query.length)
      const kind = B.kindOf(action.tag, action.level)
      const id = ids(state)
      // An empty block becomes the chosen one; otherwise it goes below (Notion).
      const columns = (): ReadonlyArray<Block> => kind._tag === 'ColumnList' ? [0, 1].map(() => B.block(id.next(), { _tag: 'Column', ratio: 1 }, [], [B.paragraph(id.next())])) : []
      if (T.lengthOf(text) === 0) {
        const doc = B.update(state.doc, blockId, entry => ({ ...entry, kind, text: hasText(kind) ? text : [], children: kind._tag === 'ColumnList' ? columns() : entry.children }))
        const after = hasText(kind) ? doc : B.insertAfter(doc, blockId, [B.paragraph(id.next())])
        const caretId = kind._tag === 'Table' ? B.cellId(blockId, 0, 0) : hasText(kind) ? blockId : (B.nextVisible(after, blockId)?.id ?? blockId)
        return withHistory(state, { ...state, doc: after, menu: { _tag: 'NoMenu' }, selection: caret(caretId, 0), idCount: id.count() }, 'none')
      }
      const fresh = B.block(id.next(), kind, [], columns())
      const doc = B.insertAfter(B.update(state.doc, blockId, entry => ({ ...entry, text })), blockId, [fresh])
      return withHistory(state, { ...state, doc, menu: { _tag: 'NoMenu' }, selection: hasText(kind) ? caret(fresh.id, 0) : { _tag: 'BlockSelection', ids: [fresh.id], anchorId: fresh.id }, idCount: id.count() }, 'none')
    }
    case 'Drop': {
      if (action.ids.includes(action.targetId)) return state
      const id = ids(state)
      const doc = B.moveBlocks(state.doc, action.ids, action.targetId, action.place, id.next)
      return withHistory(state, { ...state, doc, idCount: id.count(), selection: { _tag: 'BlockSelection', ids: action.ids, anchorId: action.ids[0] ?? '' } }, 'none')
    }
    case 'CloseMenu': return { ...state, menu: { _tag: 'NoMenu' } }
    case 'Undo': {
      const last = state.undo.at(-1)
      return last === undefined ? state : { ...state, doc: last.doc, selection: last.selection, undo: state.undo.slice(0, -1), redo: [...state.redo, { doc: state.doc, selection: state.selection }], lastEdit: 'none', menu: { _tag: 'NoMenu' } }
    }
    case 'Redo': {
      const last = state.redo.at(-1)
      return last === undefined ? state : { ...state, doc: last.doc, selection: last.selection, redo: state.redo.slice(0, -1), undo: [...state.undo, { doc: state.doc, selection: state.selection }], lastEdit: 'none' }
    }
    case 'ReplaceDocument': {
      const selection = state.selection._tag === 'TextSelection'
        ? (() => {
            const anchor = clampPoint(action.doc, state.selection.anchor)
            const focus = clampPoint(action.doc, state.selection.focus)
            return anchor === null || focus === null ? { _tag: 'NoSelection' as const } : { _tag: 'TextSelection' as const, anchor, focus }
          })()
        : state.selection
      return { ...state, doc: action.doc.length === 0 ? state.doc : action.doc, selection }
    }
  }
}
