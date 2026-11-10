import { assert, describe, it } from '@effect/vitest'

import type { Page } from '@/app/domain'
import * as D from '@/app/database'
import { filterLabel, isDay, isMonth, monthDays, shiftMonth } from '@/app/page/database-view'
import * as PagePage from '@/app/page/page'
import { DEMO_MEMBERS, demoData } from '@/app/seed'

/* The database page: cells open the editor their property type needs,
   every change is a Command, and locked or trashed databases stay put. */

const NOW = Date.UTC(2026, 10, 10, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!
type Result = ReturnType<typeof PagePage.update>
const commands = (result: Result) => (result.commands ?? []).map(command => [command.name, command.args] as const)
const names = (result: Result) => commands(result).map(([name]) => name)
const argsOf = (result: Result, name: string) => commands(result).find(([entry]) => entry === name)?.[1] as Record<string, unknown> | undefined

const model = (pageId: string, edit: (page: Page) => Page = page => page) => {
  const data = demoData(NOW)
  const pages = data.pages.map(page => (page.id === pageId ? edit(page) : page))
  const slice = PagePage.sliceOf({ version: 0, members: data.members, pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }, pageId, 'avery', NOW)
  return PagePage.init({ ...slice, me: avery, view: 'page', pageId }).model
}
const send = (start: PagePage.Model, ...messages: ReadonlyArray<PagePage.Message>) =>
  messages.reduce<Result>((result, message) => PagePage.update(result.model, message), { model: start })

describe('page: databases', () => {
  it('a database page carries its rows, in order', () => {
    const tasks = model('demo-tasks')
    assert.deepStrictEqual(tasks.rows.map(row => row.title), ['Write the database docs', 'Polish the slash menu', 'Plan the board view'])
    assert.isNull(tasks.parentDatabase)
  })

  it('a row page knows its database, for the properties under its title', () => {
    const row = model('demo-task-1')
    assert.strictEqual(row.parentDatabase?.id, 'demo-tasks')
    assert.deepStrictEqual(row.rows, [])
  })

  it('the name cell edits as text and saves the title on Enter', () => {
    const start = model('demo-tasks')
    const opened = send(start, PagePage.Message.ClickedCell({ rowId: 'demo-task-1', propertyId: 'title' }))
    assert.deepStrictEqual(opened.model.db.editing, { rowId: 'demo-task-1', propertyId: 'title', draft: 'Write the database docs' })
    const saved = send(opened.model, PagePage.Message.ChangedCell({ text: 'Write the docs' }), PagePage.Message.SubmittedCell())
    assert.isNull(saved.model.db.editing)
    assert.deepInclude(argsOf(saved, 'SaveTitle'), { pageId: 'demo-task-1', title: 'Write the docs' })
  })

  it('an unchanged or canceled cell sends nothing', () => {
    const start = model('demo-tasks')
    assert.deepStrictEqual(names(send(start, PagePage.Message.ClickedCell({ rowId: 'demo-task-1', propertyId: 'title' }), PagePage.Message.SubmittedCell())), [])
    const canceled = send(start, PagePage.Message.ClickedCell({ rowId: 'demo-task-1', propertyId: 'title' }), PagePage.Message.ChangedCell({ text: 'x' }), PagePage.Message.CanceledCell())
    assert.isNull(canceled.model.db.editing)
    assert.deepStrictEqual(names(canceled), [])
  })

  it('a status cell opens its option menu and a choice sets the value', () => {
    const opened = send(model('demo-tasks'), PagePage.Message.ClickedCell({ rowId: 'demo-task-3', propertyId: 'demo-status' }))
    assert.strictEqual(opened.model.picker?.field, 'cell')
    const chosen = send(opened.model, PagePage.Message.ChosePicker({ value: 'option:demo-done' }))
    assert.isNull(chosen.model.picker)
    assert.deepInclude(argsOf(chosen, 'SetValue'), { rowId: 'demo-task-3', propertyId: 'demo-status', value: { _tag: 'OptionValue', optionId: 'demo-done' } })
  })

  it('choosing the current option again clears it', () => {
    const chosen = send(model('demo-tasks'), PagePage.Message.ClickedCell({ rowId: 'demo-task-3', propertyId: 'demo-status' }), PagePage.Message.ChosePicker({ value: 'option:demo-todo' }))
    assert.deepInclude(argsOf(chosen, 'SetValue'), { value: null })
  })

  it('a multi-select menu stays open and toggles each option', () => {
    const start = send(model('demo-tasks'), PagePage.Message.ClickedCell({ rowId: 'demo-task-1', propertyId: 'demo-tags' }))
    assert.strictEqual(start.model.picker?.field, 'cells')
    const added = send(start.model, PagePage.Message.ChosePicker({ value: 'option:demo-tag-editor' }))
    assert.strictEqual(added.model.picker?.field, 'cells')
    assert.deepInclude(argsOf(added, 'SetValue'), { value: { _tag: 'OptionsValue', optionIds: ['demo-tag-docs', 'demo-tag-editor'] } })
    const removed = send(start.model, PagePage.Message.ChosePicker({ value: 'option:demo-tag-docs' }))
    assert.deepInclude(argsOf(removed, 'SetValue'), { value: null })
  })

  it('typing a new name creates the option, keeping the ones picked', () => {
    const opened = send(model('demo-tasks'), PagePage.Message.ClickedCell({ rowId: 'demo-task-1', propertyId: 'demo-tags' }))
    const typed = send(opened.model, PagePage.Message.ChangedPickerQuery({ query: 'Launch' }), PagePage.Message.ChosePicker({ value: 'create' }))
    assert.deepInclude(argsOf(typed, 'CreateOption'), { rowId: 'demo-task-1', propertyId: 'demo-tags', name: 'Launch', keep: ['demo-tag-docs'] })
  })

  it('a person cell picks members', () => {
    const chosen = send(model('demo-tasks'), PagePage.Message.ClickedCell({ rowId: 'demo-task-3', propertyId: 'demo-assignee' }), PagePage.Message.ChosePicker({ value: 'option:riley' }))
    assert.deepInclude(argsOf(chosen, 'SetValue'), { value: { _tag: 'PeopleValue', memberIds: ['riley'] } })
  })

  it('a date cell opens on its month and saves the picked day', () => {
    const opened = send(model('demo-tasks'), PagePage.Message.ClickedDateCell({ rowId: 'demo-task-1', propertyId: 'demo-due' }))
    assert.deepStrictEqual(opened.model.db.datePick, { rowId: 'demo-task-1', propertyId: 'demo-due', month: '2026-11' })
    const moved = send(opened.model, PagePage.Message.ChangedDateMonth({ month: '2026-12' }), PagePage.Message.ChangedDateMonth({ month: 'nope' }))
    assert.strictEqual(moved.model.db.datePick?.month, '2026-12')
    const picked = send(moved.model, PagePage.Message.PickedDate({ day: '2026-12-24' }))
    assert.isNull(picked.model.db.datePick)
    assert.deepInclude(argsOf(picked, 'SetValue'), { value: { _tag: 'DateValue', start: '2026-12-24', end: null } })
    assert.deepStrictEqual(names(send(moved.model, PagePage.Message.PickedDate({ day: '24.12.2026' }))), [])
    assert.isNull(send(opened.model, PagePage.Message.ClickedDateCell({ rowId: 'demo-task-1', propertyId: 'demo-due' })).model.db.datePick)
  })

  it('+ New page adds a row that takes the view filters, then edits its name', () => {
    const start = model('demo-tasks')
    assert.deepInclude(argsOf(send(start, PagePage.Message.ClickedNewRow()), 'AddRow'), { databaseId: 'demo-tasks' })
    const withRow = { ...start, rows: [...start.rows, { ...start.rows[0]!, id: 'row-new' }] }
    const added = send(withRow, PagePage.Message.SucceededAddRow({ rowId: 'row-new' }))
    assert.deepStrictEqual(added.model.db.editing, { rowId: 'row-new', propertyId: 'title', draft: '' })
  })

  it('header menus sort, rename and add properties', () => {
    const start = model('demo-tasks')
    const sorted = send(start, PagePage.Message.ClickedHeader({ propertyId: 'demo-due' }), PagePage.Message.ChosePicker({ value: 'sort:desc' }))
    assert.deepInclude(argsOf(sorted, 'ChangeDatabase'), { change: { _tag: 'SetSort', viewId: 'demo-tasks-table', propertyId: 'demo-due', isDescending: true } })
    const renaming = send(start, PagePage.Message.ClickedHeader({ propertyId: 'demo-due' }), PagePage.Message.ChosePicker({ value: 'rename' }))
    assert.deepStrictEqual(renaming.model.db.renaming, { propertyId: 'demo-due', name: 'Due' })
    const renamed = send(renaming.model, PagePage.Message.ChangedPropertyName({ name: 'Deadline' }), PagePage.Message.SubmittedPropertyName())
    assert.deepInclude(argsOf(renamed, 'ChangeDatabase'), { change: { _tag: 'RenameProperty', propertyId: 'demo-due', name: 'Deadline' } })
    assert.deepStrictEqual(names(send(renaming.model, PagePage.Message.ChangedPropertyName({ name: '  ' }), PagePage.Message.SubmittedPropertyName())), [])
    const added = send(start, PagePage.Message.ClickedAddProperty(), PagePage.Message.ChosePicker({ value: 'Number' }))
    assert.deepInclude(argsOf(added, 'ChangeDatabase'), { change: { _tag: 'AddProperty', tag: 'Number', name: '' } })
    assert.deepStrictEqual(names(send(start, PagePage.Message.ClickedAddProperty(), PagePage.Message.ChosePicker({ value: 'Spreadsheet' }))), [])
  })

  it('unknown rows and properties are ignored', () => {
    const start = model('demo-tasks')
    assert.deepStrictEqual(send(start, PagePage.Message.ClickedCell({ rowId: 'demo-wiki', propertyId: 'title' })).model.db, start.db)
    assert.deepStrictEqual(send(start, PagePage.Message.ClickedCell({ rowId: 'demo-task-1', propertyId: 'nope' })).model.db, start.db)
    assert.isNull(send(start, PagePage.Message.ClickedHeader({ propertyId: 'nope' })).model.picker)
    assert.deepStrictEqual(names(send(start, PagePage.Message.ToggledCell({ rowId: 'demo-task-1', propertyId: 'demo-status', isChecked: true }))), [])
  })

  it('a locked database refuses every edit', () => {
    const locked = model('demo-tasks', page => ({ ...page, isLocked: true }))
    for (const message of [
      PagePage.Message.ClickedCell({ rowId: 'demo-task-1', propertyId: 'title' }),
      PagePage.Message.ClickedDateCell({ rowId: 'demo-task-1', propertyId: 'demo-due' }),
      PagePage.Message.ClickedHeader({ propertyId: 'demo-due' }),
      PagePage.Message.ClickedAddProperty(),
      PagePage.Message.ClickedNewRow(),
    ]) {
      const result = send(locked, message)
      assert.deepStrictEqual(names(result), [], message._tag)
      assert.isNull(result.model.picker, message._tag)
      assert.deepStrictEqual(result.model.db, locked.db, message._tag)
    }
  })

  it('a page with content cannot become a database', () => {
    assert.deepStrictEqual(names(send(model('demo-wiki'), PagePage.Message.ClickedMakeDatabase({ layout: 'table' }))), [])
  })

  it('the database search narrows rows by title', () => {
    const searched = send(model('demo-tasks'), PagePage.Message.ClickedDbSearch(), PagePage.Message.ChangedDbQuery({ query: 'slash' }))
    assert.strictEqual(searched.model.db.query, 'slash')
  })

  describe('board, list, gallery and calendar views', () => {
    const tasks = (view: Partial<D.DatabaseView>, rows: Readonly<Record<string, D.Values>> = {}) => {
      const data = demoData(NOW)
      const pages = data.pages.map(page => page.id === 'demo-tasks' && page.database !== null
        ? { ...page, database: { ...page.database, views: page.database.views.map(entry => ({ ...entry, ...view })) } }
        : rows[page.id] === undefined ? page : { ...page, values: { ...page.values, ...rows[page.id] } })
      const slice = PagePage.sliceOf({ version: 0, members: data.members, pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }, 'demo-tasks', 'avery', NOW)
      return PagePage.init({ ...slice, me: avery, view: 'page', pageId: 'demo-tasks' }).model
    }

    it('the view menu switches layout, grouping and the calendar date', () => {
      const menu = (value: string) => argsOf(send(model('demo-tasks'), PagePage.Message.ClickedViewMenu({ viewId: 'demo-tasks-table' }), PagePage.Message.ChosePicker({ value })), 'ChangeDatabase')
      assert.deepInclude(menu('layout:board'), { change: { _tag: 'SetLayout', viewId: 'demo-tasks-table', layout: 'board' } })
      assert.deepInclude(menu('group:demo-status'), { change: { _tag: 'SetGroupBy', viewId: 'demo-tasks-table', propertyId: 'demo-status' } })
      assert.deepInclude(menu('group:'), { change: { _tag: 'SetGroupBy', viewId: 'demo-tasks-table', propertyId: null } })
      assert.isUndefined(menu('layout:timeline'))
      const calendar = send(tasks({ layout: 'calendar' }), PagePage.Message.ClickedViewMenu({ viewId: 'demo-tasks-table' }), PagePage.Message.ChosePicker({ value: 'date:demo-due' }))
      assert.deepInclude(argsOf(calendar, 'ChangeDatabase'), { change: { _tag: 'SetDateBy', viewId: 'demo-tasks-table', propertyId: 'demo-due' } })
    })

    it("+ New in a board column starts the row in that column's group", () => {
      const board = tasks({ layout: 'board', groupBy: 'demo-status' })
      assert.deepInclude(argsOf(send(board, PagePage.Message.ClickedNewInGroup({ key: 'demo-doing' })), 'AddRow'), { databaseId: 'demo-tasks', values: { 'demo-status': { _tag: 'OptionValue', optionId: 'demo-doing' } } })
      assert.deepInclude(argsOf(send(board, PagePage.Message.ClickedNewInGroup({ key: '' })), 'AddRow'), { values: {} })
      assert.deepStrictEqual(names(send(board, PagePage.Message.ClickedNewInGroup({ key: 'nope' }))), [])
    })

    it('dropping a card on another column sets its group value', () => {
      const board = tasks({ layout: 'board', groupBy: 'demo-status' })
      const dragging = send(board, PagePage.Message.StartedCardDrag({ rowId: 'demo-task-1' }), PagePage.Message.EnteredDropTarget({ key: 'demo-done' }))
      assert.deepInclude(dragging.model.db, { dragging: 'demo-task-1', dropOn: 'demo-done' })
      const dropped = send(dragging.model, PagePage.Message.DroppedCard({ key: 'demo-done' }))
      assert.deepInclude(argsOf(dropped, 'SetValue'), { rowId: 'demo-task-1', propertyId: 'demo-status', value: { _tag: 'OptionValue', optionId: 'demo-done' } })
      assert.deepInclude(dropped.model.db, { dragging: null, dropOn: null })
      assert.deepStrictEqual(names(send(board, PagePage.Message.DroppedCard({ key: 'demo-done' }))), [], 'nothing is being dragged')
      assert.deepStrictEqual(names(send(board, PagePage.Message.StartedCardDrag({ rowId: 'demo-wiki' }), PagePage.Message.DroppedCard({ key: 'demo-done' }))), [], 'only rows of this database')
    })

    it('a card moved to another person or tag leaves the old one', () => {
      const people = send(tasks({ layout: 'board', groupBy: 'demo-assignee' }), PagePage.Message.StartedCardDrag({ rowId: 'demo-task-1' }), PagePage.Message.DroppedCard({ key: 'morgan' }))
      assert.deepInclude(argsOf(people, 'SetValue'), { value: { _tag: 'PeopleValue', memberIds: ['morgan'] } })
      const tags = send(tasks({ layout: 'board', groupBy: 'demo-tags' }, { 'demo-task-1': { 'demo-tags': { _tag: 'OptionsValue', optionIds: ['demo-tag-docs'] } } }), PagePage.Message.StartedCardDrag({ rowId: 'demo-task-1' }), PagePage.Message.DroppedCard({ key: 'demo-tag-editor' }))
      assert.deepInclude(argsOf(tags, 'SetValue'), { value: { _tag: 'OptionsValue', optionIds: ['demo-tag-editor'] } })
    })

    it('a locked database takes no drags or new rows', () => {
      const locked = tasks({ layout: 'board', groupBy: 'demo-status' })
      const page = { ...locked, page: locked.page === null ? null : { ...locked.page, isLocked: true } }
      assert.deepStrictEqual(names(send(page, PagePage.Message.StartedCardDrag({ rowId: 'demo-task-1' }), PagePage.Message.DroppedCard({ key: 'demo-done' }))), [])
      assert.deepStrictEqual(names(send(page, PagePage.Message.ClickedNewInGroup({ key: 'demo-done' }))), [])
    })

    it('the calendar adds rows on a day and moves them by drag, keeping a range', () => {
      const calendar = tasks({ layout: 'calendar', dateBy: 'demo-due' }, { 'demo-task-1': { 'demo-due': { _tag: 'DateValue', start: '2026-11-02', end: '2026-11-04' } } })
      assert.deepInclude(argsOf(send(calendar, PagePage.Message.ClickedNewOnDay({ day: '2026-11-12' })), 'AddRow'), { values: { 'demo-due': { _tag: 'DateValue', start: '2026-11-12', end: null } } })
      assert.deepStrictEqual(names(send(calendar, PagePage.Message.ClickedNewOnDay({ day: '2026-02-30' }))), [])
      const moved = send(calendar, PagePage.Message.StartedCardDrag({ rowId: 'demo-task-1' }), PagePage.Message.DroppedCard({ key: '2026-11-30' }))
      assert.deepInclude(argsOf(moved, 'SetValue'), { propertyId: 'demo-due', value: { _tag: 'DateValue', start: '2026-11-30', end: '2026-12-02' } })
    })

    it('the calendar month moves by valid months only', () => {
      const calendar = tasks({ layout: 'calendar', dateBy: 'demo-due' })
      assert.strictEqual(send(calendar, PagePage.Message.ChangedCalendarMonth({ month: '2026-12' })).model.db.month, '2026-12')
      assert.isNull(send(calendar, PagePage.Message.ChangedCalendarMonth({ month: '2026-13' })).model.db.month)
    })

    it('month grids cover whole weeks from Sunday', () => {
      const days = monthDays('2026-11')
      assert.deepStrictEqual([days.length, days[0], days.at(-1)], [35, '2026-11-01', '2026-12-05'])
      assert.deepStrictEqual([monthDays('2027-02')[0], monthDays('2027-02').length], ['2027-01-31', 35])
      assert.deepStrictEqual([shiftMonth('2026-01', -1), shiftMonth('2026-12', 1)], ['2025-12', '2027-01'])
      assert.deepStrictEqual([isDay('2026-02-28'), isDay('2026-02-30'), isMonth('2026-00')], [true, false, false])
    })
  })

  describe('filters and sorts', () => {
    const tasks = (view: Partial<D.DatabaseView>) => {
      const data = demoData(NOW)
      const pages = data.pages.map(page => page.id === 'demo-tasks' && page.database !== null
        ? { ...page, database: { ...page.database, views: page.database.views.map(entry => ({ ...entry, ...view })) } }
        : page)
      const slice = PagePage.sliceOf({ version: 0, members: data.members, pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }, 'demo-tasks', 'avery', NOW)
      return PagePage.init({ ...slice, me: avery, view: 'page', pageId: 'demo-tasks' }).model
    }
    const statusFilter = { id: 'f1', propertyId: 'demo-status', operator: 'is' as const, value: '' }

    it('Filter picks a property, then opens the new filter', () => {
      const picked = send(model('demo-tasks'), PagePage.Message.ClickedAddFilter(), PagePage.Message.ChosePicker({ value: 'demo-status' }))
      assert.deepInclude(argsOf(picked, 'ChangeDatabase'), { change: { _tag: 'AddFilter', viewId: 'demo-tasks-table', propertyId: 'demo-status' } })
      const opened = send(picked.model, PagePage.Message.SucceededDbChange({ addedId: 'f1', change: { _tag: 'AddFilter', viewId: 'demo-tasks-table', propertyId: 'demo-status' } }))
      assert.deepInclude(opened.model.picker, { field: 'filter', pageId: 'f1' })
    })

    it('a filter takes an option and a condition, keeping its menu open', () => {
      const open = send(tasks({ filters: [statusFilter] }), PagePage.Message.ClickedFilter({ filterId: 'f1' }))
      assert.deepInclude(open.model.picker, { field: 'filter', pageId: 'f1' })
      const valued = send(open.model, PagePage.Message.ChosePicker({ value: 'value:demo-done' }))
      assert.deepInclude(argsOf(valued, 'ChangeDatabase'), { change: { _tag: 'SetFilter', viewId: 'demo-tasks-table', filterId: 'f1', operator: 'is', value: 'demo-done' } })
      assert.isNotNull(valued.model.picker)
      assert.deepInclude(argsOf(send(open.model, PagePage.Message.ChosePicker({ value: 'op:isEmpty' })), 'ChangeDatabase'), { change: { _tag: 'SetFilter', viewId: 'demo-tasks-table', filterId: 'f1', operator: 'isEmpty', value: '' } })
      assert.deepStrictEqual(names(send(open.model, PagePage.Message.ChosePicker({ value: 'value:nope' }))), [])
      assert.deepStrictEqual(names(send(open.model, PagePage.Message.ChosePicker({ value: 'op:greaterThan' }))), [], 'not a status condition')
      assert.deepInclude(argsOf(send(open.model, PagePage.Message.ChosePicker({ value: 'remove' })), 'ChangeDatabase'), { change: { _tag: 'RemoveFilter', viewId: 'demo-tasks-table', filterId: 'f1' } })
      assert.deepStrictEqual(names(send(tasks({}), PagePage.Message.ClickedFilter({ filterId: 'f1' }))), [])
    })

    it('a text filter takes what you type; a date filter only a date', () => {
      const name = send(tasks({ filters: [{ id: 'f2', propertyId: 'title', operator: 'contains', value: '' }] }), PagePage.Message.ClickedFilter({ filterId: 'f2' }), PagePage.Message.ChangedPickerQuery({ query: 'slash' }), PagePage.Message.ChosePicker({ value: 'set' }))
      assert.deepInclude(argsOf(name, 'ChangeDatabase'), { change: { _tag: 'SetFilter', viewId: 'demo-tasks-table', filterId: 'f2', operator: 'contains', value: 'slash' } })
      const due = tasks({ filters: [{ id: 'f3', propertyId: 'demo-due', operator: 'before', value: '' }] })
      const bad = send(due, PagePage.Message.ClickedFilter({ filterId: 'f3' }), PagePage.Message.ChangedPickerQuery({ query: 'tomorrow' }), PagePage.Message.ChosePicker({ value: 'set' }))
      assert.deepStrictEqual([names(bad), bad.model.notice], [[], 'Enter a date as YYYY-MM-DD.'])
      const good = send(due, PagePage.Message.ClickedFilter({ filterId: 'f3' }), PagePage.Message.ChangedPickerQuery({ query: '2026-12-01' }), PagePage.Message.ChosePicker({ value: 'set' }))
      assert.deepInclude(argsOf(good, 'ChangeDatabase'), { change: { _tag: 'SetFilter', viewId: 'demo-tasks-table', filterId: 'f3', operator: 'before', value: '2026-12-01' } })
    })

    it('the sort menu adds, flips, reorders and clears sorts', () => {
      const sorted = tasks({ sorts: [{ propertyId: 'demo-due', isDescending: false }, { propertyId: 'title', isDescending: true }] })
      const open = send(sorted, PagePage.Message.ClickedSorts())
      const change = (value: string) => commands(send(open.model, PagePage.Message.ChosePicker({ value }))).map(([, args]) => (args as { change: D.DatabaseChange }).change)
      assert.deepStrictEqual(change('up:title'), [{ _tag: 'MoveSort', viewId: 'demo-tasks-table', propertyId: 'title' }])
      assert.deepStrictEqual(change('flip:demo-due'), [{ _tag: 'SetSort', viewId: 'demo-tasks-table', propertyId: 'demo-due', isDescending: true }])
      assert.deepStrictEqual(change('add:demo-tags'), [{ _tag: 'SetSort', viewId: 'demo-tasks-table', propertyId: 'demo-tags', isDescending: false }])
      assert.deepStrictEqual(change('add:demo-due'), [], 'already sorted')
      assert.deepStrictEqual(change('clear').map(entry => entry._tag), ['SetSort', 'SetSort'])
      assert.deepStrictEqual(change('add:nope'), [])
    })

    it('a header menu adds a filter on its property', () => {
      const header = send(model('demo-tasks'), PagePage.Message.ClickedHeader({ propertyId: 'demo-tags' }), PagePage.Message.ChosePicker({ value: 'filter' }))
      assert.deepInclude(argsOf(header, 'ChangeDatabase'), { change: { _tag: 'AddFilter', viewId: 'demo-tasks-table', propertyId: 'demo-tags' } })
    })

    it('filter chips read like Notion', () => {
      const database = tasks({}).page!.database!
      assert.strictEqual(filterLabel(database, { ...statusFilter, value: 'demo-done' }, []), 'Status: Done')
      assert.strictEqual(filterLabel(database, { id: 'x', propertyId: 'title', operator: 'doesNotContain', value: 'road' }, []), 'Name: does not contain road')
      assert.strictEqual(filterLabel(database, { id: 'x', propertyId: 'demo-due', operator: 'isEmpty', value: '' }, []), 'Due is empty')
    })
  })

  describe('row peeks', () => {
    it('Open peeks the row, focusing its close button; Close ends it', () => {
      const peeked = send(model('demo-tasks'), PagePage.Message.ClickedPeek({ rowId: 'demo-task-1' }))
      assert.strictEqual(peeked.model.db.peek, 'demo-task-1')
      assert.deepInclude(argsOf(peeked, 'FocusElement'), { selector: '#peek-close' })
      assert.isNull(send(peeked.model, PagePage.Message.ClosedPeek()).model.db.peek)
      assert.isNull(send(model('demo-tasks'), PagePage.Message.ClickedPeek({ rowId: 'demo-welcome' })).model.db.peek, 'not a row')
    })

    it('cells of the peeked row open their menus at the peek', () => {
      const peeked = send(model('demo-tasks'), PagePage.Message.ClickedPeek({ rowId: 'demo-task-1' }), PagePage.Message.ClickedCell({ rowId: 'demo-task-1', propertyId: 'demo-status' }))
      assert.deepInclude(peeked.model.picker, { field: 'cell', anchor: '--peek-cell-demo-task-1-demo-status' })
    })

    it('the view menu sets how rows open; full page rows do not peek', () => {
      const chosen = send(model('demo-tasks'), PagePage.Message.ClickedViewMenu({ viewId: 'demo-tasks-table' }), PagePage.Message.ChosePicker({ value: 'open:full' }))
      assert.deepInclude(argsOf(chosen, 'ChangeDatabase'), { change: { _tag: 'SetOpenIn', viewId: 'demo-tasks-table', openIn: 'full' } })
      assert.deepStrictEqual(names(send(model('demo-tasks'), PagePage.Message.ClickedViewMenu({ viewId: 'demo-tasks-table' }), PagePage.Message.ChosePicker({ value: 'open:window' }))), [])
      const data = demoData(NOW)
      const pages = data.pages.map(page => page.id === 'demo-tasks' && page.database !== null ? { ...page, database: { ...page.database, views: page.database.views.map(view => ({ ...view, openIn: 'full' as const })) } } : page)
      const slice = PagePage.sliceOf({ version: 0, members: data.members, pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }, 'demo-tasks', 'avery', NOW)
      const full = PagePage.init({ ...slice, me: avery, view: 'page', pageId: 'demo-tasks' }).model
      assert.isNull(send(full, PagePage.Message.ClickedPeek({ rowId: 'demo-task-1' })).model.db.peek)
    })
  })

  describe('column widths, hidden groups and card sizes', () => {
    const tasks = (view: Partial<D.DatabaseView>) => {
      const data = demoData(NOW)
      const pages = data.pages.map(page => page.id === 'demo-tasks' && page.database !== null
        ? { ...page, database: { ...page.database, views: page.database.views.map(entry => ({ ...entry, ...view })) } }
        : page)
      const slice = PagePage.sliceOf({ version: 0, members: data.members, pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }, 'demo-tasks', 'avery', NOW)
      return PagePage.init({ ...slice, me: avery, view: 'page', pageId: 'demo-tasks' }).model
    }

    it('a dragged column edge saves its width; widths are clamped', () => {
      assert.deepInclude(argsOf(send(model('demo-tasks'), PagePage.Message.ResizedColumn({ propertyId: 'title', width: 340 })), 'ChangeDatabase'), { change: { _tag: 'SetWidth', viewId: 'demo-tasks-table', propertyId: 'title', width: 340 } })
      assert.deepStrictEqual(names(send(model('demo-tasks'), PagePage.Message.ResizedColumn({ propertyId: 'nope', width: 340 }))), [])
      const database = tasks({}).page!.database!
      let serial = 0
      const narrow = D.applyChange(database, { _tag: 'SetWidth', viewId: 'demo-tasks-table', propertyId: 'title', width: 5 }, prefix => `${prefix}-${++serial}`)
      assert.deepStrictEqual(typeof narrow === 'string' ? narrow : narrow.database.views[0]?.widths, { title: D.MIN_WIDTH })
      assert.isString(D.applyChange(database, { _tag: 'SetWidth', viewId: 'demo-tasks-table', propertyId: 'title', width: Number.NaN }, prefix => prefix))
    })

    it('a board group hides and shows; unknown groups are refused', () => {
      const board = tasks({ layout: 'board', groupBy: 'demo-status' })
      assert.deepInclude(argsOf(send(board, PagePage.Message.ToggledGroup({ key: 'demo-done', isHidden: true })), 'ChangeDatabase'), { change: { _tag: 'SetGroupHidden', viewId: 'demo-tasks-table', key: 'demo-done', isHidden: true } })
      assert.deepStrictEqual(names(send(board, PagePage.Message.ToggledGroup({ key: 'nope', isHidden: true }))), [])
      assert.deepStrictEqual(names(send(tasks({}), PagePage.Message.ToggledGroup({ key: 'demo-done', isHidden: true }))), [], 'not grouped')
    })

    it('a gallery view menu sets the card size', () => {
      const gallery = send(tasks({ layout: 'gallery' }), PagePage.Message.ClickedViewMenu({ viewId: 'demo-tasks-table' }))
      assert.isTrue(PagePage.pickerItems(gallery.model).some(item => item.value === 'size:medium' && item.isChecked === true))
      assert.deepInclude(argsOf(send(gallery.model, PagePage.Message.ChosePicker({ value: 'size:large' })), 'ChangeDatabase'), { change: { _tag: 'SetCardSize', viewId: 'demo-tasks-table', size: 'large' } })
    })
  })

  describe('relations', () => {
    const related = () => {
      const data = demoData(NOW)
      const pages = data.pages.map(page => page.id === 'demo-tasks' && page.database !== null
        ? { ...page, database: { ...page.database, properties: [...page.database.properties, { id: 'rel', name: 'Blocked by', type: { _tag: 'Relation' as const, databaseId: '' } }] } }
        : page.id === 'demo-task-1' ? { ...page, values: { ...page.values, rel: { _tag: 'RelationValue' as const, pageIds: ['demo-task-2'] } } } : page)
      const slice = PagePage.sliceOf({ version: 0, members: data.members, pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }, 'demo-tasks', 'avery', NOW)
      return PagePage.init({ ...slice, me: avery, view: 'page', pageId: 'demo-tasks' }).model
    }

    it('a relation cell picks rows of the related database and names them', () => {
      const model = related()
      assert.deepStrictEqual(model.related.map(entry => entry.id), ['demo-tasks'])
      assert.isString(model.rows.find(entry => entry.id === 'demo-task-1')?.links['demo-task-2'])
      const opened = send(model, PagePage.Message.ClickedCell({ rowId: 'demo-task-1', propertyId: 'rel' }))
      assert.strictEqual(opened.model.picker?.field, 'cells')
      assert.isTrue(PagePage.pickerItems(opened.model).some(item => item.value === 'option:demo-task-2' && item.isChecked === true))
      assert.deepInclude(argsOf(send(opened.model, PagePage.Message.ChosePicker({ value: 'option:demo-task-2' })), 'SetValue'), { propertyId: 'rel', value: null })
    })

    it('the header menu points a relation at another database', () => {
      const header = send(related(), PagePage.Message.ClickedHeader({ propertyId: 'rel' }))
      const relate = send(header.model, PagePage.Message.ChosePicker({ value: 'relate' }))
      assert.strictEqual(relate.model.picker?.field, 'relation')
      assert.deepStrictEqual(names(send(relate.model, PagePage.Message.ChosePicker({ value: 'db:nope' }))), [])
      assert.deepInclude(argsOf(send(relate.model, PagePage.Message.ChosePicker({ value: 'self' })), 'ChangeDatabase'), { change: { _tag: 'SetRelation', propertyId: 'rel', databaseId: '' } })
    })
  })
})
