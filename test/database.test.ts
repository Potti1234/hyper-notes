import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import * as D from '@/app/database'
import { DEMO_HOME } from '@/app/seed'
import { Workspace } from '@/app/store'
import { workspaceLayer } from './support'

/* Databases: properties and views change through `applyChange`; views
   filter, sort and group rows; rows keep values checked against their
   database's properties. */

let serial = 0
const id = (prefix: string) => `${prefix}-${++serial}`
const people = [{ id: 'avery', name: 'Avery Finch' }, { id: 'morgan', name: 'Morgan Vale' }]
const change = (database: D.Database, next: D.DatabaseChange): D.Changed => {
  const changed = D.applyChange(database, next, id)
  if (typeof changed === 'string') throw new Error(changed)
  return changed
}
const row = (rowId: string, title: string, values: D.Values = {}, at = 0): D.Row => ({ id: rowId, title, values, createdAt: at, createdBy: 'avery', updatedAt: at, updatedBy: 'avery' })

describe('databases: properties and views', () => {
  it('a new database has Tags and one view of its layout; boards get a Status to group by', () => {
    const table = D.newDatabase('table', id)
    assert.deepStrictEqual(table.properties.map(property => property.name), ['Tags'])
    assert.deepStrictEqual(table.views.map(view => [view.name, view.layout]), [['Table', 'table']])
    const board = D.newDatabase('board', id)
    const status = board.properties.find(property => property.type._tag === 'Status')!
    assert.strictEqual(board.views[0]!.groupBy, status.id)
    assert.deepStrictEqual(D.optionsOf(status).map(option => option.name), ['Not started', 'In progress', 'Done'])
    const calendar = D.newDatabase('calendar', id)
    assert.strictEqual(calendar.views[0]!.dateBy, calendar.properties.find(property => property.type._tag === 'Date')!.id)
  })

  it('adds, renames, retypes, duplicates and deletes properties; names stay unique', () => {
    let db = D.newDatabase('table', id)
    const added = change(db, { _tag: 'AddProperty', tag: 'Number', name: '' })
    db = added.database
    const number = D.propertyOf(db, added.addedId!)!
    assert.strictEqual(number.name, 'Number')
    db = change(db, { _tag: 'AddProperty', tag: 'Number', name: '' }).database
    assert.deepStrictEqual(db.properties.map(property => property.name), ['Tags', 'Number', 'Number 1'])
    db = change(db, { _tag: 'RenameProperty', propertyId: number.id, name: '  Estimate  ' }).database
    assert.strictEqual(D.propertyOf(db, number.id)!.name, 'Estimate')
    db = change(db, { _tag: 'SetPropertyType', propertyId: number.id, tag: 'Select' }).database
    assert.strictEqual(D.propertyOf(db, number.id)!.type._tag, 'Select')
    const copy = change(db, { _tag: 'DuplicateProperty', propertyId: number.id })
    assert.strictEqual(D.propertyOf(copy.database, copy.addedId!)!.name, 'Estimate 1')
    const left = change(db, { _tag: 'AddProperty', tag: 'Text', name: '', beside: { propertyId: number.id, isBefore: true } })
    assert.strictEqual(left.database.properties.findIndex(property => property.id === left.addedId), db.properties.indexOf(D.propertyOf(db, number.id)!))
    const first = change(db, { _tag: 'AddProperty', tag: 'Text', name: '', beside: { propertyId: D.TITLE, isBefore: false } })
    assert.strictEqual(first.database.properties[0]!.id, first.addedId)
    assert.strictEqual(D.applyChange(db, { _tag: 'AddProperty', tag: 'Text', name: '', beside: { propertyId: 'gone', isBefore: false } }, id), 'That property is gone.')
    assert.strictEqual(D.applyChange(db, { _tag: 'AddProperty', tag: 'Spreadsheet', name: '' }, id), 'That property type does not exist.')
    db = change(db, { _tag: 'AddFilter', viewId: db.views[0]!.id, propertyId: number.id }).database
    db = change(db, { _tag: 'DeleteProperty', propertyId: number.id }).database
    assert.isNull(D.propertyOf(db, number.id))
    assert.deepStrictEqual(db.views[0]!.filters, [])
  })

  it('options are created once per name (any case), with the next color', () => {
    const db = D.newDatabase('table', id)
    const tags = db.properties[0]!
    const one = change(db, { _tag: 'AddOption', propertyId: tags.id, name: 'Bug' })
    const again = change(one.database, { _tag: 'AddOption', propertyId: tags.id, name: 'bug' })
    assert.strictEqual(again.addedId, one.addedId)
    assert.strictEqual(again.database, one.database)
    assert.strictEqual(D.applyChange(db, { _tag: 'AddOption', propertyId: tags.id, name: '  ' }, id), 'Name the option.')
  })

  it('views: add, rename, duplicate, delete (keeping one), change layout', () => {
    let db = D.newDatabase('table', id)
    const first = db.views[0]!.id
    const board = change(db, { _tag: 'AddView', layout: 'board' })
    db = board.database
    assert.deepStrictEqual(db.views.map(view => view.name), ['Table', 'Board'])
    db = change(db, { _tag: 'RenameView', viewId: board.addedId!, name: 'By tag' }).database
    db = change(db, { _tag: 'DuplicateView', viewId: first }).database
    assert.deepStrictEqual(db.views.map(view => view.name), ['Table', 'Table 1', 'By tag'])
    db = change(db, { _tag: 'DeleteView', viewId: first }).database
    db = change(db, { _tag: 'DeleteView', viewId: board.addedId! }).database
    assert.strictEqual(D.applyChange(db, { _tag: 'DeleteView', viewId: db.views[0]!.id }, id), 'A database keeps at least one view.')
    db = change(db, { _tag: 'SetLayout', viewId: db.views[0]!.id, layout: 'list' }).database
    assert.strictEqual(db.views[0]!.layout, 'list')
  })
})

describe('databases: values, filters, sorts, groups', () => {
  const base = D.newDatabase('board', id)
  const status = base.properties[0]!
  const tags = base.properties[1]!
  const withBug = change(base, { _tag: 'AddOption', propertyId: tags.id, name: 'Bug' })
  const withNumber = change(withBug.database, { _tag: 'AddProperty', tag: 'Number', name: 'Points' })
  const db = withNumber.database
  const points = withNumber.addedId!
  const bug = withBug.addedId!
  const [todo, doing, done] = D.optionsOf(status).map(option => option.id)
  const rows = [
    row('a', 'Alpha', { [status.id]: { _tag: 'OptionValue', optionId: done! }, [points]: { _tag: 'NumberValue', value: 3 } }),
    row('b', 'beta', { [status.id]: { _tag: 'OptionValue', optionId: todo! }, [tags.id]: { _tag: 'OptionsValue', optionIds: [bug] }, [points]: { _tag: 'NumberValue', value: 1 } }),
    row('c', 'Gamma', {}),
  ]

  it('checks values against the property and cleans them', () => {
    const url = { id: 'u', name: 'Link', type: { _tag: 'Url' as const } }
    assert.strictEqual(D.checkValue(url, { _tag: 'TextValue', text: 'javascript:alert(1)' }, people), 'Enter an http(s):// address.')
    assert.deepStrictEqual(D.checkValue(url, { _tag: 'TextValue', text: ' https://a.example ' }, people), { _tag: 'TextValue', text: 'https://a.example' })
    assert.strictEqual(D.checkValue(status, { _tag: 'OptionValue', optionId: 'nope' }, people), 'Pick one of the options.')
    assert.strictEqual(D.checkValue(D.propertyOf(db, points)!, { _tag: 'NumberValue', value: Number.NaN }, people), 'Enter a number.')
    const person = { id: 'p', name: 'Owner', type: { _tag: 'Person' as const } }
    assert.strictEqual(D.checkValue(person, { _tag: 'PeopleValue', memberIds: ['stranger'] }, people), 'Pick people from the workspace.')
    const date = { id: 'd', name: 'Due', type: { _tag: 'Date' as const } }
    assert.strictEqual(D.checkValue(date, { _tag: 'DateValue', start: '2026-11-10', end: '2026-11-01' }, people), 'Pick a date.')
    assert.strictEqual(D.checkValue({ id: 'c', name: 'Created', type: { _tag: 'CreatedTime' } }, { _tag: 'TextValue', text: 'x' }, people), 'This property fills itself in.')
    assert.deepStrictEqual([D.parseNumber('1,5', 'number'), D.parseNumber('12%', 'number'), D.parseNumber('$1,200', 'dollar'), D.parseNumber('', 'number'), D.parseNumber('abc', 'number')], [1.5, 0.12, 1200, null, 'invalid'])
    assert.deepStrictEqual([D.formatNumber(0.25, 'percent'), D.formatNumber(1200, 'dollar')], ['25%', '$1,200.00'])
  })

  it('filters by every rule; a filter without a value keeps every row', () => {
    const view = (filters: ReadonlyArray<D.Filter>): D.DatabaseView => ({ ...db.views[0]!, filters })
    const f = (propertyId: string, operator: D.Operator, value = ''): D.Filter => ({ id: 'f', propertyId, operator, value })
    const ids = (filters: ReadonlyArray<D.Filter>) => D.rowsOf(db, view(filters), rows, people).map(entry => entry.id)
    assert.deepStrictEqual(ids([f(D.TITLE, 'contains', 'ALP')]), ['a'])
    assert.deepStrictEqual(ids([f(status.id, 'is', done!)]), ['a'])
    assert.deepStrictEqual(ids([f(status.id, 'isEmpty')]), ['c'])
    assert.deepStrictEqual(ids([f(tags.id, 'contains', bug)]), ['b'])
    assert.deepStrictEqual(ids([f(points, 'greaterThan', '2')]), ['a'])
    assert.deepStrictEqual(ids([f(points, 'lessThan', '5'), f(status.id, 'isNot', done!)]), ['b'])
    assert.deepStrictEqual(ids([f(status.id, 'is')]), ['a', 'b', 'c'])
    assert.deepStrictEqual(D.rowsOf(db, view([]), rows, people, 'bug').map(entry => entry.id), ['b'])
  })

  it('sorts by several properties, options in their order, empty values last', () => {
    const sorted = (sorts: ReadonlyArray<D.Sort>) => D.sortRows(db, sorts, rows, people).map(entry => entry.id)
    assert.deepStrictEqual(sorted([{ propertyId: D.TITLE, isDescending: false }]), ['a', 'b', 'c'])
    assert.deepStrictEqual(sorted([{ propertyId: points, isDescending: true }]), ['a', 'b', 'c'])
    assert.deepStrictEqual(sorted([{ propertyId: points, isDescending: false }]), ['b', 'a', 'c'])
    assert.deepStrictEqual(sorted([{ propertyId: status.id, isDescending: false }]), ['b', 'a', 'c'])
  })

  it('groups by option in option order, then "No <name>"; moving into a group sets the value', () => {
    const groups = D.groupRows(status, rows, people)
    assert.deepStrictEqual(groups.map(group => [group.label, group.rows.map(entry => entry.id)]), [['Not started', ['b']], ['In progress', []], ['Done', ['a']], ['No Status', ['c']]])
    assert.deepStrictEqual(D.valueForGroup(status, doing!, null), { _tag: 'OptionValue', optionId: doing! })
    assert.isNull(D.valueForGroup(status, D.NO_GROUP, null))
    const filtered = { ...db.views[0]!, filters: [{ id: 'f', propertyId: status.id, operator: 'is' as const, value: doing! }] }
    assert.deepStrictEqual(D.valuesForNew(db, filtered), { [status.id]: { _tag: 'OptionValue', optionId: doing! } })
  })

  it('footer calculations fit the column and work out over the rows shown', () => {
    const pointsProperty = D.propertyOf(db, points)
    const calc = (property: D.Property | null, fn: D.CalcFn) => D.calculate(db, property, rows, people, fn)
    assert.strictEqual(calc(null, 'countAll'), '3')
    assert.strictEqual(calc(pointsProperty, 'sum'), '4')
    assert.strictEqual(calc(pointsProperty, 'average'), '2')
    assert.strictEqual(calc(pointsProperty, 'median'), '2')
    assert.strictEqual(calc(pointsProperty, 'range'), '2')
    assert.strictEqual(calc(pointsProperty, 'percentEmpty'), '33.33%')
    assert.strictEqual(calc(D.propertyOf(db, tags.id), 'countNotEmpty'), '1')
    assert.strictEqual(calc(tags, 'sum'), '', 'sum does not fit a multi-select')
    assert.include(D.calcFnsFor(pointsProperty), 'median')
    assert.notInclude(D.calcFnsFor(tags), 'sum')
    const view = db.views[0]!
    assert.strictEqual(D.calcOf(view, D.TITLE), 'countAll')
    assert.strictEqual(D.calcOf(view, points), 'none')
    const set = change(db, { _tag: 'SetCalculation', viewId: view.id, propertyId: points, fn: 'max' })
    assert.strictEqual(D.calcOf(set.database.views[0]!, points), 'max')
    assert.strictEqual(D.applyChange(db, { _tag: 'SetCalculation', viewId: view.id, propertyId: tags.id, fn: 'sum' }, id), 'That calculation does not fit this property.')
  })
})

describe('databases: workspace operations', () => {
  const run = <A, E>(effect: Effect.Effect<A, E, Workspace>) => Effect.provide(effect, workspaceLayer())

  it.effect('an empty page becomes a database; rows get checked values; values can be cleared', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const page = yield* workspace.createPage({ parentId: null, section: 'workspace', title: 'Tasks' }, 'avery')
      const database = yield* workspace.makeDatabase(page.id, 'board', 'avery')
      const status = database.database!.properties[0]!
      const [todo] = D.optionsOf(status)
      const added = yield* workspace.addRow(page.id, { title: 'First', values: { [status.id]: { _tag: 'OptionValue', optionId: todo!.id }, nope: { _tag: 'TextValue', text: 'x' } }, beforeId: null }, 'avery')
      assert.deepStrictEqual(Object.keys(added.values), [status.id])
      assert.strictEqual(added.parentId, page.id)
      const cleared = yield* workspace.setValue(added.id, status.id, null, 'avery')
      assert.deepStrictEqual(cleared.values, {})
      const bad = yield* Effect.flip(workspace.setValue(added.id, status.id, { _tag: 'OptionValue', optionId: 'nope' }, 'avery'))
      assert.strictEqual(bad.reason, 'Pick one of the options.')
      const option = yield* workspace.changeDatabase(page.id, { _tag: 'AddOption', propertyId: database.database!.properties[1]!.id, name: 'Bug' }, 'avery')
      assert.isString(option)
      const state = yield* workspace.current
      assert.isFalse(state.pages.some(entry => entry.id === DEMO_HOME && entry.database !== null))
    })))

  it.effect('ID properties number rows oldest first and keep counting', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const page = yield* workspace.createPage({ parentId: null, section: 'workspace', title: 'Bugs' }, 'avery')
      yield* workspace.makeDatabase(page.id, 'table', 'avery')
      const first = yield* workspace.addRow(page.id, { title: 'One', values: {}, beforeId: null }, 'avery')
      const second = yield* workspace.addRow(page.id, { title: 'Two', values: {}, beforeId: null }, 'avery')
      const propertyId = (yield* workspace.changeDatabase(page.id, { _tag: 'AddProperty', tag: 'Id', name: '' }, 'avery'))!
      const state = yield* workspace.current
      const idOf = (rowId: string) => state.pages.find(entry => entry.id === rowId)?.values[propertyId]
      assert.deepStrictEqual([idOf(first.id), idOf(second.id)], [{ _tag: 'NumberValue', value: 1 }, { _tag: 'NumberValue', value: 2 }])
      const third = yield* workspace.addRow(page.id, { title: 'Three', values: { [propertyId]: { _tag: 'NumberValue', value: 99 } }, beforeId: null }, 'avery')
      assert.deepStrictEqual(third.values[propertyId], { _tag: 'NumberValue', value: 3 })
      const refused = yield* Effect.flip(workspace.setValue(third.id, propertyId, { _tag: 'NumberValue', value: 7 }, 'avery'))
      assert.strictEqual(refused.reason, 'IDs are numbered by themselves.')
      assert.strictEqual(D.idText('BUG', 3), 'BUG-3')
      yield* workspace.changeDatabase(page.id, { _tag: 'SetIdPrefix', propertyId, prefix: ' BUG ' }, 'avery')
      const prefixed = (yield* workspace.current).pages.find(entry => entry.id === page.id)?.database?.properties.find(entry => entry.id === propertyId)
      assert.deepStrictEqual(prefixed?.type, { _tag: 'Id', prefix: 'BUG' })
      const bad = yield* Effect.flip(workspace.changeDatabase(page.id, { _tag: 'SetIdPrefix', propertyId, prefix: 'NO SPACES' }, 'avery'))
      assert.strictEqual(bad.reason, 'A prefix has up to 10 letters or digits.')
      assert.strictEqual(D.idText('', 3), '3')
    })))

  it.effect('relations link rows of their database only', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const page = yield* workspace.createPage({ parentId: null, section: 'workspace', title: 'Links' }, 'avery')
      yield* workspace.makeDatabase(page.id, 'table', 'avery')
      const first = yield* workspace.addRow(page.id, { title: 'One', values: {}, beforeId: null }, 'avery')
      const second = yield* workspace.addRow(page.id, { title: 'Two', values: {}, beforeId: null }, 'avery')
      const propertyId = (yield* workspace.changeDatabase(page.id, { _tag: 'AddProperty', tag: 'Relation', name: '' }, 'avery'))!
      const linked = yield* workspace.setValue(first.id, propertyId, { _tag: 'RelationValue', pageIds: [second.id, second.id] }, 'avery')
      assert.deepStrictEqual(linked.values[propertyId], { _tag: 'RelationValue', pageIds: [second.id] })
      const outside = yield* Effect.flip(workspace.setValue(first.id, propertyId, { _tag: 'RelationValue', pageIds: [DEMO_HOME] }, 'avery'))
      assert.strictEqual(outside.reason, 'Pick pages from the related database.')
      const notDb = yield* Effect.flip(workspace.changeDatabase(page.id, { _tag: 'SetRelation', propertyId, databaseId: DEMO_HOME }, 'avery'))
      assert.strictEqual(notDb.reason, 'Pick a database to relate to.')
      const rollupId = (yield* workspace.changeDatabase(page.id, { _tag: 'AddProperty', tag: 'Rollup', name: '' }, 'avery'))!
      const unknown = yield* Effect.flip(workspace.changeDatabase(page.id, { _tag: 'SetRollup', propertyId: rollupId, relationId: propertyId, targetId: 'nope', fn: 'sum' }, 'avery'))
      assert.strictEqual(unknown.reason, 'Pick a property of the related database.')
      const notRelation = yield* Effect.flip(workspace.changeDatabase(page.id, { _tag: 'SetRollup', propertyId: rollupId, relationId: rollupId, targetId: D.TITLE, fn: 'sum' }, 'avery'))
      assert.strictEqual(notRelation.reason, 'Pick a relation of this database.')
      const rolled = yield* workspace.changeDatabase(page.id, { _tag: 'SetRollup', propertyId: rollupId, relationId: propertyId, targetId: D.TITLE, fn: 'countAll' }, 'avery')
      assert.isNull(rolled)
      const formulaId = (yield* workspace.changeDatabase(page.id, { _tag: 'AddProperty', tag: 'Formula', name: '' }, 'avery'))!
      const broken = yield* Effect.flip(workspace.changeDatabase(page.id, { _tag: 'SetFormula', propertyId: formulaId, expression: 'if(' }, 'avery'))
      assert.strictEqual(broken.reason, 'The formula ends too early')
      const notFormula = yield* Effect.flip(workspace.changeDatabase(page.id, { _tag: 'SetFormula', propertyId: rollupId, expression: '1' }, 'avery'))
      assert.strictEqual(notFormula.reason, 'That property is not a formula.')
      yield* workspace.changeDatabase(page.id, { _tag: 'SetFormula', propertyId: formulaId, expression: 'prop("Name") + "!"' }, 'avery')
    })))

  it.effect('pages with content, locked or private pages of others cannot change', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const full = yield* Effect.flip(workspace.makeDatabase(DEMO_HOME, 'table', 'avery'))
      assert.strictEqual(full.reason, 'Only an empty page can become a database.')
      const page = yield* workspace.createPage({ parentId: null, section: 'private', title: 'Mine' }, 'avery')
      const hidden = yield* Effect.flip(workspace.makeDatabase(page.id, 'table', 'morgan'))
      assert.strictEqual(hidden.reason, 'That page does not exist.')
      yield* workspace.updatePage(page.id, { isLocked: true }, 'avery')
      const locked = yield* Effect.flip(workspace.makeDatabase(page.id, 'table', 'avery'))
      assert.strictEqual(locked.reason, 'This page is locked.')
      const notDb = yield* Effect.flip(workspace.addRow(DEMO_HOME, { title: 'x', values: {}, beforeId: null }, 'avery'))
      assert.strictEqual(notDb.reason, 'This page is not a database.')
    })))
})
