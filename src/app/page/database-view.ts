import { Option, Schema as S } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import * as Icon from '@/lib/icon'
import { cn } from '@/lib/utils'
import { button } from '@/ui/button'
import { checkbox } from '@/ui/checkbox'
import { datePicker } from '@/ui/date-picker'
import { input } from '@/ui/input'
import { link } from '@/ui/link'

import * as D from '../database'
import { DB_GRID, DB_VIEW, box, optionChip } from '../view/design'
import { pageIcon } from '../view/icons'

/* A database page: view tabs, the toolbar and the active view; and, on a
   row's own page, its properties under the title. What is being edited (a
   cell, a date, a property name) is in the page Model as `DatabaseUi`. */

/** A row of the open database, as views show it. */
export const RowEntry = S.Struct({
  id: S.String,
  title: S.String,
  icon: S.String,
  values: D.Values,
  isLocked: S.Boolean,
  createdAt: S.Number,
  createdBy: S.String,
  updatedAt: S.Number,
  updatedBy: S.String,
  /** The start of the row page's text, for gallery cards and peeks. */
  preview: S.String,
})
export type RowEntry = typeof RowEntry.Type

/** The database a page is a row of, for its property list. */
export const ParentDatabase = S.Struct({ id: S.String, title: S.String, database: D.Database })
export type ParentDatabase = typeof ParentDatabase.Type

export const CellEdit = S.Struct({ rowId: S.String, propertyId: S.String, draft: S.String })
export type CellEdit = typeof CellEdit.Type

export const DatabaseUi = S.Struct({
  /** The view tab picked; null for the first. */
  viewId: S.NullOr(S.String),
  /** The toolbar search; null while closed. */
  query: S.NullOr(S.String),
  /** A text, number, URL, email or phone cell (or a row title) being typed in. */
  editing: S.NullOr(CellEdit),
  /** The date cell whose calendar is open, at a month. */
  datePick: S.NullOr(S.Struct({ rowId: S.String, propertyId: S.String, month: S.String })),
  /** A property name being typed in its header. */
  month: S.NullOr(S.String),
  dragging: S.NullOr(S.String),
  dropOn: S.NullOr(S.String),
  renaming: S.NullOr(S.Struct({ propertyId: S.String, name: S.String })),
  /** The row open in a side or center peek. */
  peek: S.NullOr(S.String),
})
export type DatabaseUi = typeof DatabaseUi.Type

export const emptyUi: DatabaseUi = { viewId: null, query: null, editing: null, datePick: null, month: null, dragging: null, dropOn: null, renaming: null, peek: null }

export const CELL_INPUT_ID = 'cell-input'
export const PROPERTY_NAME_ID = 'property-name'
export const DB_SEARCH_ID = 'database-search'

export const PEEK_SCOPE = 'peek-'
export const cellId = (rowId: string, propertyId: string, scope = '') => `${scope}cell-${rowId}-${propertyId}`
export const headerAnchor = (propertyId: string) => `--prop-${propertyId}`
export const cellAnchor = (rowId: string, propertyId: string, scope = '') => `--${scope}cell-${rowId}-${propertyId}`
export const viewAnchor = (viewId: string) => `--view-${viewId}`
export const ADD_VIEW_ANCHOR = '--add-view'
export const ADD_PROPERTY_ANCHOR = '--add-property'
export const FILTER_ANCHOR = '--add-filter'
export const SORT_ANCHOR = '--sorts'
export const filterAnchor = (filterId: string) => `--filter-${filterId}`

/** Picker targets carry a row and a property as `row|property`. */
export const cellTarget = (rowId: string, propertyId: string) => `${rowId}|${propertyId}`
export const parseTarget = (target: string): Readonly<{ rowId: string; propertyId: string }> | null => {
  const [rowId, propertyId, ...rest] = target.split('|')
  return rowId === undefined || propertyId === undefined || rest.length > 0 || rowId === '' || propertyId === '' ? null : { rowId, propertyId }
}

/** The view shown: the picked one, or the first. */
export const activeView = (database: D.Database, ui: DatabaseUi): D.DatabaseView | null =>
  database.views.find(view => view.id === ui.viewId) ?? database.views[0] ?? null

/** Properties typed into (rather than picked from a menu or toggled). */
export const isTyped = (property: D.Property | null): boolean =>
  property === null || ['Text', 'Number', 'Url', 'Email', 'Phone'].includes(property.type._tag)

export const isPicked = (property: D.Property): boolean => ['Select', 'MultiSelect', 'Status', 'Person'].includes(property.type._tag)

export const isComputed = (property: D.Property): boolean => ['CreatedTime', 'CreatedBy', 'LastEditedTime', 'LastEditedBy', 'Id'].includes(property.type._tag)

/** What a typed cell starts with when it opens. */
export const draftOf = (property: D.Property | null, row: RowEntry): string => {
  if (property === null) return row.title
  const value = D.valueOf(property, row)
  return value?._tag === 'TextValue' ? value.text : value?._tag === 'NumberValue' ? String(property.type._tag === 'Number' && property.type.format === 'percent' ? value.value * 100 : value.value) : ''
}

export const TYPE_ICON: Readonly<Record<D.PropertyTag | 'Title', string>> = {
  Title: 'type', Id: 'list-ordered', Text: 'pilcrow', Number: 'chart-bar-stacked', Select: 'circle-dot', MultiSelect: 'tags', Status: 'loader-circle', Date: 'calendar', Person: 'users',
  Checkbox: 'square-check', Url: 'link', Email: 'at-sign', Phone: 'pin', CreatedTime: 'clock', CreatedBy: 'user', LastEditedTime: 'clock', LastEditedBy: 'user',
}

const typeIcon = <Msg>(tag: D.PropertyTag | 'Title', h: HtmlBuilder<Msg>): Html => Icon.icon(TYPE_ICON[tag], { class: 'size-3.5 shrink-0' }, h)

export const LAYOUT_ICON: Readonly<Record<D.Layout, string>> = { table: 'table', board: 'kanban', list: 'list', gallery: 'layout-grid', calendar: 'calendar' }

export type DatabaseMessages<Msg> = Readonly<{
  view: (viewId: string) => Msg
  viewMenu: (viewId: string) => Msg
  addView: Msg
  header: (propertyId: string) => Msg
  addProperty: Msg
  propertyName: (name: string) => Msg
  submitPropertyName: Msg
  cell: (rowId: string, propertyId: string) => Msg
  changeCell: (text: string) => Msg
  submitCell: Msg
  cancelCell: Msg
  toggle: (rowId: string, propertyId: string, isChecked: boolean) => Msg
  date: (rowId: string, propertyId: string) => Msg
  dateMonth: (month: string) => Msg
  pickDate: (day: string) => Msg
  clearDate: Msg
  closeDate: Msg
  newRow: Msg
  search: Msg
  query: (query: string) => Msg
  newInGroup: (key: string) => Msg
  newOnDay: (day: string) => Msg
  dragCard: (rowId: string) => Msg
  endDrag: Msg
  enterDrop: (key: string) => Msg
  drop: (key: string) => Msg
  month: (month: string) => Msg
  addFilter: Msg
  filter: (filterId: string) => Msg
  sorts: Msg
  peek: (rowId: string) => Msg
  closePeek: Msg
  resize: (propertyId: string, width: number) => Msg
  hideGroup: (key: string, isHidden: boolean) => Msg
}>

export type CellContext<Msg> = Readonly<{
  ui: DatabaseUi
  people: ReadonlyArray<D.Person>
  today: string
  isEditable: boolean
  msgs: DatabaseMessages<Msg>
  /** Prefixes cell ids, so a peek can show a row the table shows too. */
  scope: string
  /** Open buttons peek instead of going to the row page. */
  isPeeking: boolean
}>

const chips = <Msg>(property: D.Property, row: RowEntry, h: HtmlBuilder<Msg>): ReadonlyArray<Html> => {
  const value = D.valueOf(property, row)
  const ids = value?._tag === 'OptionValue' ? [value.optionId] : value?._tag === 'OptionsValue' ? value.optionIds : []
  return ids.flatMap(optionId => {
    const option = D.optionsOf(property).find(entry => entry.id === optionId)
    return option === undefined ? [] : [optionChip({ color: option.color, isStatus: property.type._tag === 'Status', children: [option.name] }, h)]
  })
}

/** How a value reads in a cell. */
const shown = <Msg>(property: D.Property | null, row: RowEntry, people: ReadonlyArray<D.Person>, h: HtmlBuilder<Msg>): ReadonlyArray<Html | string> => {
  if (property === null) return [row.title === '' ? box({ as: 'span', class: 'text-muted-foreground', children: ['Untitled'] }, h) : row.title]
  switch (property.type._tag) {
    case 'Select': case 'MultiSelect': case 'Status': return chips(property, row, h)
    case 'Number': {
      const value = D.valueOf(property, row)
      return value?._tag === 'NumberValue' ? [D.formatNumber(value.value, property.type.format)] : []
    }
    case 'Person': case 'CreatedBy': case 'LastEditedBy': {
      const text = D.textOf(property, row, people)
      return text === '' ? [] : text.split(', ').map(name => optionChip({ color: 'default', children: [name] }, h))
    }
    case 'CreatedTime': case 'LastEditedTime': {
      const at = property.type._tag === 'CreatedTime' ? row.createdAt : row.updatedAt
      return [new Date(at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })]
    }
    case 'Date': {
      const value = D.valueOf(property, row)
      return value?._tag === 'DateValue' ? [formatDay(value.start)] : []
    }
    default: return [D.textOf(property, row, people)]
  }
}

export const formatDay = (day: string): string => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** One cell: shown, or being edited, for the property (null: the title). */
export const cellView = <Msg>(property: D.Property | null, row: RowEntry, context: CellContext<Msg>, h: HtmlBuilder<Msg>): Html => {
  const { ui, msgs } = context
  const propertyId = property?.id ?? D.TITLE
  const id = cellId(row.id, propertyId, context.scope)
  const isEditable = context.isEditable && !row.isLocked && (property === null || !isComputed(property))
  const editing = ui.editing?.rowId === row.id && ui.editing.propertyId === propertyId ? ui.editing : null
  if (editing !== null && isEditable) {
    return box({ as: 'form', class: 'w-full', attributes: [h.DataAttribute('cell', id), h.OnSubmit(msgs.submitCell), h.OnFocusLeave(msgs.submitCell),
        h.OnKeyDownPreventDefault(key => (key === 'Escape' ? Option.some(msgs.cancelCell) : Option.none()))], children: [
        input({ id: CELL_INPUT_ID, value: editing.draft, ariaLabel: property?.name ?? 'Name', autocomplete: 'off', variant: 'compact', onInput: msgs.changeCell }, h),
      ] }, h)
  }
  if (property?.type._tag === 'Checkbox') {
    const value = D.valueOf(property, row)
    const isChecked = value?._tag === 'CheckboxValue' && value.isChecked
    return box({ class: 'flex h-8 items-center px-2', attributes: [h.DataAttribute('cell', id)], children: [
        checkbox({ id, isChecked, isReadOnly: !isEditable, ...(isEditable ? { onToggle: (next: boolean) => msgs.toggle(row.id, property.id, next) } : {}) }, h),
      ] }, h)
  }
  if (property?.type._tag === 'Date') {
    const value = D.valueOf(property, row)
    const isOpen = ui.datePick?.rowId === row.id && ui.datePick.propertyId === property.id
    return box({ class: 'w-full', attributes: [h.DataAttribute('cell', id), ...(isOpen ? [h.OnKeyDownPreventDefault(key => (key === 'Escape' ? Option.some(msgs.closeDate) : Option.none()))] : [])], children: [
        datePicker({
          id, value: value?._tag === 'DateValue' ? value.start : '', openMonth: isOpen ? (ui.datePick?.month ?? null) : null, today: context.today,
          placeholder: '', ariaLabel: property.name, isDisabled: !isEditable, size: 'dense',
          onToggle: msgs.date(row.id, property.id), onClose: msgs.closeDate, onMonth: msgs.dateMonth, onSelect: msgs.pickDate, onClear: msgs.clearDate,
        }, h),
      ] }, h)
  }
  const content = shown(property, row, context.people, h)
  const isUrl = property?.type._tag === 'Url' && content.length > 0
  return box({ class: 'group/cell relative flex min-h-8 w-full items-center', style: { anchorName: cellAnchor(row.id, propertyId, context.scope) }, children: [
      box({ as: 'button', id, class: cn('flex min-h-8 w-full min-w-0 flex-wrap items-center gap-1 px-2 py-1 text-left', isEditable ? 'cursor-text hover:bg-accent/60' : 'cursor-default', property === null && 'font-medium'),
        attributes: [h.Type('button'), h.DataAttribute('cell', id), h.AriaLabel(`${property?.name ?? 'Name'}: ${D.textOf(property, row, context.people) || 'empty'}`), ...(isEditable ? [h.OnClick(msgs.cell(row.id, propertyId))] : [])],
        children: property === null ? [box({ as: 'span', class: 'flex min-w-0 items-center gap-1.5', children: [...(row.icon === '' ? [] : [pageIcon(row.icon, h)]), box({ as: 'span', class: 'min-w-0 truncate', children: content }, h)] }, h)] : content }, h),
      ...(property === null
        ? [box({ class: 'absolute top-1 right-1 opacity-0 group-hover/cell:opacity-100 focus-within:opacity-100', children: [context.isPeeking
            ? button({ variant: 'outline', size: 'compact', id: `open-${row.id}`, ariaLabel: `Open ${row.title === '' ? 'Untitled' : row.title}`, onClick: msgs.peek(row.id), children: ['Open'] }, h)
            : link({ href: `/p/${row.id}`, children: ['Open'], label: `Open ${row.title === '' ? 'Untitled' : row.title}` }, h)] }, h)]
        : isUrl ? [box({ class: 'absolute top-1 right-1 opacity-0 group-hover/cell:opacity-100', children: [link({ href: D.textOf(property, row, context.people), target: '_blank', children: [Icon.arrowUpRight({ class: 'size-3.5' }, h)], label: 'Open link' }, h)] }, h)]
        : []),
    ] }, h)
}

export type DatabaseProps<Msg> = CellContext<Msg> & Readonly<{ pageId: string; database: D.Database; rows: ReadonlyArray<RowEntry> }>

const widthOf = <Msg>(props: DatabaseProps<Msg>, propertyId: string): Readonly<Record<string, string>> => {
  const width = activeView(props.database, props.ui)?.widths?.[propertyId]
  return width === undefined ? {} : { width: `${width}px` }
}

const ResizeDetail = S.Struct({ propertyId: S.String, width: S.Number })

/** The table's one listener for column edges dragged in the browser (public/column-resize.js). */
const onResize = <Msg>(props: DatabaseProps<Msg>): Attribute<Msg> => ({
  _tag: 'OnCustomEvent',
  name: 'hyperresize',
  f: (event: CustomEvent<unknown>) => Option.map(S.decodeUnknownOption(ResizeDetail)(event.detail), detail => props.msgs.resize(detail.propertyId, detail.width)),
})

const headerCell = <Msg>(property: D.Property | null, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>): Html => {
  const { ui, msgs } = props
  const propertyId = property?.id ?? D.TITLE
  const name = property?.name ?? 'Name'
  const renaming = property !== null && ui.renaming?.propertyId === property.id ? ui.renaming : null
  return box({ class: cn(DB_GRID.cell, DB_GRID.head, property === null && DB_GRID.title), attributes: [h.Role('columnheader'), h.DataAttribute('column', propertyId)], style: { anchorName: headerAnchor(propertyId), ...widthOf(props, propertyId) }, children: [
      ...(props.isEditable ? [box({ as: 'span', class: DB_GRID.resize, attributes: [h.DataAttribute('resize-column', propertyId), h.Title('Drag to resize')], children: [] }, h)] : []),
      renaming !== null
        ? box({ as: 'form', class: 'w-full px-1', attributes: [h.OnSubmit(msgs.submitPropertyName), h.OnFocusLeave(msgs.submitPropertyName)], children: [
            input({ id: PROPERTY_NAME_ID, value: renaming.name, ariaLabel: 'Property name', autocomplete: 'off', variant: 'compact', onInput: msgs.propertyName }, h),
          ] }, h)
        : box({ as: 'button', id: `header-${propertyId}`, class: 'flex w-full min-w-0 items-center gap-1.5 px-2 text-left text-[14px] text-muted-foreground hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent', attributes: [h.Type('button'), ...(props.isEditable ? [h.OnClick(msgs.header(propertyId))] : [h.Disabled(true)])], children: [
            typeIcon(property?.type._tag ?? 'Title', h),
            box({ as: 'span', class: 'min-w-0 truncate', children: [name] }, h),
          ] }, h),
    ] }, h)
}

/** Rows under a header per group when the view is grouped. A row with several
 *  tags is listed under its first one only, so its cells keep unique ids. */
const grouped = <Msg>(view: D.DatabaseView, rows: ReadonlyArray<RowEntry>, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>, render: (row: RowEntry) => Html): ReadonlyArray<Html> => {
  const property = view.groupBy === null ? null : D.propertyOf(props.database, view.groupBy)
  if (property === null || !D.canGroupBy(property)) return rows.map(render)
  const seen = new Set<string>()
  return D.groupRows(property, rows, props.people).flatMap(group => {
    const own = group.rows.filter(row => !seen.has(row.id))
    for (const row of own) seen.add(row.id)
    return [
      box({ class: DB_VIEW.group, attributes: [h.DataAttribute('group', group.key)], children: [
          optionChip({ color: group.color, isStatus: property.type._tag === 'Status', children: [group.label] }, h),
          box({ as: 'span', class: 'text-muted-foreground', attributes: [h.DataAttribute('count', group.key)], children: [String(own.length)] }, h),
        ] }, h),
      ...own.map(render),
    ]
  })
}

/** How a filter chip reads: "Status: Done", "Name: contains road", "Due is empty". */
export const filterLabel = (database: D.Database, filter: D.Filter, people: ReadonlyArray<D.Person>): string => {
  const property = filter.propertyId === D.TITLE ? null : D.propertyOf(database, filter.propertyId)
  const name = property?.name ?? 'Name'
  if (D.isUnary(filter.operator)) return `${name} ${D.OPERATOR_LABEL[filter.operator]}`
  if (filter.value === '') return name
  const value = D.optionsOf(property ?? { id: '', name: '', type: { _tag: 'Text' } }).find(option => option.id === filter.value)?.name
    ?? people.find(member => member.id === filter.value)?.name
    ?? (property?.type._tag === 'Date' ? formatDay(filter.value) : filter.value)
  return filter.operator === 'is' || filter.operator === 'contains' ? `${name}: ${value}` : `${name}: ${D.OPERATOR_LABEL[filter.operator]} ${value}`
}

const filterBar = <Msg>(view: D.DatabaseView, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>): Html => {
  const nameOf = (propertyId: string) => (propertyId === D.TITLE ? 'Name' : (D.propertyOf(props.database, propertyId)?.name ?? ''))
  const first = view.sorts[0]
  return box({ class: 'flex flex-wrap items-center gap-1 py-1.5', attributes: [h.Id('database-filters')], children: [
      ...(first === undefined ? [] : [box({ class: 'flex', children: [
          button({ variant: 'outline', size: 'compact', id: 'sort-chip', isDisabled: !props.isEditable, onClick: props.msgs.sorts, children: [Icon.icon('arrow-up-down', { class: 'size-3.5' }, h), view.sorts.length === 1 ? nameOf(first.propertyId) : `${view.sorts.length} sorts`] }, h),
        ] }, h)]),
      ...view.filters.map(filter => box({ class: 'flex', style: { anchorName: filterAnchor(filter.id) }, children: [
          button({ variant: 'outline', size: 'compact', id: `filter-${filter.id}`, isDisabled: !props.isEditable, onClick: props.msgs.filter(filter.id), children: [filterLabel(props.database, filter, props.people)] }, h),
        ] }, h)),
      ...(props.isEditable ? [button({ variant: 'quiet', size: 'compact', id: 'add-filter', onClick: props.msgs.addFilter, children: [Icon.plus({ class: 'size-3.5' }, h), 'Add filter'] }, h)] : []),
    ] }, h)
}

const tableView = <Msg>(view: D.DatabaseView, rows: ReadonlyArray<RowEntry>, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>): Html => {
  const shownProperties = props.database.properties.filter(property => !view.hidden.includes(property.id))
  return box({ class: DB_GRID.scroll, attributes: [h.Id('database-table'), h.DataAttribute('layout', 'table')], children: [
      box({ class: DB_GRID.table, attributes: [h.Role('table'), h.AriaLabel(view.name), ...(props.isEditable ? [onResize(props)] : [])], children: [
          box({ class: DB_GRID.row, attributes: [h.Role('row')], children: [
              headerCell(null, props, h),
              ...shownProperties.map(property => headerCell(property, props, h)),
              box({ class: cn(DB_GRID.cell, DB_GRID.add), style: { anchorName: ADD_PROPERTY_ANCHOR }, children: [
                  button({ variant: 'ghost', size: 'icon-sm', id: 'add-property', ariaLabel: 'Add a property', title: 'Add a property', isDisabled: !props.isEditable, onClick: props.msgs.addProperty, children: [Icon.plus({ class: 'size-4' }, h)] }, h),
                ] }, h),
            ] }, h),
          ...grouped(view, rows, props, h, row => box({ class: DB_GRID.row, attributes: [h.Role('row'), h.DataAttribute('row', row.id)], children: [
              box({ class: cn(DB_GRID.cell, DB_GRID.title), attributes: [h.Role('cell'), h.DataAttribute('column', D.TITLE)], style: widthOf(props, D.TITLE), children: [cellView(null, row, props, h)] }, h),
              ...shownProperties.map(property => box({ class: DB_GRID.cell, attributes: [h.Role('cell'), h.DataAttribute('column', property.id)], style: widthOf(props, property.id), children: [cellView(property, row, props, h)] }, h)),
              box({ class: cn(DB_GRID.cell, DB_GRID.add), children: [] }, h),
            ] }, h)),
        ] }, h),
      box({ class: 'flex items-center justify-between border-b', children: [
          button({ variant: 'quiet', size: 'compact', id: 'new-row', isDisabled: !props.isEditable, onClick: props.msgs.newRow, children: [Icon.plus({ class: 'size-4' }, h), 'New page'] }, h),
          box({ as: 'span', class: 'px-2 text-[12px] text-muted-foreground', attributes: [h.Id('row-count')], children: [box({ as: 'span', class: 'uppercase', children: ['Count '] }, h), String(rows.length)] }, h),
        ] }, h),
    ] }, h)
}

const DAY = 86_400_000
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DAY_TEXT = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export const isMonth = (text: string): boolean => MONTH.test(text)
export const isDay = (text: string): boolean => DAY_TEXT.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text

/** The month `by` months after `month` (YYYY-MM). */
export const shiftMonth = (month: string, by: number): string => {
  const [year, index] = month.split('-').map(Number)
  return new Date(Date.UTC(year ?? 1970, (index ?? 1) - 1 + by, 1)).toISOString().slice(0, 7)
}

/** The days a month grid shows: whole weeks from Sunday, covering the month. */
export const monthDays = (month: string): ReadonlyArray<string> => {
  const [year, index] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year ?? 1970, (index ?? 1) - 1, 1))
  const length = new Date(Date.UTC(year ?? 1970, index ?? 1, 0)).getUTCDate()
  const weeks = Math.ceil((first.getUTCDay() + length) / 7)
  const start = first.getTime() - first.getUTCDay() * DAY
  return Array.from({ length: weeks * 7 }, (_, offset) => new Date(start + offset * DAY).toISOString().slice(0, 10))
}

/** The day a row sits on in a calendar by `property`. */
export const dayOf = (property: D.Property, row: RowEntry): string | null => {
  switch (property.type._tag) {
    case 'CreatedTime': return new Date(row.createdAt).toISOString().slice(0, 10)
    case 'LastEditedTime': return new Date(row.updatedAt).toISOString().slice(0, 10)
    default: {
      const value = D.valueOf(property, row)
      return value?._tag === 'DateValue' ? value.start.slice(0, 10) : null
    }
  }
}

const shownOn = (view: D.DatabaseView, database: D.Database): ReadonlyArray<D.Property> =>
  database.properties.filter(property => !view.hidden.includes(property.id) && property.id !== view.groupBy)

const titleLink = <Msg>(row: RowEntry, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>): Html => {
  const label = `Open ${row.title === '' ? 'Untitled' : row.title}`
  const title = box({ as: 'span', class: 'flex min-w-0 items-center gap-1.5 font-medium', children: [...(row.icon === '' ? [] : [pageIcon(row.icon, h)]), box({ as: 'span', class: 'min-w-0 truncate', children: shown(null, row, [], h) }, h)] }, h)
  return props.isPeeking
    ? box({ as: 'button', class: 'flex min-w-0 text-left hover:underline', attributes: [h.Type('button'), h.AriaLabel(label), h.DataAttribute('open', row.id), h.OnClick(props.msgs.peek(row.id))], children: [title] }, h)
    : link({ href: `/p/${row.id}`, label, children: [title] }, h)
}

/** The non-empty values of a row's shown properties, for cards and list rows. */
const values = <Msg>(properties: ReadonlyArray<D.Property>, row: RowEntry, people: ReadonlyArray<D.Person>, h: HtmlBuilder<Msg>): ReadonlyArray<Html> =>
  properties.flatMap(property => {
    const content = shown(property, row, people, h)
    return content.length === 0 || content.every(part => part === '')
      ? []
      : [box({ as: 'span', class: 'flex min-w-0 flex-wrap items-center gap-1 text-[12px] text-muted-foreground', attributes: [h.DataAttribute('value', property.id)], children: content }, h)]
  })

const dragAttributes = <Msg>(row: RowEntry, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>) =>
  props.isEditable && !row.isLocked ? [h.Draggable(true), h.OnDragStart(props.msgs.dragCard(row.id)), h.OnDragEnd(props.msgs.endDrag)] : []

const dropAttributes = <Msg>(key: string, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>) =>
  props.isEditable ? [h.AllowDrop(), h.OnDragEnter(props.msgs.enterDrop(key)), h.OnDrop(props.msgs.drop(key)), h.DataAttribute('drop-on', String(props.ui.dropOn === key && props.ui.dragging !== null))] : []

const card = <Msg>(view: D.DatabaseView, row: RowEntry, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>, isGallery = false): Html =>
  box({ as: 'article', class: cn(DB_VIEW.card, props.ui.dragging === row.id && DB_VIEW.dragged), attributes: [h.DataAttribute('row', row.id), ...dragAttributes(row, props, h)], children: [
      ...(isGallery ? [box({ class: DB_VIEW.preview, children: row.preview !== '' ? [box({ as: 'p', class: 'line-clamp-5 self-start p-3 text-left text-[12px] text-muted-foreground', children: [row.preview] }, h)] : row.icon === '' ? [Icon.icon('file-text', { class: 'size-8' }, h)] : [pageIcon(row.icon, h)] }, h)] : []),
      box({ class: 'flex flex-col gap-1 p-2', children: [titleLink(row, props, h), ...values(shownOn(view, props.database), row, props.people, h)] }, h),
    ] }, h)

const groupSlug = (key: string) => (key === D.NO_GROUP ? 'none' : key)

/** Hidden board groups, after the shown ones; clicking one shows it again. */
const hiddenGroupsView = <Msg>(property: D.Property, groups: ReadonlyArray<D.Group<RowEntry>>, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>): ReadonlyArray<Html> =>
  groups.length === 0 ? [] : [box({ as: 'section', class: DB_VIEW.column, attributes: [h.Id('hidden-groups'), h.AriaLabel('Hidden groups')], children: [
      box({ class: 'px-1 pb-2 text-[14px] text-muted-foreground', children: ['Hidden groups'] }, h),
      ...groups.map(group => button({ variant: 'quiet', size: 'compact', id: `show-group-${groupSlug(group.key)}`, ariaLabel: `Show ${group.label}`, isDisabled: !props.isEditable, onClick: props.msgs.hideGroup(group.key, false), children: [
          optionChip({ color: group.color, isStatus: property.type._tag === 'Status', children: [group.label] }, h),
          box({ as: 'span', class: 'ml-auto text-muted-foreground', children: [String(group.rows.length)] }, h),
        ] }, h)),
    ] }, h)]

const boardView = <Msg>(view: D.DatabaseView, rows: ReadonlyArray<RowEntry>, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>): Html => {
  const property = view.groupBy === null ? null : D.propertyOf(props.database, view.groupBy)
  if (property === null || !D.canGroupBy(property)) {
    return box({ class: 'py-8 text-center text-[14px] text-muted-foreground', attributes: [h.Id('database-board'), h.DataAttribute('layout', 'board')], children: ['Group this board by a select, status or person property in the view menu.'] }, h)
  }
  return box({ class: DB_VIEW.board, attributes: [h.Id('database-board'), h.DataAttribute('layout', 'board'), h.DataAttribute('group-by', property.id)], children: [...D.groupRows(property, rows, props.people).filter(group => !(view.hiddenGroups ?? []).includes(group.key)).map(group =>
      box({ as: 'section', class: DB_VIEW.column, attributes: [h.DataAttribute('group', group.key), h.AriaLabel(group.label), ...dropAttributes(group.key, props, h)], children: [
          box({ class: 'flex items-center gap-2 px-1 pb-2 text-[14px]', children: [
              optionChip({ color: group.color, isStatus: property.type._tag === 'Status', children: [group.label] }, h),
              box({ as: 'span', class: 'text-muted-foreground', attributes: [h.DataAttribute('count', group.key)], children: [String(group.rows.length)] }, h),
              ...(props.isEditable ? [box({ class: 'ml-auto flex', children: [button({ variant: 'ghost', size: 'icon-xs', id: `hide-group-${groupSlug(group.key)}`, ariaLabel: `Hide ${group.label}`, title: 'Hide group', onClick: props.msgs.hideGroup(group.key, true), children: [Icon.icon('eye-off', { class: 'size-3.5' }, h)] }, h)] }, h)] : []),
            ] }, h),
          ...group.rows.map(row => card(view, row, props, h)),
          ...(props.isEditable ? [button({ variant: 'quiet', size: 'compact', id: `new-in-${group.key === D.NO_GROUP ? 'none' : group.key}`, onClick: props.msgs.newInGroup(group.key), children: [Icon.plus({ class: 'size-4' }, h), 'New page'] }, h)] : []),
        ] }, h)),
      ...hiddenGroupsView(property, D.groupRows(property, rows, props.people).filter(group => (view.hiddenGroups ?? []).includes(group.key)), props, h),
    ] }, h)
}

const listView = <Msg>(view: D.DatabaseView, rows: ReadonlyArray<RowEntry>, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>): Html =>
  box({ class: 'flex flex-col', attributes: [h.Id('database-list'), h.DataAttribute('layout', 'list')], children: [
      ...grouped(view, rows, props, h, row => box({ class: DB_VIEW.line, attributes: [h.DataAttribute('row', row.id)], children: [
          box({ class: 'min-w-0 flex-1', children: [titleLink(row, props, h)] }, h),
          box({ class: 'flex shrink-0 items-center gap-3', children: values(shownOn(view, props.database), row, props.people, h) }, h),
        ] }, h)),
      ...(props.isEditable ? [box({ class: 'flex', children: [button({ variant: 'quiet', size: 'compact', id: 'new-row', onClick: props.msgs.newRow, children: [Icon.plus({ class: 'size-4' }, h), 'New page'] }, h)] }, h)] : []),
    ] }, h)

const galleryView = <Msg>(view: D.DatabaseView, rows: ReadonlyArray<RowEntry>, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>): Html =>
  box({ class: DB_VIEW.gallery, attributes: [h.Id('database-gallery'), h.DataAttribute('layout', 'gallery'), h.DataAttribute('size', view.cardSize ?? 'medium')], children: [
      ...rows.map(row => card(view, row, props, h, true)),
      ...(props.isEditable ? [button({ variant: 'quiet', size: 'compact', id: 'new-row', onClick: props.msgs.newRow, children: [Icon.plus({ class: 'size-4' }, h), 'New page'] }, h)] : []),
    ] }, h)

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const calendarView = <Msg>(view: D.DatabaseView, rows: ReadonlyArray<RowEntry>, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>): Html => {
  const property = view.dateBy === null ? null : D.propertyOf(props.database, view.dateBy)
  if (property === null) {
    return box({ class: 'py-8 text-center text-[14px] text-muted-foreground', attributes: [h.Id('database-calendar'), h.DataAttribute('layout', 'calendar')], children: ['Add a date property to show this calendar.'] }, h)
  }
  const month = props.ui.month ?? props.today.slice(0, 7)
  const canMove = props.isEditable && property.type._tag === 'Date'
  const title = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return box({ class: 'flex flex-col', attributes: [h.Id('database-calendar'), h.DataAttribute('layout', 'calendar'), h.DataAttribute('month', month), h.DataAttribute('date-by', property.id)], children: [
      box({ class: 'flex items-center gap-1 py-2', children: [
          box({ as: 'h3', class: 'flex-1 text-[14px] font-semibold', attributes: [h.Id('calendar-month')], children: [title] }, h),
          button({ variant: 'quiet', size: 'icon-sm', id: 'calendar-previous', ariaLabel: 'Previous month', title: 'Previous month', onClick: props.msgs.month(shiftMonth(month, -1)), children: [Icon.icon('chevron-left', { class: 'size-4' }, h)] }, h),
          button({ variant: 'quiet', size: 'compact', id: 'calendar-today', onClick: props.msgs.month(props.today.slice(0, 7)), children: ['Today'] }, h),
          button({ variant: 'quiet', size: 'icon-sm', id: 'calendar-next', ariaLabel: 'Next month', title: 'Next month', onClick: props.msgs.month(shiftMonth(month, 1)), children: [Icon.icon('chevron-right', { class: 'size-4' }, h)] }, h),
        ] }, h),
      box({ class: DB_VIEW.calendar, attributes: [h.Role('grid'), h.AriaLabel(title)], children: [
          ...WEEKDAYS.map(day => box({ class: 'px-2 py-1 text-[12px] text-muted-foreground', children: [day] }, h)),
          ...monthDays(month).map(day => box({ class: cn(DB_VIEW.day, !day.startsWith(month) && DB_VIEW.outside), attributes: [h.Role('gridcell'), h.DataAttribute('day', day), ...(canMove ? dropAttributes(day, { ...props, isEditable: canMove }, h) : [])], children: [
              box({ class: 'flex items-center justify-between', children: [
                  ...(canMove ? [box({ class: DB_VIEW.dayAdd, children: [button({ variant: 'quiet', size: 'icon-sm', id: `new-on-${day}`, ariaLabel: `New page on ${formatDay(day)}`, title: 'New page', onClick: props.msgs.newOnDay(day), children: [Icon.plus({ class: 'size-3.5' }, h)] }, h)] }, h)] : [box({ children: [] }, h)]),
                  box({ as: 'span', class: cn('px-1 text-[12px]', day === props.today ? DB_VIEW.today : 'text-muted-foreground'), children: [String(Number(day.slice(8)))] }, h),
                ] }, h),
              ...rows.filter(row => dayOf(property, row) === day).map(row => box({ class: cn(DB_VIEW.event, props.ui.dragging === row.id && DB_VIEW.dragged), attributes: [h.DataAttribute('row', row.id), ...(canMove ? dragAttributes(row, props, h) : [])], children: [titleLink(row, props, h)] }, h)),
            ] }, h)),
        ] }, h),
    ] }, h)
}

const layoutView = <Msg>(view: D.DatabaseView, rows: ReadonlyArray<RowEntry>, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>): Html => {
  switch (view.layout) {
    case 'board': return boardView(view, rows, props, h)
    case 'list': return listView(view, rows, props, h)
    case 'gallery': return galleryView(view, rows, props, h)
    case 'calendar': return calendarView(view, rows, props, h)
    default: return tableView(view, rows, props, h)
  }
}

/** Tabs, toolbar and the active view of a database page. */
export const databaseView = <Msg>(props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>): Html => {
  const { database, ui, msgs } = props
  const view = activeView(database, ui)
  const rows = view === null ? [] : D.rowsOf(database, view, props.rows, props.people, ui.query ?? '')
  const peeked = view === null || ui.peek === null ? undefined : props.rows.find(row => row.id === ui.peek)
  const behind = peeked === undefined ? props : { ...props, ui: { ...ui, editing: null, datePick: null } }
  return box({ class: 'mt-6 flex flex-col', attributes: [h.Id('database')], children: [
      box({ class: 'flex items-center gap-1 border-b pb-1', children: [
          box({ as: 'nav', class: 'flex min-w-0 flex-1 items-center gap-0.5', attributes: [h.AriaLabel('Views')], children: [
              ...database.views.map(entry => box({ class: 'flex', style: { anchorName: viewAnchor(entry.id) }, children: [
                  button({ variant: entry.id === view?.id ? 'ghost' : 'quiet', size: 'compact', id: `view-${entry.id}`,
                    onClick: entry.id === view?.id && props.isEditable ? msgs.viewMenu(entry.id) : msgs.view(entry.id),
                    children: [Icon.icon(LAYOUT_ICON[entry.layout], { class: 'size-3.5' }, h), entry.name] }, h),
                ] }, h)),
              ...(props.isEditable ? [box({ class: 'flex', style: { anchorName: ADD_VIEW_ANCHOR }, children: [
                  button({ variant: 'ghost', size: 'icon-sm', id: 'add-view', ariaLabel: 'Add a view', title: 'Add a view', onClick: msgs.addView, children: [Icon.plus({ class: 'size-4' }, h)] }, h),
                ] }, h)] : []),
            ] }, h),
          ...(props.isEditable ? [
              box({ class: 'flex', style: { anchorName: FILTER_ANCHOR }, children: [button({ variant: 'quiet', size: 'compact', id: 'database-filter', onClick: msgs.addFilter, children: [Icon.icon('list-filter', { class: 'size-4' }, h), 'Filter'] }, h)] }, h),
              box({ class: 'flex', style: { anchorName: SORT_ANCHOR }, children: [button({ variant: 'quiet', size: 'compact', id: 'database-sort', onClick: msgs.sorts, children: [Icon.icon('arrow-up-down', { class: 'size-4' }, h), 'Sort'] }, h)] }, h),
            ] : []),
          ui.query === null
            ? button({ variant: 'ghost', size: 'icon-sm', id: 'database-search-toggle', ariaLabel: 'Search this database', title: 'Search', onClick: msgs.search, children: [Icon.search({ class: 'size-4' }, h)] }, h)
            : box({ class: 'w-48', children: [input({ id: DB_SEARCH_ID, value: ui.query, placeholder: 'Type to search…', ariaLabel: 'Search this database', autocomplete: 'off', variant: 'compact', onInput: msgs.query }, h)] }, h),
          ...(props.isEditable ? [button({ variant: 'default', size: 'compact', id: 'database-new', onClick: msgs.newRow, children: ['New'] }, h)] : []),
        ] }, h),
      ...(view === null || (view.filters.length === 0 && view.sorts.length === 0) ? [] : [filterBar(view, props, h)]),
      ...(view === null ? [] : [layoutView(view, rows, behind, h)]),
      ...(view === null || peeked === undefined ? [] : peekView(D.openInOf(view) === 'center' ? 'center' : 'side', peeked, props, h)),
    ] }, h)
}

/** A row's own page: its properties under the title. */
/** A row opened over its database: its title and properties, editable in place. */
const peekView = <Msg>(mode: 'side' | 'center', row: RowEntry, props: DatabaseProps<Msg>, h: HtmlBuilder<Msg>): ReadonlyArray<Html> => {
  const context = { ...props, scope: PEEK_SCOPE, isPeeking: false }
  const title = row.title === '' ? 'Untitled' : row.title
  return [
    ...(mode === 'center' ? [box({ class: DB_VIEW.backdrop, attributes: [h.DataAttribute('peek-backdrop', ''), h.OnClick(props.msgs.closePeek)], children: [] }, h)] : []),
    box({ class: DB_VIEW.peek, attributes: [h.Id('row-peek'), h.Role('dialog'), h.AriaLabel(title), h.DataAttribute('peek', mode), h.DataAttribute('row', row.id),
        h.OnKeyDownPreventDefault(key => (key === 'Escape' && props.ui.editing === null && props.ui.datePick === null ? Option.some(props.msgs.closePeek) : Option.none()))], children: [
        box({ class: 'flex items-center gap-1 px-3 py-2', children: [
            button({ variant: 'ghost', size: 'icon-sm', id: 'peek-close', ariaLabel: 'Close', onClick: props.msgs.closePeek, children: [Icon.icon('x', { class: 'size-4' }, h)] }, h),
            link({ href: `/p/${row.id}`, label: 'Open as page', children: [Icon.icon('maximize-2', { class: 'size-3.5' }, h), 'Open as page'] }, h),
          ] }, h),
        box({ class: 'min-h-0 flex-1 overflow-y-auto px-12 pt-6 pb-16', children: [
            box({ class: 'text-[28px] leading-tight', attributes: [h.Id('peek-title')], children: [cellView(null, row, context, h)] }, h),
            propertiesView({ id: props.pageId, title: '', database: props.database }, row, context, h),
            box({ as: 'p', class: 'whitespace-pre-wrap text-[15px] text-muted-foreground', attributes: [h.Id('peek-body')], children: [row.preview === '' ? 'This page is empty. Open it as a page to write in it.' : row.preview] }, h),
          ] }, h),
      ] }, h),
  ]
}

export const propertiesView = <Msg>(parent: ParentDatabase, row: RowEntry, context: CellContext<Msg>, h: HtmlBuilder<Msg>): Html =>
  box({ class: 'mt-2 mb-4 flex flex-col border-b pb-3', attributes: [h.Id('row-properties'), h.DataAttribute('database', parent.id)], children: parent.database.properties.map(property =>
      box({ class: 'flex min-h-8 items-start text-[14px]', attributes: [h.DataAttribute('property', property.id)], children: [
          box({ class: 'flex h-8 w-40 min-w-0 shrink-0 items-center gap-1.5 px-1 text-muted-foreground', children: [typeIcon(property.type._tag, h), box({ as: 'span', class: 'min-w-0 truncate', children: [property.name] }, h)] }, h),
          box({ class: 'min-w-0 flex-1', children: [cellView(property, row, context, h)] }, h),
        ] }, h)) }, h)
