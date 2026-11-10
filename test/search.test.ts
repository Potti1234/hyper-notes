import { assert, describe, it } from '@effect/vitest'

import * as B from '@/app/editor/blocks'
import { PLAIN } from '@/app/editor/schema'
import * as PagePage from '@/app/page/page'
import { pageText, searchPages, snippetOf } from '@/app/search'
import { DEMO_HOME, DEMO_MEMBERS, demoData } from '@/app/seed'
import type { WorkspaceState } from '@/app/store'

const NOW = Date.UTC(2026, 10, 10, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!

const stateOf = (change: (data: ReturnType<typeof demoData>) => ReturnType<typeof demoData> = data => data): WorkspaceState => {
  const data = change(demoData(NOW))
  return { version: 0, members: data.members, pages: data.pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }
}

describe('search', () => {
  it('reads a page as text: mentions by their label, table cells and nested blocks too', () => {
    const state = stateOf()
    const doc = [
      { ...B.paragraph('a'), text: [{ _tag: 'Text' as const, text: 'Ask ', marks: PLAIN }, { _tag: 'PersonMention' as const, memberId: 'morgan', marks: PLAIN }, { _tag: 'Text' as const, text: ' about ', marks: PLAIN }, { _tag: 'PageMention' as const, pageId: 'demo-wiki', marks: PLAIN }] },
      B.block('t', { _tag: 'Table', hasHeaderRow: false, hasHeaderColumn: false, rows: [[[{ _tag: 'Text', text: 'cell one', marks: PLAIN }], [{ _tag: 'Text', text: 'cell two', marks: PLAIN }]]] }),
      B.block('g', { _tag: 'Toggle', isOpen: false }, [], [B.paragraph('n', 'hidden inside')]),
    ]
    const morgan = state.members.find(member => member.id === 'morgan')!.name
    assert.strictEqual(pageText(state, doc), `Ask ${morgan} about Engineering Wiki cell one cell two hidden inside`)
  })

  it('cuts a snippet around the first match, marking cut ends', () => {
    assert.deepStrictEqual(snippetOf('Short sentences. Plain words.', 'plain'), { before: 'Short sentences. ', match: 'Plain', after: ' words.' })
    const long = `${'a'.repeat(50)} needle ${'b'.repeat(120)}`
    const cut = snippetOf(long, 'needle')!
    assert.isTrue(cut.before.startsWith('…') && cut.after.endsWith('…') && cut.match === 'needle')
    assert.isNull(snippetOf('nothing here', 'needle'))
  })

  it('finds pages by their text, needing every word, with the match to highlight', () => {
    const hits = searchPages(stateOf(), 'avery', 'plain words')
    assert.deepStrictEqual(hits.map(hit => hit.pageId), ['demo-style'])
    assert.deepStrictEqual(hits[0]!.snippet, { before: 'Short sentences. ', match: 'Plain', after: ' words.' })
    assert.strictEqual(hits[0]!.path, 'Engineering Wiki')
    assert.isFalse(hits[0]!.isTitleMatch)
    assert.deepStrictEqual(searchPages(stateOf(), 'avery', 'plain giraffe'), [])
  })

  it('puts title matches first, then the most recently edited', () => {
    const hits = searchPages(stateOf(), 'avery', 'wiki')
    assert.strictEqual(hits[0]!.pageId, 'demo-wiki')
    assert.isTrue(hits[0]!.isTitleMatch)
    assert.include(hits.map(hit => hit.pageId), DEMO_HOME)
  })

  it('leaves out private pages of others and pages in Trash', () => {
    assert.deepStrictEqual(searchPages(stateOf(), 'avery', 'only i can see').map(hit => hit.pageId), ['demo-journal'])
    assert.deepStrictEqual(searchPages(stateOf(), 'morgan', 'only i can see'), [])
    const trashed = stateOf(data => ({ ...data, pages: data.pages.map(page => (page.id === 'demo-wiki' ? { ...page, trashedAt: NOW } : page)) }))
    const ids = searchPages(trashed, 'avery', 'plain').map(hit => hit.pageId)
    assert.notInclude(ids, 'demo-style')
  })

  it('with no words lists recent pages, newest edit first', () => {
    const hits = searchPages(stateOf(), 'avery', '  ')
    const times = hits.map(hit => hit.updatedAt)
    assert.deepStrictEqual(times, [...times].sort((a, b) => b - a))
    assert.isTrue(hits.every(hit => hit.snippet === null))
  })

  const tags = (result: ReturnType<typeof PagePage.update>) => (result.commands ?? []).map(command => command.name)
  const model = () => {
    const slice = PagePage.sliceOf(stateOf(), DEMO_HOME, 'avery', NOW)
    return PagePage.init({ ...slice, me: avery, view: 'page', pageId: DEMO_HOME }).model
  }

  it('the palette asks for results as you type and only shows the ones for what it says now', () => {
    const opened = PagePage.update(model(), PagePage.Message.ClickedSearch())
    assert.include(tags(opened), 'SearchPages')
    assert.isNull(opened.model.search)
    const typed = PagePage.update(opened.model, PagePage.Message.ChangedPickerQuery({ query: 'plain' }))
    assert.deepStrictEqual(tags(typed), ['SearchPages'])
    const hits = searchPages(stateOf(), 'avery', 'plain')
    const stale = PagePage.update(typed.model, PagePage.Message.GotSearch({ query: 'pla', isTitlesOnly: false, hits: searchPages(stateOf(), 'avery', 'pla') }))
    assert.isNull(stale.model.search)
    const got = PagePage.update(typed.model, PagePage.Message.GotSearch({ query: 'plain', isTitlesOnly: false, hits }))
    const items = PagePage.pickerItems(got.model)
    const style = items.find(item => item.value === 'demo-style')!
    assert.deepStrictEqual(style.detail, { before: 'Short sentences. ', match: 'Plain', after: ' words.' })
    assert.strictEqual(style.hint, 'Engineering Wiki')
    const other = PagePage.update(got.model, PagePage.Message.ChangedPickerQuery({ query: 'plainer' }))
    assert.isFalse(PagePage.pickerItems(other.model).some(item => item.detail !== undefined))
  })

  it('results arriving after the palette closed are dropped', () => {
    const opened = PagePage.update(model(), PagePage.Message.ClickedSearch()).model
    const closed = PagePage.update(opened, PagePage.Message.ClosedPicker()).model
    assert.isNull(PagePage.update(closed, PagePage.Message.GotSearch({ query: '', isTitlesOnly: false, hits: [] })).model.search)
  })
})

describe('search: Only titles', () => {
  it('finds pages by title alone and leaves out text-only matches', () => {
    assert.deepStrictEqual(searchPages(stateOf(), 'avery', 'plain words', true), [])
    const hits = searchPages(stateOf(), 'avery', 'wiki', true)
    assert.isAbove(hits.length, 0)
    assert.isTrue(hits.every(hit => hit.isTitleMatch && hit.snippet === null))
  })

  it('the filter reruns the search and drops results for the other setting', () => {
    const slice = PagePage.sliceOf(stateOf(), DEMO_HOME, 'avery', NOW)
    const start = PagePage.init({ ...slice, me: avery, view: 'page', pageId: DEMO_HOME }).model
    const typed = PagePage.update(PagePage.update(start, PagePage.Message.ClickedSearch()).model, PagePage.Message.ChangedPickerQuery({ query: 'plain' })).model
    const on = PagePage.update(typed, PagePage.Message.ToggledSearchTitlesOnly())
    assert.isTrue(on.model.isSearchTitlesOnly)
    assert.deepStrictEqual((on.commands ?? []).map(command => command.name), ['SearchPages'])
    const late = PagePage.update(on.model, PagePage.Message.GotSearch({ query: 'plain', isTitlesOnly: false, hits: searchPages(stateOf(), 'avery', 'plain') }))
    assert.isNull(late.model.search)
    const got = PagePage.update(on.model, PagePage.Message.GotSearch({ query: 'plain', isTitlesOnly: true, hits: [] }))
    assert.deepStrictEqual(got.model.search, { query: 'plain', hits: [] })
    assert.deepStrictEqual(PagePage.update(start, PagePage.Message.ToggledSearchTitlesOnly()).model, start)
  })
})
