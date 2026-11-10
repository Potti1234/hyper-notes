import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import * as PagePage from '@/app/page/page'
import { DEMO_HOME, DEMO_MEMBERS } from '@/app/seed'
import { Workspace } from '@/app/store'
import { workspaceLayer } from './support'

/* The Trash page: search, who deleted what and when, and "Delete from Trash"
   asking before it deletes for good. */

const NOW = Date.UTC(2026, 10, 10, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!
const tags = (result: ReturnType<typeof PagePage.update>) => (result.commands ?? []).map(command => command.name)

const trashModel = Effect.gen(function* () {
  const workspace = yield* Workspace
  const kept = yield* workspace.createPage({ parentId: DEMO_HOME, section: 'workspace', title: 'Release notes' }, 'avery')
  const other = yield* workspace.createPage({ parentId: null, section: 'workspace', title: 'Budget' }, 'avery')
  yield* workspace.trashPage(kept.id, 'morgan')
  yield* workspace.trashPage(other.id, 'avery')
  const slice = PagePage.sliceOf(yield* workspace.current, null, 'avery', NOW)
  return { kept, other, model: PagePage.init({ ...slice, me: avery, view: 'trash', pageId: null }).model }
}).pipe(Effect.provide(workspaceLayer()))

describe('page: Trash', () => {
  it.effect('lists who deleted each page and where it was', () =>
    Effect.gen(function* () {
      const { kept, other, model } = yield* trashModel
      const ours = model.trash.filter(entry => entry.id === kept.id || entry.id === other.id)
      assert.deepStrictEqual(ours.map(entry => [entry.title, entry.trashedBy, entry.path]).sort(), [['Budget', 'Avery Finch', ''], ['Release notes', 'Morgan Vale', 'Getting Started']])
    }))

  it.effect('search matches every word against the title and location', () =>
    Effect.gen(function* () {
      const { kept, model } = yield* trashModel
      const typed = PagePage.update(model, PagePage.Message.ChangedTrashQuery({ query: 'getting release' })).model
      assert.deepStrictEqual(PagePage.trashMatches(typed.trash, typed.trashQuery).map(entry => entry.id), [kept.id])
      assert.deepStrictEqual(PagePage.trashMatches(typed.trash, 'nothing like this'), [])
      assert.strictEqual(PagePage.trashMatches(typed.trash, '  ').length, typed.trash.length)
    }))

  it.effect('Delete from Trash asks first; only the confirmed page is deleted; cancel keeps it', () =>
    Effect.gen(function* () {
      const { kept, other, model } = yield* trashModel
      const asked = PagePage.update(model, PagePage.Message.ClickedDeleteForever({ pageId: kept.id }))
      assert.strictEqual(asked.model.confirmDelete, kept.id)
      assert.deepStrictEqual(tags(asked), ['FocusElement'])
      assert.deepStrictEqual(tags(PagePage.update(asked.model, PagePage.Message.ConfirmedDelete({ pageId: other.id }))), [])
      const deleted = PagePage.update(asked.model, PagePage.Message.ConfirmedDelete({ pageId: kept.id }))
      assert.deepStrictEqual(tags(deleted), ['DeletePage'])
      assert.isNull(deleted.model.confirmDelete)
      assert.isNull(PagePage.update(asked.model, PagePage.Message.CanceledDelete()).model.confirmDelete)
      assert.deepStrictEqual(tags(PagePage.update(model, PagePage.Message.ConfirmedDelete({ pageId: kept.id }))), [])
      assert.isNull(PagePage.update(model, PagePage.Message.ClickedDeleteForever({ pageId: 'not-in-trash' })).model.confirmDelete)
    }))

  it.effect('the question goes away when its page leaves the Trash', () =>
    Effect.gen(function* () {
      const { kept, model } = yield* trashModel
      const asked = PagePage.update(model, PagePage.Message.ClickedDeleteForever({ pageId: kept.id })).model
      const { me, page, crumbs, backlinks, comments, versions, isFavorite, isInTrash, nav, pages, people, now, rows, parentDatabase, related, databases } = asked
      const restored = PagePage.Message.GotPage({ me, page, crumbs, backlinks, comments, versions, isFavorite, isInTrash, nav, pages, people, now, rows, parentDatabase, related, databases, trash: asked.trash.filter(entry => entry.id !== kept.id) })
      assert.isNull(PagePage.update(asked, restored).model.confirmDelete)
      assert.strictEqual(PagePage.update(asked, PagePage.Message.GotPage({ me, page, crumbs, backlinks, comments, versions, isFavorite, isInTrash, nav, pages, people, now, rows, parentDatabase, related, databases, trash: asked.trash })).model.confirmDelete, kept.id)
    }))
})
