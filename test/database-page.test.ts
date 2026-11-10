import { assert, describe, it } from '@effect/vitest'

import type { Page } from '@/app/domain'
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
})
