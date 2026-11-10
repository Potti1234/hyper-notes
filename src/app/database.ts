import { Schema as S } from 'effect'

/* Databases: a page whose children are its rows. The page keeps the
   properties (columns) and views; each row page keeps its values by
   property id. Everything here is pure: checking values, filtering,
   sorting and grouping rows. */

export const OptionColor = S.Literals(['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'])
export type OptionColor = typeof OptionColor.Type
export const OPTION_COLORS: ReadonlyArray<OptionColor> = OptionColor.literals

export const SelectOption = S.Struct({ id: S.String, name: S.String, color: OptionColor })
export type SelectOption = typeof SelectOption.Type

export const StatusGroup = S.Literals(['todo', 'inProgress', 'done'])
export type StatusGroup = typeof StatusGroup.Type
export const StatusOption = S.Struct({ ...SelectOption.fields, group: StatusGroup })
export type StatusOption = typeof StatusOption.Type

export const NumberFormat = S.Literals(['number', 'percent', 'dollar', 'euro'])
export type NumberFormat = typeof NumberFormat.Type

export const PropertyType = S.Union([
  S.TaggedStruct('Text', {}),
  S.TaggedStruct('Number', { format: NumberFormat }),
  S.TaggedStruct('Select', { options: S.Array(SelectOption) }),
  S.TaggedStruct('MultiSelect', { options: S.Array(SelectOption) }),
  S.TaggedStruct('Status', { options: S.Array(StatusOption) }),
  S.TaggedStruct('Date', {}),
  S.TaggedStruct('Person', {}),
  S.TaggedStruct('Checkbox', {}),
  S.TaggedStruct('Url', {}),
  S.TaggedStruct('Email', {}),
  S.TaggedStruct('Phone', {}),
  S.TaggedStruct('CreatedTime', {}),
  S.TaggedStruct('CreatedBy', {}),
  S.TaggedStruct('LastEditedTime', {}),
  S.TaggedStruct('LastEditedBy', {}),
])
export type PropertyType = typeof PropertyType.Type
export type PropertyTag = PropertyType['_tag']

export const PROPERTY_TAGS: ReadonlyArray<PropertyTag> = ['Text', 'Number', 'Select', 'MultiSelect', 'Status', 'Date', 'Person', 'Checkbox', 'Url', 'Email', 'Phone', 'CreatedTime', 'CreatedBy', 'LastEditedTime', 'LastEditedBy']
export const isPropertyTag = (tag: string): tag is PropertyTag => (PROPERTY_TAGS as ReadonlyArray<string>).includes(tag)

export const TYPE_LABEL: Readonly<Record<PropertyTag, string>> = {
  Text: 'Text', Number: 'Number', Select: 'Select', MultiSelect: 'Multi-select', Status: 'Status', Date: 'Date', Person: 'Person', Checkbox: 'Checkbox',
  Url: 'URL', Email: 'Email', Phone: 'Phone', CreatedTime: 'Created time', CreatedBy: 'Created by', LastEditedTime: 'Last edited time', LastEditedBy: 'Last edited by',
}

export const Property = S.Struct({ id: S.String, name: S.String, type: PropertyType })
export type Property = typeof Property.Type

/** The row's own title is a property too, under this id. */
export const TITLE = 'title'

export const Value = S.Union([
  S.TaggedStruct('TextValue', { text: S.String }),
  S.TaggedStruct('NumberValue', { value: S.Number }),
  S.TaggedStruct('OptionValue', { optionId: S.String }),
  S.TaggedStruct('OptionsValue', { optionIds: S.Array(S.String) }),
  S.TaggedStruct('DateValue', { start: S.String, end: S.NullOr(S.String) }),
  S.TaggedStruct('PeopleValue', { memberIds: S.Array(S.String) }),
  S.TaggedStruct('CheckboxValue', { isChecked: S.Boolean }),
])
export type Value = typeof Value.Type
export const Values = S.Record(S.String, Value)
export type Values = typeof Values.Type

export const Layout = S.Literals(['table', 'board', 'list', 'gallery', 'calendar'])
export type Layout = typeof Layout.Type
export const LAYOUT_LABEL: Readonly<Record<Layout, string>> = { table: 'Table', board: 'Board', list: 'List', gallery: 'Gallery', calendar: 'Calendar' }

export const Operator = S.Literals(['contains', 'doesNotContain', 'is', 'isNot', 'isEmpty', 'isNotEmpty', 'greaterThan', 'lessThan', 'before', 'after', 'isChecked', 'isNotChecked'])
export type Operator = typeof Operator.Type
export const OPERATOR_LABEL: Readonly<Record<Operator, string>> = {
  contains: 'contains', doesNotContain: 'does not contain', is: 'is', isNot: 'is not', isEmpty: 'is empty', isNotEmpty: 'is not empty',
  greaterThan: '>', lessThan: '<', before: 'is before', after: 'is after', isChecked: 'is checked', isNotChecked: 'is not checked',
}

export const Filter = S.Struct({ id: S.String, propertyId: S.String, operator: Operator, value: S.String })
export type Filter = typeof Filter.Type
export const Sort = S.Struct({ propertyId: S.String, isDescending: S.Boolean })
export type Sort = typeof Sort.Type

export const DatabaseView = S.Struct({
  id: S.String,
  name: S.String,
  layout: Layout,
  filters: S.Array(Filter),
  sorts: S.Array(Sort),
  /** Board columns, or table/list groups; null for none. */
  groupBy: S.NullOr(S.String),
  /** Properties this view leaves out. */
  hidden: S.Array(S.String),
  /** The date property a calendar places rows by. */
  dateBy: S.NullOr(S.String),
})
export type DatabaseView = typeof DatabaseView.Type

export const Database = S.Struct({ properties: S.Array(Property), views: S.Array(DatabaseView) })
export type Database = typeof Database.Type

/** What a view needs to know about a row. */
export type Row = Readonly<{ id: string; title: string; values: Values; createdAt: number; createdBy: string; updatedAt: number; updatedBy: string }>
export type Person = Readonly<{ id: string; name: string }>

export const MAX_PROPERTIES = 50
export const MAX_OPTIONS = 100
export const MAX_VIEWS = 20
export const MAX_FILTERS = 10
export const MAX_NAME = 100
export const MAX_TEXT = 2000

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// CREATING

const STATUS_OPTIONS = (id: (prefix: string) => string): ReadonlyArray<StatusOption> => [
  { id: id('opt'), name: 'Not started', color: 'default', group: 'todo' },
  { id: id('opt'), name: 'In progress', color: 'blue', group: 'inProgress' },
  { id: id('opt'), name: 'Done', color: 'green', group: 'done' },
]

export const typeOf = (tag: PropertyTag, id: (prefix: string) => string, keep?: PropertyType): PropertyType => {
  const options = keep !== undefined && 'options' in keep ? keep.options.map(({ id: optionId, name, color }) => ({ id: optionId, name, color })) : []
  switch (tag) {
    case 'Number': return { _tag: 'Number', format: 'number' }
    case 'Select': return { _tag: 'Select', options }
    case 'MultiSelect': return { _tag: 'MultiSelect', options }
    case 'Status': return { _tag: 'Status', options: options.length === 0 ? STATUS_OPTIONS(id) : options.map(option => ({ ...option, group: 'todo' as const })) }
    default: return { _tag: tag }
  }
}

export const viewOf = (layout: Layout, id: string, database?: Database): DatabaseView => {
  const groupable = database?.properties.find(property => property.type._tag === 'Status' || property.type._tag === 'Select')
  const date = database?.properties.find(property => property.type._tag === 'Date')
  return {
    id,
    name: LAYOUT_LABEL[layout],
    layout,
    filters: [],
    sorts: [],
    groupBy: layout === 'board' ? (groupable?.id ?? null) : null,
    hidden: [],
    dateBy: layout === 'calendar' ? (date?.id ?? null) : null,
  }
}

/** A new database like Notion's: a title, Tags, and one view. */
export const newDatabase = (layout: Layout, id: (prefix: string) => string): Database => {
  const tags: Property = { id: id('prop'), name: 'Tags', type: { _tag: 'MultiSelect', options: [] } }
  const status: Property = { id: id('prop'), name: 'Status', type: { _tag: 'Status', options: STATUS_OPTIONS(id) } }
  const date: Property = { id: id('prop'), name: 'Date', type: { _tag: 'Date' } }
  const properties = layout === 'board' ? [status, tags] : layout === 'calendar' ? [date, tags] : [tags]
  const database = { properties, views: [] }
  return { properties, views: [viewOf(layout, id('view'), database)] }
}

// READING VALUES

export const optionsOf = (property: Property): ReadonlyArray<SelectOption | StatusOption> => ('options' in property.type ? property.type.options : [])

/** The row's value for the property, when it has one of the right kind. */
export const valueOf = (property: Property, row: Row): Value | null => {
  const value = row.values[property.id]
  if (value === undefined) return null
  switch (property.type._tag) {
    case 'Text': case 'Url': case 'Email': case 'Phone': return value._tag === 'TextValue' && value.text !== '' ? value : null
    case 'Number': return value._tag === 'NumberValue' ? value : null
    case 'Select': case 'Status': return value._tag === 'OptionValue' && optionsOf(property).some(option => option.id === value.optionId) ? value : null
    case 'MultiSelect': {
      if (value._tag !== 'OptionsValue') return null
      const known = value.optionIds.filter(optionId => optionsOf(property).some(option => option.id === optionId))
      return known.length === 0 ? null : { _tag: 'OptionsValue', optionIds: known }
    }
    case 'Date': return value._tag === 'DateValue' ? value : null
    case 'Person': return value._tag === 'PeopleValue' && value.memberIds.length > 0 ? value : null
    case 'Checkbox': return value._tag === 'CheckboxValue' ? value : null
    default: return null
  }
}

const isoDay = (at: number): string => new Date(at).toISOString().slice(0, 10)

/** Values as plain words, for filters, sorting and search. */
export const textOf = (property: Property | null, row: Row, people: ReadonlyArray<Person>): string => {
  if (property === null) return row.title
  const name = (memberId: string) => people.find(member => member.id === memberId)?.name ?? ''
  switch (property.type._tag) {
    case 'CreatedTime': return isoDay(row.createdAt)
    case 'LastEditedTime': return isoDay(row.updatedAt)
    case 'CreatedBy': return name(row.createdBy)
    case 'LastEditedBy': return name(row.updatedBy)
    default: break
  }
  const value = valueOf(property, row)
  if (value === null) return ''
  switch (value._tag) {
    case 'TextValue': return value.text
    case 'NumberValue': return String(value.value)
    case 'OptionValue': return optionsOf(property).find(option => option.id === value.optionId)?.name ?? ''
    case 'OptionsValue': return value.optionIds.map(optionId => optionsOf(property).find(option => option.id === optionId)?.name ?? '').join(', ')
    case 'DateValue': return value.end === null ? value.start : `${value.start} to ${value.end}`
    case 'PeopleValue': return value.memberIds.map(name).join(', ')
    case 'CheckboxValue': return value.isChecked ? 'Yes' : ''
  }
}

export const formatNumber = (value: number, format: NumberFormat): string => {
  switch (format) {
    case 'number': return value.toLocaleString('en-US', { maximumFractionDigits: 8 })
    case 'percent': return `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 6 })}%`
    case 'dollar': return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    case 'euro': return value.toLocaleString('en-US', { style: 'currency', currency: 'EUR' })
  }
}

export const propertyOf = (database: Database, propertyId: string): Property | null =>
  database.properties.find(property => property.id === propertyId) ?? null

// CHECKING VALUES

const isUrl = (text: string) => /^https?:\/\/\S+$/i.test(text)
const isEmail = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
const isPhone = (text: string) => /^[+()\d\s.-]{3,32}$/.test(text)

/** The value as it may be stored for the property, or why it cannot. */
export const checkValue = (property: Property, value: Value, people: ReadonlyArray<Person>): Value | string => {
  const options = optionsOf(property)
  switch (property.type._tag) {
    case 'Text': case 'Url': case 'Email': case 'Phone': {
      if (value._tag !== 'TextValue') return 'That value does not fit this property.'
      const text = value.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
      if (text === '') return { _tag: 'TextValue', text }
      if (property.type._tag === 'Url' && !isUrl(text)) return 'Enter an http(s):// address.'
      if (property.type._tag === 'Email' && !isEmail(text)) return 'Enter an email address.'
      if (property.type._tag === 'Phone' && !isPhone(text)) return 'Enter a phone number.'
      return { _tag: 'TextValue', text }
    }
    case 'Number':
      return value._tag === 'NumberValue' && Number.isFinite(value.value) ? value : 'Enter a number.'
    case 'Select': case 'Status':
      return value._tag === 'OptionValue' && options.some(option => option.id === value.optionId) ? value : 'Pick one of the options.'
    case 'MultiSelect':
      return value._tag === 'OptionsValue' && value.optionIds.every(optionId => options.some(option => option.id === optionId))
        ? { _tag: 'OptionsValue', optionIds: [...new Set(value.optionIds)] }
        : 'Pick from the options.'
    case 'Date':
      return value._tag === 'DateValue' && DATE_PATTERN.test(value.start) && (value.end === null || (DATE_PATTERN.test(value.end) && value.end >= value.start)) ? value : 'Pick a date.'
    case 'Person':
      return value._tag === 'PeopleValue' && value.memberIds.every(memberId => people.some(member => member.id === memberId))
        ? { _tag: 'PeopleValue', memberIds: [...new Set(value.memberIds)] }
        : 'Pick people from the workspace.'
    case 'Checkbox':
      return value._tag === 'CheckboxValue' ? value : 'That value does not fit this property.'
    default:
      return 'This property fills itself in.'
  }
}

/** Parses typed text for a number property: '', or a number (1,5 and 12% too). */
export const parseNumber = (text: string, format: NumberFormat): number | null | 'invalid' => {
  const cleaned = text.trim().replace(/[$€\s]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.')
  if (cleaned === '') return null
  const isPercent = cleaned.endsWith('%')
  const number = Number(isPercent ? cleaned.slice(0, -1) : cleaned)
  if (!Number.isFinite(number)) return 'invalid'
  return isPercent || format === 'percent' ? number / 100 : number
}

// FILTERS

export const operatorsFor = (property: Property | null): ReadonlyArray<Operator> => {
  switch (property?.type._tag ?? 'Title') {
    case 'Number': return ['is', 'isNot', 'greaterThan', 'lessThan', 'isEmpty', 'isNotEmpty']
    case 'Select': case 'Status': return ['is', 'isNot', 'isEmpty', 'isNotEmpty']
    case 'MultiSelect': case 'Person': case 'CreatedBy': case 'LastEditedBy': return ['contains', 'doesNotContain', 'isEmpty', 'isNotEmpty']
    case 'Date': case 'CreatedTime': case 'LastEditedTime': return ['is', 'before', 'after', 'isEmpty', 'isNotEmpty']
    case 'Checkbox': return ['isChecked', 'isNotChecked']
    default: return ['contains', 'doesNotContain', 'is', 'isNot', 'isEmpty', 'isNotEmpty']
  }
}

/** Operators that need no value to compare with. */
export const isUnary = (operator: Operator): boolean => operator === 'isEmpty' || operator === 'isNotEmpty' || operator === 'isChecked' || operator === 'isNotChecked'

const idsOf = (property: Property, row: Row): ReadonlyArray<string> => {
  if (property.type._tag === 'CreatedBy') return [row.createdBy]
  if (property.type._tag === 'LastEditedBy') return [row.updatedBy]
  const value = valueOf(property, row)
  return value?._tag === 'OptionValue' ? [value.optionId] : value?._tag === 'OptionsValue' ? value.optionIds : value?._tag === 'PeopleValue' ? value.memberIds : []
}

export const matchesFilter = (database: Database, filter: Filter, row: Row, people: ReadonlyArray<Person>): boolean => {
  const property = filter.propertyId === TITLE ? null : propertyOf(database, filter.propertyId)
  if (filter.propertyId !== TITLE && property === null) return true
  const text = textOf(property, row, people)
  if (filter.operator === 'isEmpty') return text === ''
  if (filter.operator === 'isNotEmpty') return text !== ''
  if (filter.operator === 'isChecked') return text === 'Yes'
  if (filter.operator === 'isNotChecked') return text !== 'Yes'
  // An unfinished filter (no value yet) keeps every row, like Notion.
  if (filter.value === '') return true
  const tag = property?.type._tag ?? 'Title'
  if (property !== null && (tag === 'Select' || tag === 'Status' || tag === 'MultiSelect' || tag === 'Person' || tag === 'CreatedBy' || tag === 'LastEditedBy')) {
    const has = idsOf(property, row).includes(filter.value)
    return filter.operator === 'is' || filter.operator === 'contains' ? has : !has
  }
  if (tag === 'Number') {
    const value = property === null ? null : valueOf(property, row)
    const number = value?._tag === 'NumberValue' ? value.value : null
    const wanted = Number(filter.value)
    if (number === null || !Number.isFinite(wanted)) return filter.operator === 'isNot'
    switch (filter.operator) {
      case 'is': return number === wanted
      case 'isNot': return number !== wanted
      case 'greaterThan': return number > wanted
      case 'lessThan': return number < wanted
      default: return true
    }
  }
  if (tag === 'Date' || tag === 'CreatedTime' || tag === 'LastEditedTime') {
    const day = text.slice(0, 10)
    if (day === '') return false
    switch (filter.operator) {
      case 'is': return day === filter.value
      case 'before': return day < filter.value
      case 'after': return day > filter.value
      default: return true
    }
  }
  const haystack = text.toLowerCase()
  const needle = filter.value.toLowerCase()
  switch (filter.operator) {
    case 'contains': return haystack.includes(needle)
    case 'doesNotContain': return !haystack.includes(needle)
    case 'is': return haystack === needle
    case 'isNot': return haystack !== needle
    default: return true
  }
}

// SORTING

const sortKey = (database: Database, propertyId: string, row: Row, people: ReadonlyArray<Person>): string | number | null => {
  if (propertyId === TITLE) return row.title.toLowerCase()
  const property = propertyOf(database, propertyId)
  if (property === null) return null
  switch (property.type._tag) {
    case 'CreatedTime': return row.createdAt
    case 'LastEditedTime': return row.updatedAt
    case 'Number': { const value = valueOf(property, row); return value?._tag === 'NumberValue' ? value.value : null }
    case 'Checkbox': { const value = valueOf(property, row); return value?._tag === 'CheckboxValue' && value.isChecked ? 1 : 0 }
    case 'Select': case 'Status': {
      // Options sort in their own order, as in Notion.
      const value = valueOf(property, row)
      return value?._tag === 'OptionValue' ? optionsOf(property).findIndex(option => option.id === value.optionId) : null
    }
    default: { const text = textOf(property, row, people).toLowerCase(); return text === '' ? null : text }
  }
}

/** Rows in the view's sort order; empty values last either way. Rows that
 *  tie keep their own order. */
export const sortRows = <R extends Row>(database: Database, sorts: ReadonlyArray<Sort>, rows: ReadonlyArray<R>, people: ReadonlyArray<Person>): ReadonlyArray<R> => {
  if (sorts.length === 0) return rows
  const keyed = rows.map((row, index) => ({ row, index, keys: sorts.map(sort => sortKey(database, sort.propertyId, row, people)) }))
  keyed.sort((a, b) => {
    for (const [i, sort] of sorts.entries()) {
      const x = a.keys[i] ?? null
      const y = b.keys[i] ?? null
      if (x === y) continue
      if (x === null) return 1
      if (y === null) return -1
      const order = x < y ? -1 : 1
      return sort.isDescending ? -order : order
    }
    return a.index - b.index
  })
  return keyed.map(entry => entry.row)
}

/** The rows a view shows, filtered (every filter must match), searched and sorted. */
export const rowsOf = <R extends Row>(database: Database, view: DatabaseView, rows: ReadonlyArray<R>, people: ReadonlyArray<Person>, query = ''): ReadonlyArray<R> => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  const shown = rows.filter(row =>
    view.filters.every(filter => matchesFilter(database, filter, row, people)) &&
    (words.length === 0 || words.every(word => [row.title, ...database.properties.map(property => textOf(property, row, people))].join(' ').toLowerCase().includes(word))))
  return sortRows(database, view.sorts, shown, people)
}

// GROUPS

export type Group<R> = Readonly<{ key: string; label: string; color: OptionColor; rows: ReadonlyArray<R> }>

export const NO_GROUP = ''

/** Properties a board (or table) can group by. */
export const canGroupBy = (property: Property): boolean =>
  property.type._tag === 'Select' || property.type._tag === 'Status' || property.type._tag === 'MultiSelect' || property.type._tag === 'Person' || property.type._tag === 'Checkbox'

/** Rows by the group property's value: one group per option (in option
 *  order, empty ones too), then "No <name>" for rows without one. A row
 *  with several tags shows in each of their groups. */
export const groupRows = <R extends Row>(property: Property, rows: ReadonlyArray<R>, people: ReadonlyArray<Person>): ReadonlyArray<Group<R>> => {
  if (property.type._tag === 'Checkbox') {
    const isChecked = (row: R) => { const value = valueOf(property, row); return value?._tag === 'CheckboxValue' && value.isChecked }
    return [
      { key: 'checked', label: `${property.name}: checked`, color: 'default', rows: rows.filter(isChecked) },
      { key: 'unchecked', label: `${property.name}: unchecked`, color: 'default', rows: rows.filter(row => !isChecked(row)) },
    ]
  }
  const keys: ReadonlyArray<Readonly<{ key: string; label: string; color: OptionColor }>> = property.type._tag === 'Person'
    ? people.map(member => ({ key: member.id, label: member.name, color: 'default' as const }))
    : optionsOf(property).map(option => ({ key: option.id, label: option.name, color: option.color }))
  const groups = keys.map(group => ({ ...group, rows: rows.filter(row => idsOf(property, row).includes(group.key)) }))
  const none = rows.filter(row => idsOf(property, row).length === 0)
  return [...groups.filter(group => property.type._tag !== 'Person' || group.rows.length > 0), { key: NO_GROUP, label: `No ${property.name}`, color: 'default', rows: none }]
}

/** The value a row takes when it moves into a group (or is added there). */
export const valueForGroup = (property: Property, key: string, current: Value | null): Value | null => {
  switch (property.type._tag) {
    case 'Select': case 'Status': return key === NO_GROUP ? null : { _tag: 'OptionValue', optionId: key }
    case 'MultiSelect': return key === NO_GROUP ? null : { _tag: 'OptionsValue', optionIds: [key] }
    case 'Person': return key === NO_GROUP ? null : { _tag: 'PeopleValue', memberIds: current?._tag === 'PeopleValue' ? [...new Set([...current.memberIds, key])] : [key] }
    case 'Checkbox': return { _tag: 'CheckboxValue', isChecked: key === 'checked' }
    default: return current
  }
}

/** Values a new row starts with so it shows up in the view: what its
 *  filters ask for, where that is one choice. */
export const valuesForNew = (database: Database, view: DatabaseView): Values => {
  const values: Record<string, Value> = {}
  for (const filter of view.filters) {
    const property = propertyOf(database, filter.propertyId)
    if (property === null || filter.value === '') continue
    if ((property.type._tag === 'Select' || property.type._tag === 'Status') && filter.operator === 'is') values[property.id] = { _tag: 'OptionValue', optionId: filter.value }
    if (property.type._tag === 'MultiSelect' && filter.operator === 'contains') values[property.id] = { _tag: 'OptionsValue', optionIds: [filter.value] }
    if (property.type._tag === 'Person' && filter.operator === 'contains') values[property.id] = { _tag: 'PeopleValue', memberIds: [filter.value] }
    if ((property.type._tag === 'Text' || property.type._tag === 'Url' || property.type._tag === 'Email' || property.type._tag === 'Phone') && (filter.operator === 'is' || filter.operator === 'contains')) values[property.id] = { _tag: 'TextValue', text: filter.value }
    if (property.type._tag === 'Checkbox') values[property.id] = { _tag: 'CheckboxValue', isChecked: filter.operator === 'isChecked' }
  }
  return values
}

// CHANGES

/** One change to a database's properties or views, as a page posts it. */
export const DatabaseChange = S.Union([
  S.TaggedStruct('AddProperty', { tag: S.String, name: S.String }),
  S.TaggedStruct('RenameProperty', { propertyId: S.String, name: S.String }),
  S.TaggedStruct('SetPropertyType', { propertyId: S.String, tag: S.String }),
  S.TaggedStruct('SetNumberFormat', { propertyId: S.String, format: NumberFormat }),
  S.TaggedStruct('DuplicateProperty', { propertyId: S.String }),
  S.TaggedStruct('DeleteProperty', { propertyId: S.String }),
  S.TaggedStruct('AddOption', { propertyId: S.String, name: S.String }),
  S.TaggedStruct('AddView', { layout: Layout }),
  S.TaggedStruct('RenameView', { viewId: S.String, name: S.String }),
  S.TaggedStruct('DuplicateView', { viewId: S.String }),
  S.TaggedStruct('DeleteView', { viewId: S.String }),
  S.TaggedStruct('SetLayout', { viewId: S.String, layout: Layout }),
  S.TaggedStruct('AddFilter', { viewId: S.String, propertyId: S.String }),
  S.TaggedStruct('SetFilter', { viewId: S.String, filterId: S.String, operator: Operator, value: S.String }),
  S.TaggedStruct('RemoveFilter', { viewId: S.String, filterId: S.String }),
  S.TaggedStruct('SetSort', { viewId: S.String, propertyId: S.String, isDescending: S.NullOr(S.Boolean) }),
  S.TaggedStruct('SetGroupBy', { viewId: S.String, propertyId: S.NullOr(S.String) }),
  S.TaggedStruct('SetDateBy', { viewId: S.String, propertyId: S.String }),
  S.TaggedStruct('SetHidden', { viewId: S.String, propertyId: S.String, isHidden: S.Boolean }),
])
export type DatabaseChange = typeof DatabaseChange.Type

/** The database after the change, the new item's id (property, option,
 *  view or filter) when it adds one, or why it cannot change. */
export type Changed = Readonly<{ database: Database; addedId: string | null }>

const nameOf = (name: string, fallback: string) => {
  const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
  return cleaned === '' ? fallback : cleaned
}

const freeName = (taken: ReadonlyArray<string>, name: string): string => {
  if (!taken.includes(name)) return name
  let n = 1
  while (taken.includes(`${name} ${n}`)) n++
  return `${name} ${n}`
}

export const applyChange = (database: Database, change: DatabaseChange, id: (prefix: string) => string): Changed | string => {
  const withProperty = (propertyId: string, f: (property: Property) => Property | string): Changed | string => {
    const property = propertyOf(database, propertyId)
    if (property === null) return 'That property is gone.'
    const next = f(property)
    return typeof next === 'string' ? next : { database: { ...database, properties: database.properties.map(entry => (entry.id === propertyId ? next : entry)) }, addedId: null }
  }
  const withView = (viewId: string, f: (view: DatabaseView) => DatabaseView | string): Changed | string => {
    const view = database.views.find(entry => entry.id === viewId)
    if (view === undefined) return 'That view is gone.'
    const next = f(view)
    return typeof next === 'string' ? next : { database: { ...database, views: database.views.map(entry => (entry.id === viewId ? next : entry)) }, addedId: null }
  }
  const isProperty = (propertyId: string) => propertyId === TITLE || propertyOf(database, propertyId) !== null
  switch (change._tag) {
    case 'AddProperty': {
      if (!isPropertyTag(change.tag)) return 'That property type does not exist.'
      if (database.properties.length >= MAX_PROPERTIES) return `A database holds up to ${MAX_PROPERTIES} properties.`
      const property: Property = { id: id('prop'), name: freeName(database.properties.map(entry => entry.name), nameOf(change.name, TYPE_LABEL[change.tag])), type: typeOf(change.tag, id) }
      return { database: { ...database, properties: [...database.properties, property] }, addedId: property.id }
    }
    case 'RenameProperty':
      return withProperty(change.propertyId, property => ({ ...property, name: nameOf(change.name, property.name) }))
    case 'SetPropertyType':
      if (!isPropertyTag(change.tag)) return 'That property type does not exist.'
      return withProperty(change.propertyId, property => (property.type._tag === change.tag ? property : { ...property, type: typeOf(change.tag as PropertyTag, id, property.type) }))
    case 'SetNumberFormat':
      return withProperty(change.propertyId, property => (property.type._tag === 'Number' ? { ...property, type: { _tag: 'Number', format: change.format } } : 'Only numbers have a format.'))
    case 'DuplicateProperty': {
      const property = propertyOf(database, change.propertyId)
      if (property === null) return 'That property is gone.'
      if (database.properties.length >= MAX_PROPERTIES) return `A database holds up to ${MAX_PROPERTIES} properties.`
      const copy: Property = { ...property, id: id('prop'), name: freeName(database.properties.map(entry => entry.name), property.name) }
      const at = database.properties.indexOf(property) + 1
      return { database: { ...database, properties: [...database.properties.slice(0, at), copy, ...database.properties.slice(at)] }, addedId: copy.id }
    }
    case 'DeleteProperty': {
      if (propertyOf(database, change.propertyId) === null) return 'That property is gone.'
      const views = database.views.map(view => ({
        ...view,
        filters: view.filters.filter(filter => filter.propertyId !== change.propertyId),
        sorts: view.sorts.filter(sort => sort.propertyId !== change.propertyId),
        groupBy: view.groupBy === change.propertyId ? null : view.groupBy,
        dateBy: view.dateBy === change.propertyId ? null : view.dateBy,
        hidden: view.hidden.filter(propertyId => propertyId !== change.propertyId),
      }))
      return { database: { properties: database.properties.filter(property => property.id !== change.propertyId), views }, addedId: null }
    }
    case 'AddOption': {
      const property = propertyOf(database, change.propertyId)
      if (property === null) return 'That property is gone.'
      const name = change.name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
      if (name === '') return 'Name the option.'
      const options = optionsOf(property)
      const known = options.find(option => option.name.toLowerCase() === name.toLowerCase())
      if (known !== undefined) return { database, addedId: known.id }
      if (options.length >= MAX_OPTIONS) return `A property holds up to ${MAX_OPTIONS} options.`
      const option: SelectOption = { id: id('opt'), name, color: OPTION_COLORS[(options.length + 1) % OPTION_COLORS.length] ?? 'default' }
      const type: PropertyType | string = property.type._tag === 'Select' || property.type._tag === 'MultiSelect'
        ? { _tag: property.type._tag, options: [...property.type.options, option] }
        : property.type._tag === 'Status'
          ? { _tag: 'Status', options: [...property.type.options, { ...option, group: 'todo' }] }
          : 'Only select properties have options.'
      if (typeof type === 'string') return type
      return { database: { ...database, properties: database.properties.map(entry => (entry.id === property.id ? { ...entry, type } : entry)) }, addedId: option.id }
    }
    case 'AddView': {
      if (database.views.length >= MAX_VIEWS) return `A database holds up to ${MAX_VIEWS} views.`
      const view = viewOf(change.layout, id('view'), database)
      const named = { ...view, name: freeName(database.views.map(entry => entry.name), view.name) }
      return { database: { ...database, views: [...database.views, named] }, addedId: named.id }
    }
    case 'RenameView':
      return withView(change.viewId, view => ({ ...view, name: nameOf(change.name, view.name) }))
    case 'DuplicateView': {
      const view = database.views.find(entry => entry.id === change.viewId)
      if (view === undefined) return 'That view is gone.'
      if (database.views.length >= MAX_VIEWS) return `A database holds up to ${MAX_VIEWS} views.`
      const copy = { ...view, id: id('view'), name: freeName(database.views.map(entry => entry.name), view.name) }
      const at = database.views.indexOf(view) + 1
      return { database: { ...database, views: [...database.views.slice(0, at), copy, ...database.views.slice(at)] }, addedId: copy.id }
    }
    case 'DeleteView':
      if (database.views.length <= 1) return 'A database keeps at least one view.'
      if (!database.views.some(view => view.id === change.viewId)) return 'That view is gone.'
      return { database: { ...database, views: database.views.filter(view => view.id !== change.viewId) }, addedId: null }
    case 'SetLayout':
      return withView(change.viewId, view => {
        const fresh = viewOf(change.layout, view.id, database)
        return { ...view, layout: change.layout, groupBy: change.layout === 'board' ? (view.groupBy ?? fresh.groupBy) : view.groupBy, dateBy: view.dateBy ?? fresh.dateBy }
      })
    case 'AddFilter': {
      if (!isProperty(change.propertyId)) return 'That property is gone.'
      const filterId = id('filter')
      const property = change.propertyId === TITLE ? null : propertyOf(database, change.propertyId)
      const changed = withView(change.viewId, view =>
        view.filters.length >= MAX_FILTERS ? `A view holds up to ${MAX_FILTERS} filters.` : { ...view, filters: [...view.filters, { id: filterId, propertyId: change.propertyId, operator: operatorsFor(property)[0] ?? 'contains', value: '' }] })
      return typeof changed === 'string' ? changed : { ...changed, addedId: filterId }
    }
    case 'SetFilter':
      return withView(change.viewId, view => {
        const filter = view.filters.find(entry => entry.id === change.filterId)
        if (filter === undefined) return 'That filter is gone.'
        const property = filter.propertyId === TITLE ? null : propertyOf(database, filter.propertyId)
        if (!operatorsFor(property).includes(change.operator)) return 'That filter does not fit this property.'
        const value = isUnary(change.operator) ? '' : change.value.slice(0, MAX_TEXT)
        return { ...view, filters: view.filters.map(entry => (entry.id === filter.id ? { ...entry, operator: change.operator, value } : entry)) }
      })
    case 'RemoveFilter':
      return withView(change.viewId, view => ({ ...view, filters: view.filters.filter(filter => filter.id !== change.filterId) }))
    case 'SetSort':
      if (!isProperty(change.propertyId)) return 'That property is gone.'
      return withView(change.viewId, view => {
        const others = view.sorts.filter(sort => sort.propertyId !== change.propertyId)
        if (change.isDescending === null) return { ...view, sorts: others }
        const existing = view.sorts.findIndex(sort => sort.propertyId === change.propertyId)
        const sort = { propertyId: change.propertyId, isDescending: change.isDescending }
        return { ...view, sorts: existing < 0 ? [...others, sort] : view.sorts.map(entry => (entry.propertyId === change.propertyId ? sort : entry)) }
      })
    case 'SetGroupBy': {
      const property = change.propertyId === null ? null : propertyOf(database, change.propertyId)
      if (change.propertyId !== null && (property === null || !canGroupBy(property))) return 'Group by a select, status, person or checkbox property.'
      return withView(change.viewId, view => ({ ...view, groupBy: change.propertyId }))
    }
    case 'SetDateBy': {
      const property = propertyOf(database, change.propertyId)
      if (property === null || (property.type._tag !== 'Date' && property.type._tag !== 'CreatedTime' && property.type._tag !== 'LastEditedTime')) return 'Pick a date property.'
      return withView(change.viewId, view => ({ ...view, dateBy: change.propertyId }))
    }
    case 'SetHidden':
      if (!isProperty(change.propertyId) || change.propertyId === TITLE) return 'That property cannot be hidden.'
      return withView(change.viewId, view => ({ ...view, hidden: change.isHidden ? [...new Set([...view.hidden, change.propertyId])] : view.hidden.filter(propertyId => propertyId !== change.propertyId) }))
  }
}
