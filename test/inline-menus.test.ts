import { describe, expect, it } from 'vitest'

import * as B from '../src/app/editor/blocks'
import { CODE_LANGUAGES, iconChoices, inlineMenuItems, languageChoices, linkChoices, linkUnderCaret, normalizeLink } from '../src/app/editor/menus'
import { type InlineMenu, caret } from '../src/app/editor/state'
import * as T from '../src/app/editor/text'

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

describe('links', () => {
  const pages = [{ id: 'p1', title: 'Engineering wiki', icon: '' }, { id: 'here', title: 'Engineering notes', icon: '' }]

  it('the link prompt offers the typed text as a web link, then matching pages other than this one', () => {
    expect(linkChoices('', pages, 'here')).toEqual([])
    expect(linkChoices('eng', pages, 'here')).toEqual([
      { group: 'Link', label: 'eng', url: 'https://eng' },
      { group: 'Link to page', label: 'Engineering wiki', url: '/p/p1' },
    ])
    expect(linkChoices('http://a.b', pages, 'here')[0]?.url).toBe('http://a.b')
    expect(linkChoices('mailto:x@y.z', pages, 'here')[0]?.url).toBe('mailto:x@y.z')
    expect(normalizeLink('/p/p1')).toBe('/p/p1')
  })

  it('the link card follows a collapsed caret inside or at the end of a link', () => {
    const text = T.setLink(T.plain('see the docs now'), 8, 12, 'https://d.example')
    const doc = [{ ...B.paragraph('a'), text }]
    const at = (offset: number) => linkUnderCaret(doc, caret('a', offset))
    expect(at(10)).toEqual({ blockId: 'a', from: 8, to: 12, url: 'https://d.example' })
    expect(at(12)).toEqual({ blockId: 'a', from: 8, to: 12, url: 'https://d.example' })
    expect(at(8)).toBeNull()
    expect(at(2)).toBeNull()
    expect(linkUnderCaret(doc, { _tag: 'TextSelection', anchor: { blockId: 'a', offset: 9 }, focus: { blockId: 'a', offset: 11 } })).toBeNull()
    expect(linkUnderCaret(doc, caret('missing', 0))).toBeNull()
  })
})

describe('block settings', () => {
  it('the language list filters by the typed text', () => {
    expect(languageChoices('')).toEqual(CODE_LANGUAGES)
    expect(languageChoices('pyt')).toEqual(['python'])
    expect(languageChoices('script')).toEqual(['javascript', 'typescript'])
    expect(languageChoices('zz')).toEqual([])
  })

  it('the callout icon picker filters emoji by word starts', () => {
    expect(iconChoices('')).toHaveLength(30)
    expect(iconChoices('rock').map(entry => entry.char)).toContain(String.fromCodePoint(0x1f680))
    expect(iconChoices('qqqq')).toEqual([])
  })
})
