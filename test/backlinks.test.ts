import { assert, describe, it } from '@effect/vitest'

import * as B from '@/app/editor/blocks'
import { PLAIN } from '@/app/editor/schema'
import * as PagePage from '@/app/page/page'
import { DEMO_HOME, DEMO_MEMBERS, demoData } from '@/app/seed'

const NOW = Date.UTC(2026, 10, 10, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!

describe('backlinks', () => {
  it('a document points at a page through mentions, /p/ links, link-to-page blocks and table cells, nested too', () => {
    const mention = [{ ...B.paragraph('a'), text: [{ _tag: 'PageMention' as const, pageId: 'x', marks: PLAIN }] }]
    const link = [{ ...B.paragraph('a', 'see'), text: [{ _tag: 'Text' as const, text: 'see', marks: { ...PLAIN, link: '/p/x#block-1' } }] }]
    const block = [B.block('a', { _tag: 'LinkToPage', pageId: 'x' })]
    const cell = [B.block('t', { _tag: 'Table', hasHeaderRow: false, hasHeaderColumn: false, rows: [[mention[0]!.text]] })]
    const nested = [B.block('a', { _tag: 'Toggle', isOpen: false }, [], mention)]
    for (const doc of [mention, link, block, cell, nested]) assert.isTrue(B.mentionsPage(doc, 'x'))
    assert.isFalse(B.mentionsPage(mention, 'y'))
    const other = [{ ...B.paragraph('a', 'see'), text: [{ _tag: 'Text' as const, text: 'see', marks: { ...PLAIN, link: '/p/xy' } }] }]
    assert.isFalse(B.mentionsPage(other, 'x'))
  })

  const model = (pageId: string) => {
    const data = demoData(NOW)
    const slice = PagePage.sliceOf({ version: 0, members: data.members, pages: data.pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments }, pageId, 'avery', NOW)
    return PagePage.init({ ...slice, me: avery, view: 'page', pageId }).model
  }

  it('the page lists the visible pages that point at it, closed until clicked', () => {
    const wiki = model('demo-wiki')
    assert.deepStrictEqual(wiki.backlinks.map(entry => entry.id), [DEMO_HOME])
    assert.isFalse(wiki.isBacklinksOpen)
    const opened = PagePage.update(wiki, PagePage.Message.ClickedBacklinks())
    assert.isTrue(opened.model.isBacklinksOpen)
    assert.deepStrictEqual(model(DEMO_HOME).backlinks, [])
  })
})
