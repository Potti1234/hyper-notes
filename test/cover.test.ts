import { assert, describe, it } from '@effect/vitest'

import type { Page } from '@/app/domain'
import { coverPosition, patchOf } from '@/app/page/header'
import * as PagePage from '@/app/page/page'
import { DEMO_MEMBERS, demoData } from '@/app/seed'

/* Reposition: an image cover drags up and down as a draft in the Model,
   and only "Save position" changes the page, through ChangePage. */

const NOW = Date.UTC(2026, 10, 10, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!
type Result = ReturnType<typeof PagePage.update>
const changes = (result: Result) =>
  (result.commands ?? []).flatMap(command => (command.name === 'ChangePage' ? [(command.args as { change: unknown }).change] : []))

const IMAGE = { _tag: 'ImageCover', url: 'https://example.com/cover.jpg' } as const

const model = (edit: (page: Page) => Page) => {
  const data = demoData(NOW)
  const pages = data.pages.map(page => (page.id === 'demo-wiki' ? edit(page) : page))
  const slice = PagePage.sliceOf({ version: 0, members: data.members, pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }, 'demo-wiki', 'avery', NOW)
  return PagePage.init({ ...slice, me: avery, view: 'page', pageId: 'demo-wiki' }).model
}
const withImage = model(page => ({ ...page, cover: IMAGE, coverPosition: 50 }))
const run = (from: PagePage.Model, ...messages: ReadonlyArray<PagePage.Message>) =>
  messages.reduce<Result>((result, message) => PagePage.update(result.model, message), { model: from })

describe('cover reposition', () => {
  it('a position stays between 0 and 100, whole', () => {
    assert.strictEqual(coverPosition(-20), 0)
    assert.strictEqual(coverPosition(140), 100)
    assert.strictEqual(coverPosition(33.6), 34)
    assert.deepStrictEqual(patchOf({ _tag: 'SetCoverPosition', position: 120 }), { coverPosition: 100 })
  })

  it('Reposition starts from where the cover is; dragging only moves the draft', () => {
    const moved = run(withImage, PagePage.Message.ClickedReposition(), PagePage.Message.MovedCover({ position: 130 }))
    assert.strictEqual(moved.model.coverDraft, 100)
    assert.deepStrictEqual(changes(moved), [])
    const broken = PagePage.update(moved.model, PagePage.Message.MovedCover({ position: Number.NaN }))
    assert.strictEqual(broken.model.coverDraft, 100)
  })

  it('Save position saves the draft and ends repositioning', () => {
    const saved = run(withImage, PagePage.Message.ClickedReposition(), PagePage.Message.MovedCover({ position: 20 }), PagePage.Message.ClickedSaveCover())
    assert.isNull(saved.model.coverDraft)
    assert.deepStrictEqual(changes(saved), [{ _tag: 'SetCoverPosition', position: 20 }])
  })

  it('Cancel, or saving where it already was, changes nothing', () => {
    const canceled = run(withImage, PagePage.Message.ClickedReposition(), PagePage.Message.MovedCover({ position: 20 }), PagePage.Message.ClickedCancelCover())
    assert.isNull(canceled.model.coverDraft)
    assert.deepStrictEqual(changes(canceled), [])
    const unmoved = run(withImage, PagePage.Message.ClickedReposition(), PagePage.Message.ClickedSaveCover())
    assert.deepStrictEqual(changes(unmoved), [])
  })

  it('gallery covers, locked pages and pages without a draft are refused', () => {
    const gallery = run(model(page => ({ ...page, cover: { _tag: 'GalleryCover', name: 'red' } })), PagePage.Message.ClickedReposition())
    assert.isNull(gallery.model.coverDraft)
    const locked = run(model(page => ({ ...page, cover: IMAGE, isLocked: true })), PagePage.Message.ClickedReposition())
    assert.isNull(locked.model.coverDraft)
    const stray = run(withImage, PagePage.Message.MovedCover({ position: 10 }), PagePage.Message.ClickedSaveCover())
    assert.isNull(stray.model.coverDraft)
    assert.deepStrictEqual(changes(stray), [])
  })
})
