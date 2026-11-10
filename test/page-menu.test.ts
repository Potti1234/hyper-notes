import { assert, describe, it } from '@effect/vitest'

import * as PagePage from '@/app/page/page'
import { wordCount } from '@/app/search'
import { DEMO_MEMBERS, demoData } from '@/app/seed'

/* The ••• menu's footer (word count, last edit) and Ctrl+L's notice. */

const NOW = Date.UTC(2026, 10, 10, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!

const model = (pageId: string) => {
  const data = demoData(NOW)
  const slice = PagePage.sliceOf({ version: 0, members: data.members, pages: data.pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }, pageId, 'avery', NOW)
  return PagePage.init({ ...slice, me: avery, view: 'page', pageId }).model
}

describe('page menu', () => {
  it('counts words, not punctuation or spaces', () => {
    assert.strictEqual(wordCount(''), 0)
    assert.strictEqual(wordCount('  one  two\nthree '), 3)
    assert.strictEqual(wordCount('Hello — world!'), 2)
    assert.strictEqual(wordCount('café 2026 naïve'), 3)
  })

  it('the footer has the word count, who edited last and when', () => {
    const footer = PagePage.optionsFooter(model('demo-wiki'))
    assert.match(footer[0] ?? '', /^Word count: [0-9,]+ words?$/)
    assert.isTrue(footer.some(line => line.startsWith('Last edited by ')))
    assert.strictEqual(footer.length, 3)
  })

  it('Ctrl+L tells the person the link was copied', () => {
    const copied = PagePage.update(model('demo-wiki'), PagePage.Message.CopiedLink())
    assert.strictEqual(copied.model.notice, 'Copied link to clipboard')
    assert.deepStrictEqual(copied.commands ?? [], [])
  })
})
