import { type Block, type Document, type Kind, type KindTag, PLAIN, type RichText, hasText, showsChildren } from './schema'
import { plain } from './text'
import { emoji } from './emoji'

/* The block tree and the edits on it, all pure: a document in, a document
   out. Untouched blocks stay the same objects. Blocks are addressed by id;
   new ids come from the caller (the editor numbers them per session). */

export const block = (id: string, kind: Kind, text: RichText = [], children: ReadonlyArray<Block> = []): Block => ({ id, kind, text, color: 'default', children })

export const paragraph = (id: string, text = ''): Block => block(id, { _tag: 'Paragraph' }, plain(text, PLAIN))

/** A kind with its default settings, for "Turn into" and the slash menu. */
export const kindOf = (tag: KindTag, level: 1 | 2 | 3 = 1): Kind => {
  switch (tag) {
    case 'Heading': return { _tag: 'Heading', level, isToggleable: false, isOpen: true }
    case 'Todo': return { _tag: 'Todo', isChecked: false }
    case 'Toggle': return { _tag: 'Toggle', isOpen: true }
    case 'Callout': return { _tag: 'Callout', icon: emoji('1f4a1') }
    case 'Code': return { _tag: 'Code', language: 'Plain text', isWrapped: false }
    case 'Image': return { _tag: 'Image', url: '', width: null }
    case 'Bookmark': return { _tag: 'Bookmark', url: '' }
    case 'Embed': return { _tag: 'Embed', url: '' }
    case 'SubPage': return { _tag: 'SubPage', pageId: '' }
    case 'LinkToPage': return { _tag: 'LinkToPage', pageId: '' }
    case 'Equation': return { _tag: 'Equation', tex: '' }
    case 'Column': return { _tag: 'Column', ratio: 1 }
    case 'Table': return { _tag: 'Table', hasHeaderRow: false, hasHeaderColumn: false, rows: [[[], [], []], [[], [], []]] }
    default: return { _tag: tag } as Kind
  }
}

// FINDING

export type Path = ReadonlyArray<number>

export const pathOf = (doc: Document, id: string): Path | null => {
  for (let index = 0; index < doc.length; index++) {
    const child = doc[index]
    if (child === undefined) continue
    if (child.id === id) return [index]
    const inner = pathOf(child.children, id)
    if (inner !== null) return [index, ...inner]
  }
  return null
}

// TABLE CELLS
// A simple table's cells are edited like text blocks: each has an id
// "<table id>~<row>~<column>", which find and update resolve into the table.

export type CellAddress = Readonly<{ tableId: string; row: number; column: number }>

export const cellId = (tableId: string, row: number, column: number): string => `${tableId}~${row}~${column}`

export const parseCell = (id: string): CellAddress | null => {
  const [tableId, row, column, ...rest] = id.split('~')
  if (tableId === undefined || row === undefined || column === undefined || rest.length > 0 || !/^\d+$/.test(row) || !/^\d+$/.test(column)) return null
  return { tableId, row: Number(row), column: Number(column) }
}

export const isCell = (id: string): boolean => parseCell(id) !== null

/** The block that owns an id: the table for a cell, else the block itself. */
export const ownerId = (id: string): string => parseCell(id)?.tableId ?? id

export const cellBlock = (id: string, text: RichText): Block => ({ id, kind: { _tag: 'Paragraph' }, text, color: 'default', children: [] })

const tableCells = (table: Block): ReadonlyArray<Block> =>
  table.kind._tag === 'Table' ? table.kind.rows.flatMap((row, r) => row.map((cell, c) => cellBlock(cellId(table.id, r, c), cell))) : []

type TableKind = Extract<Kind, { _tag: 'Table' }>

export const addRow = (kind: TableKind): TableKind => ({ ...kind, rows: [...kind.rows, (kind.rows[0] ?? [[]]).map(() => [])] })

export const addColumn = (kind: TableKind): TableKind => ({ ...kind, rows: kind.rows.map(row => [...row, []]) })

export const find = (doc: Document, id: string): Block | null => {
  const cell = parseCell(id)
  if (cell !== null) {
    const table = find(doc, cell.tableId)
    const text = table?.kind._tag === 'Table' ? table.kind.rows[cell.row]?.[cell.column] : undefined
    return text === undefined ? null : cellBlock(id, text)
  }
  for (const child of doc) {
    if (child.id === id) return child
    const inner = find(child.children, id)
    if (inner !== null) return inner
  }
  return null
}

/** The block that holds `id` among its children (null: top level). */
export const parentOf = (doc: Document, id: string, parent: Block | null = null): Block | null | undefined => {
  for (const child of doc) {
    if (child.id === id) return parent
    const inner = parentOf(child.children, id, child)
    if (inner !== undefined) return inner
  }
  return undefined
}

export const siblingsOf = (doc: Document, id: string): Document => {
  const parent = parentOf(doc, id)
  return parent === undefined ? [] : parent === null ? doc : parent.children
}

export type Visible = Readonly<{ block: Block; depth: number }>

/** Blocks in reading order, skipping the insides of closed toggles. */
export const visible = (doc: Document, depth = 0): ReadonlyArray<Visible> =>
  doc.flatMap(child => [{ block: child, depth }, ...(showsChildren(child.kind) ? visible(child.children, depth + 1) : [])])

/** Text blocks in reading order (caret movement goes through these). */
export const textBlocks = (doc: Document): ReadonlyArray<Block> =>
  visible(doc).flatMap(({ block }) => (block.kind._tag === 'Table' ? tableCells(block) : hasText(block.kind) ? [block] : []))

export const previousText = (doc: Document, id: string): Block | null => {
  const list = textBlocks(doc)
  const index = list.findIndex(entry => entry.id === id)
  return index > 0 ? (list[index - 1] ?? null) : null
}

export const nextText = (doc: Document, id: string): Block | null => {
  const list = textBlocks(doc)
  const index = list.findIndex(entry => entry.id === id)
  return index >= 0 ? (list[index + 1] ?? null) : null
}

/** The visible block before/after (any kind), for block selection. */
export const previousVisible = (doc: Document, id: string): Block | null => {
  const list = visible(doc)
  const index = list.findIndex(entry => entry.block.id === id)
  return index > 0 ? (list[index - 1]?.block ?? null) : null
}

export const nextVisible = (doc: Document, id: string): Block | null => {
  const list = visible(doc)
  const index = list.findIndex(entry => entry.block.id === id)
  return index >= 0 ? (list[index + 1]?.block ?? null) : null
}

export const allIds = (doc: Document): ReadonlyArray<string> => doc.flatMap(child => [child.id, ...allIds(child.children)])

// CHANGING

export const update = (doc: Document, id: string, change: (target: Block) => Block): Document => {
  const cell = parseCell(id)
  if (cell !== null) {
    return update(doc, cell.tableId, table => {
      const old = table.kind._tag === 'Table' ? table.kind.rows[cell.row]?.[cell.column] : undefined
      if (table.kind._tag !== 'Table' || old === undefined) return table
      const text = change(cellBlock(id, old)).text
      return text === old ? table : { ...table, kind: { ...table.kind, rows: table.kind.rows.map((row, r) => (r === cell.row ? row.map((entry, c) => (c === cell.column ? text : entry)) : row)) } }
    })
  }
  let changed = false
  const next = doc.map(child => {
    if (changed) return child
    if (child.id === id) {
      changed = true
      return change(child)
    }
    const children = update(child.children, id, change)
    if (children === child.children) return child
    changed = true
    return { ...child, children }
  })
  return changed ? next : doc
}

/** The document without the block (and its children), and the block. */
export const remove = (doc: Document, id: string): readonly [Document, Block | null] => {
  const index = doc.findIndex(child => child.id === id)
  const found = doc[index]
  if (found !== undefined) return [[...doc.slice(0, index), ...doc.slice(index + 1)], found]
  for (let at = 0; at < doc.length; at++) {
    const child = doc[at]
    if (child === undefined) continue
    const [children, removed] = remove(child.children, id)
    if (removed !== null) return [[...doc.slice(0, at), { ...child, children }, ...doc.slice(at + 1)], removed]
  }
  return [doc, null]
}

const insertNear = (doc: Document, id: string, blocks: ReadonlyArray<Block>, after: boolean): Document => {
  const index = doc.findIndex(child => child.id === id)
  if (index >= 0) return [...doc.slice(0, index + (after ? 1 : 0)), ...blocks, ...doc.slice(index + (after ? 1 : 0))]
  let changed = false
  const next = doc.map(child => {
    if (changed) return child
    const children = insertNear(child.children, id, blocks, after)
    if (children === child.children) return child
    changed = true
    return { ...child, children }
  })
  return changed ? next : doc
}

export const insertAfter = (doc: Document, id: string, blocks: ReadonlyArray<Block>): Document => insertNear(doc, id, blocks, true)
export const insertBefore = (doc: Document, id: string, blocks: ReadonlyArray<Block>): Document => insertNear(doc, id, blocks, false)

export const prependChildren = (doc: Document, parentId: string, blocks: ReadonlyArray<Block>): Document =>
  update(doc, parentId, parent => ({ ...parent, children: [...blocks, ...parent.children] }))

export const appendChildren = (doc: Document, parentId: string, blocks: ReadonlyArray<Block>): Document =>
  update(doc, parentId, parent => ({ ...parent, children: [...parent.children, ...blocks] }))

const open = (target: Block): Block =>
  target.kind._tag === 'Toggle' ? { ...target, kind: { ...target.kind, isOpen: true } }
    : target.kind._tag === 'Heading' && target.kind.isToggleable ? { ...target, kind: { ...target.kind, isOpen: true } }
      : target

/** Tab: the block goes inside the block before it (as its last child). */
export const indent = (doc: Document, id: string): Document => {
  const siblings = siblingsOf(doc, id)
  const index = siblings.findIndex(child => child.id === id)
  const previous = siblings[index - 1]
  if (index <= 0 || previous === undefined || previous.kind._tag === 'ColumnList' || previous.kind._tag === 'Table') return doc
  const [without, moved] = remove(doc, id)
  if (moved === null) return doc
  return update(without, previous.id, target => ({ ...open(target), children: [...target.children, moved] }))
}

/** Shift+Tab: the block comes out of its parent, right after it. */
export const outdent = (doc: Document, id: string): Document => {
  const parent = parentOf(doc, id)
  if (parent === null || parent === undefined || parent.kind._tag === 'Column') return doc
  const [without, moved] = remove(doc, id)
  return moved === null ? doc : insertAfter(without, parent.id, [moved])
}

/** Ctrl+Shift+↑/↓: one place up or down among the visible blocks. */
export const moveBy = (doc: Document, id: string, direction: -1 | 1): Document => {
  const siblings = siblingsOf(doc, id)
  const index = siblings.findIndex(child => child.id === id)
  const neighbour = siblings[index + direction]
  const [without, moved] = remove(doc, id)
  if (moved === null) return doc
  if (neighbour !== undefined) return direction === -1 ? insertBefore(without, neighbour.id, [moved]) : insertAfter(without, neighbour.id, [moved])
  const parent = parentOf(doc, id)
  if (parent === null || parent === undefined || parent.kind._tag === 'Column') return doc
  return direction === -1 ? insertBefore(without, parent.id, [moved]) : insertAfter(without, parent.id, [moved])
}

/** A copy with new ids for it and everything inside it. */
export const copyWithIds = (target: Block, nextId: () => string): Block => ({ ...target, id: nextId(), children: target.children.map(child => copyWithIds(child, nextId)) })

export type DropPlace = 'before' | 'after' | 'inside' | 'left' | 'right'

/** Dragging blocks onto another: above/below it, inside it, or beside it
 *  (which makes or extends columns). */
export const moveBlocks = (doc: Document, ids: ReadonlyArray<string>, targetId: string, place: DropPlace, nextId: () => string): Document => {
  if (ids.includes(targetId) || ids.some(id => find(find(doc, id)?.children ?? [], targetId) !== null)) return doc
  let rest = doc
  const moved: Array<Block> = []
  for (const id of ids) {
    const [next, removed] = remove(rest, id)
    rest = next
    if (removed !== null) moved.push(removed)
  }
  if (moved.length === 0 || find(rest, targetId) === null) return doc
  switch (place) {
    case 'before': return insertBefore(rest, targetId, moved)
    case 'after': return insertAfter(rest, targetId, moved)
    case 'inside': return update(rest, targetId, target => ({ ...open(target), children: [...target.children, ...moved] }))
    case 'left':
    case 'right': {
      const parent = parentOf(rest, targetId)
      const column = block(nextId(), { _tag: 'Column', ratio: 1 }, [], moved)
      if (parent !== null && parent !== undefined && parent.kind._tag === 'Column') {
        // Beside a block in a column: a new column next to that column.
        return place === 'left' ? insertBefore(rest, parent.id, [column]) : insertAfter(rest, parent.id, [column])
      }
      const target = find(rest, targetId)
      if (target === null) return doc
      const columns = block(nextId(), { _tag: 'ColumnList' }, [], place === 'left'
        ? [column, block(nextId(), { _tag: 'Column', ratio: 1 }, [], [target])]
        : [block(nextId(), { _tag: 'Column', ratio: 1 }, [], [target]), column])
      return update(rest, targetId, () => columns)
    }
  }
}

/** Columns left with one column (or none) dissolve; empty columns go. */
export const tidyColumns = (doc: Document): Document => {
  let changed = false
  const out: Array<Block> = []
  for (const child of doc) {
    const children = tidyColumns(child.children)
    if (children !== child.children) changed = true
    const current = children === child.children ? child : { ...child, children }
    if (current.kind._tag === 'ColumnList') {
      const columns = current.children.filter(column => column.children.length > 0)
      if (columns.length <= 1) {
        changed = true
        out.push(...(columns[0]?.children ?? []))
        continue
      }
      if (columns.length !== current.children.length) {
        changed = true
        out.push({ ...current, children: columns })
        continue
      }
    }
    out.push(current)
  }
  return changed ? out : doc
}

/** The number a numbered-list item shows: its place in the run of numbered
 *  siblings it belongs to. */
export const listNumber = (siblings: Document, index: number): number => {
  let number = 1
  for (let at = index - 1; at >= 0 && siblings[at]?.kind._tag === 'Numbered'; at--) number++
  return number
}

/** Headings in reading order, for the table of contents. */
export const headings = (doc: Document): ReadonlyArray<Readonly<{ id: string; level: 1 | 2 | 3; text: RichText }>> =>
  visible(doc).flatMap(({ block: entry }) => (entry.kind._tag === 'Heading' ? [{ id: entry.id, level: entry.kind.level, text: entry.text }] : []))
