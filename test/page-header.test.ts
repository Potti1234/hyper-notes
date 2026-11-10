import { assert, describe, it } from '@effect/vitest'

import * as PagePage from '@/app/page/page'
import { DEMO_MEMBERS, demoData } from '@/app/seed'
import { isEmoji } from '@/app/emoji'

/* The page header and ••• options: each click or choice becomes one
   ChangePage Command with an explicit change, checked again in update
   (locked pages, Trash, unknown emoji, covers and links). */

const NOW = Date.UTC(2026, 10, 10, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!

const model = (pageId: string, edit: (page: NonNullable<PagePage.Model['page']>) => NonNullable<PagePage.Model['page']> = page => page): PagePage.Model => {
  const data = demoData(NOW)
  const slice = PagePage.sliceOf({ version: 0, members: data.members, pages: data.pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments }, pageId, 'avery', NOW)
  const base = PagePage.init({ ...slice, me: avery, view: 'page', pageId }).model
  return { ...base, page: base.page === null ? null : edit(base.page) }
}

type Change = Readonly<{ _tag: string } & Record<string, unknown>>
const changes = (result: ReturnType<typeof PagePage.update>): ReadonlyArray<Change> =>
  (result.commands ?? []).flatMap(command => (command.name === 'ChangePage' ? [(command.args as { change: Change }).change] : []))
const step = (start: PagePage.Model, ...messages: ReadonlyArray<PagePage.Message>): ReturnType<typeof PagePage.update> => {
  let result: ReturnType<typeof PagePage.update> = { model: start }
  for (const message of messages) result = PagePage.update(result.model, message)
  return result
}

describe('page header', () => {
  it('"Add icon" picks a known emoji, the same one each time', () => {
    const start = model('demo-wiki', page => ({ ...page, icon: '' }))
    const [first] = changes(PagePage.update(start, PagePage.Message.ClickedAddIcon()))
    const [again] = changes(PagePage.update(start, PagePage.Message.ClickedAddIcon()))
    assert.strictEqual(first?._tag, 'SetIcon')
    assert.isTrue(isEmoji(String(first?.['icon'])))
    assert.deepStrictEqual(first, again)
  })

  it('the icon opens a picker that focuses its filter; a chosen emoji is set, an unknown one is not', () => {
    const opened = PagePage.update(model('demo-wiki'), PagePage.Message.ClickedIcon())
    assert.strictEqual(opened.model.picker?.field, 'icon')
    assert.strictEqual(opened.model.focus?.selector, '#picker-input')
    assert.deepStrictEqual(changes(PagePage.update(opened.model, PagePage.Message.ChosePicker({ value: 'emoji:🚀' }))), [{ _tag: 'SetIcon', icon: '🚀' }])
    assert.deepStrictEqual(changes(PagePage.update(opened.model, PagePage.Message.ChosePicker({ value: 'emoji:<b>' }))), [])
    assert.deepStrictEqual(changes(PagePage.update(opened.model, PagePage.Message.ChosePicker({ value: 'remove' }))), [{ _tag: 'SetIcon', icon: '' }])
  })

  it('covers: add a gallery cover, change it to an https link, remove it', () => {
    const bare = model('demo-wiki', page => ({ ...page, cover: { _tag: 'NoCover' } }))
    const [added] = changes(PagePage.update(bare, PagePage.Message.ClickedAddCover()))
    assert.strictEqual((added?.['cover'] as { _tag: string } | undefined)?._tag, 'GalleryCover')
    const covered = model('demo-wiki', page => ({ ...page, cover: { _tag: 'GalleryCover', name: 'gradient-1' } }))
    const picker = PagePage.update(covered, PagePage.Message.ClickedCover()).model
    const typed = PagePage.update(picker, PagePage.Message.ChangedPickerQuery({ query: 'https://example.com/a.png' })).model
    assert.strictEqual(PagePage.pickerItems(typed)[0]?.value, 'url:https://example.com/a.png')
    assert.deepStrictEqual(changes(PagePage.update(typed, PagePage.Message.PressedPickerKey({ key: 'Enter' }))), [{ _tag: 'SetCover', cover: { _tag: 'ImageCover', url: 'https://example.com/a.png' } }])
    assert.deepStrictEqual(changes(PagePage.update(picker, PagePage.Message.ChosePicker({ value: 'url:javascript:alert(1)' }))), [])
    assert.deepStrictEqual(changes(PagePage.update(picker, PagePage.Message.ChosePicker({ value: 'url:https://x.test/a.png")' }))), [])
    assert.deepStrictEqual(changes(PagePage.update(covered, PagePage.Message.ClickedRemoveCover())), [{ _tag: 'SetCover', cover: { _tag: 'NoCover' } }])
  })

  it('••• sets the font, small text, full width and the lock', () => {
    const start = model('demo-wiki')
    const choose = (value: string) => changes(step(start, PagePage.Message.ClickedPageOptions(), PagePage.Message.ChosePicker({ value })))
    assert.deepStrictEqual(choose('font:serif'), [{ _tag: 'SetFont', font: 'serif' }])
    assert.deepStrictEqual(choose('font:comic'), [])
    assert.deepStrictEqual(choose('small'), [{ _tag: 'SetSmallText', isOn: !start.page!.isSmallText }])
    assert.deepStrictEqual(choose('full'), [{ _tag: 'SetFullWidth', isOn: !start.page!.isFullWidth }])
    assert.deepStrictEqual(choose('lock'), [{ _tag: 'SetLocked', isOn: true }])
  })

  it('a locked page keeps its look until it is unlocked', () => {
    const locked = model('demo-wiki', page => ({ ...page, isLocked: true, icon: '', cover: { _tag: 'NoCover' } }))
    assert.deepStrictEqual(changes(PagePage.update(locked, PagePage.Message.ClickedAddIcon())), [])
    assert.deepStrictEqual(changes(PagePage.update(locked, PagePage.Message.ClickedAddCover())), [])
    assert.isNull(PagePage.update(locked, PagePage.Message.ClickedIcon()).model.picker)
    assert.deepStrictEqual(changes(step(locked, PagePage.Message.ClickedPageOptions(), PagePage.Message.ChosePicker({ value: 'font:mono' }))), [])
    assert.deepStrictEqual(changes(step(locked, PagePage.Message.ClickedPageOptions(), PagePage.Message.ChosePicker({ value: 'lock' }))), [{ _tag: 'SetLocked', isOn: false }])
    assert.deepStrictEqual(changes(PagePage.update(locked, PagePage.Message.ClickedUnlock())), [{ _tag: 'SetLocked', isOn: false }])
  })

  it('nothing changes in Trash', () => {
    const trashed = { ...model('demo-wiki', page => ({ ...page, icon: '' })), isInTrash: true }
    assert.deepStrictEqual(changes(PagePage.update(trashed, PagePage.Message.ClickedAddIcon())), [])
    assert.isNull(PagePage.update(trashed, PagePage.Message.ClickedPageOptions()).model.picker)
  })
})
