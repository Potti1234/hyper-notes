import { describe, expect, it } from 'vitest'

import { inlineMenuItems } from '../src/app/editor/menus'
import type { InlineMenu } from '../src/app/editor/state'

const sources = {
  members: [{ id: 'm1', name: 'Morgan Vale' }, { id: 'm2', name: 'Riley Quinn' }],
  pages: [{ id: 'p1', title: 'Engineering wiki', icon: '' }, { id: 'p2', title: '', icon: '' }],
  today: '2026-12-31',
}
const menu = (trigger: '@' | ':', query: string): InlineMenu => ({ _tag: 'InlineMenu', trigger, blockId: 'a', from: 0, query, active: 0 })
const tags = (trigger: '@' | ':', query: string) => inlineMenuItems(menu(trigger, query), sources).map(item => `${item.group}:${item.label}`)

describe('inline menus', () => {
  it('"@" lists people, then pages, then dates, filtered by the query', () => {
    expect(tags('@', '')).toEqual([
      'People:Morgan Vale', 'People:Riley Quinn', 'Link to page:Engineering wiki', 'Link to page:Untitled',
      'Date:Today', 'Date:Tomorrow', 'Date:Yesterday',
    ])
    expect(tags('@', 'mor')).toEqual(['People:Morgan Vale', 'Date:Tomorrow'])
    expect(tags('@', 'wiki')).toEqual(['Link to page:Engineering wiki'])
    expect(tags('@', 'zzz')).toEqual([])
  })

  it('relative dates are counted from today, across month and year ends', () => {
    const dates = inlineMenuItems(menu('@', ''), sources).flatMap(item => (item.piece._tag === 'DateMention' ? [item.piece.date] : []))
    expect(dates).toEqual(['2026-12-31', '2027-01-01', '2026-12-30'])
  })

  it('a typed ISO date is offered only when it exists', () => {
    expect(tags('@', '2027-02-14')).toEqual(['Date:February 14, 2027'])
    expect(tags('@', '2027-02-30')).toEqual([])
  })

  it('people and pages become mention atoms without marks', () => {
    const [person, page] = inlineMenuItems(menu('@', 'g'), sources)
    expect(person?.piece).toMatchObject({ _tag: 'PersonMention', memberId: 'm1', marks: { bold: false, link: null } })
    expect(page?.piece).toMatchObject({ _tag: 'PageMention', pageId: 'p1' })
  })

  it('":" filters emoji by the start of a word in the name and inserts the character', () => {
    const items = inlineMenuItems(menu(':', 'rock'), sources)
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(item => item.group === 'Emoji' && item.piece._tag === 'Text')).toBe(true)
    expect(items.some(item => item.piece._tag === 'Text' && item.piece.text === String.fromCodePoint(0x1f680))).toBe(true)
    expect(inlineMenuItems(menu(':', 'qqqq'), sources)).toEqual([])
  })
})
