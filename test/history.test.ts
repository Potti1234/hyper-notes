import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { MAX_VERSIONS, type Page, VERSION_WINDOW } from '@/app/domain'
import * as PagePage from '@/app/page/page'
import { DEMO_HOME, DEMO_MEMBERS, demoData } from '@/app/seed'
import { Workspace } from '@/app/store'
import { apply, initial } from '@/app/editor/state'
import { recordVersion } from '@/app/workspace'
import { workspaceLayer } from './support'

/* Page history: edits one person makes in a row share a version, someone
   else's (or later) edits start a new one; a version can be previewed and
   restored. */

const run = <A, E>(effect: Effect.Effect<A, E, Workspace>) => Effect.provide(effect, workspaceLayer())
const NOW = Date.UTC(2026, 10, 10, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!
const paragraph = (text: string) => [{ id: `b-${text}`, kind: { _tag: 'Paragraph' as const }, color: 'default' as const, text: [{ _tag: 'Text' as const, text, marks: { bold: false, italic: false, underline: false, strike: false, code: false, color: 'default' as const, link: null } }], children: [] }]

describe('history: recordVersion', () => {
  const page = demoData(NOW).pages.find(entry => entry.id === DEMO_HOME)!
  let next = 0
  const context = (at: number) => ({ at, id: (prefix: string) => `${prefix}-${++next}` })
  const edit = (before: Page, title: string, by: string, at: number): Page => ({ ...before, title, updatedBy: by, updatedAt: at })

  it('keeps the page before the first edit, merges one person in a row, splits on others and on time', () => {
    const one = edit(page, 'One', 'avery', NOW)
    let versions = recordVersion([], page, one, context(NOW))
    assert.deepStrictEqual(versions.map(version => version.title), [page.title, 'One'])
    const two = edit(one, 'Two', 'avery', NOW + 60_000)
    versions = recordVersion(versions, one, two, context(NOW + 60_000))
    assert.deepStrictEqual(versions.map(version => version.title), [page.title, 'Two'])
    const three = edit(two, 'Three', 'morgan', NOW + 120_000)
    versions = recordVersion(versions, two, three, context(NOW + 120_000))
    assert.deepStrictEqual(versions.map(version => [version.title, version.authorId]), [[page.title, page.updatedBy], ['Two', 'avery'], ['Three', 'morgan']])
    const later = NOW + 120_000 + VERSION_WINDOW
    versions = recordVersion(versions, three, edit(three, 'Four', 'morgan', later), context(later))
    assert.strictEqual(versions.length, 4)
    assert.strictEqual(recordVersion(versions, three, { ...three, isFullWidth: true }, context(later)), versions)
  })

  it(`keeps at most ${MAX_VERSIONS} versions of a page`, () => {
    let versions = recordVersion([], page, edit(page, 'v0', 'avery', NOW), context(NOW))
    let current = edit(page, 'v0', 'avery', NOW)
    for (let index = 1; index <= MAX_VERSIONS + 5; index += 1) {
      const at = NOW + index * VERSION_WINDOW
      const changed = edit(current, `v${index}`, 'avery', at)
      versions = recordVersion(versions, current, changed, context(at))
      current = changed
    }
    assert.strictEqual(versions.length, MAX_VERSIONS)
    assert.strictEqual(versions.at(-1)?.title, `v${MAX_VERSIONS + 5}`)
  })
})

describe('workspace: history', () => {
  it.effect('restores a version; refuses on locked pages and for pages one cannot see', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const page = yield* workspace.createPage({ parentId: null, section: 'workspace', title: 'Draft' }, 'avery')
      yield* workspace.updatePage(page.id, { content: paragraph('first') }, 'avery')
      yield* workspace.updatePage(page.id, { title: 'Final', content: paragraph('second') }, 'morgan')
      const versions = (yield* workspace.current).versions.filter(version => version.pageId === page.id)
      assert.deepStrictEqual(versions.map(version => version.title), ['Draft', 'Draft', 'Final'])
      const first = versions[1]!
      assert.isNotNull(yield* workspace.version(first.id, 'riley'))
      const restored = yield* workspace.restoreVersion(first.id, 'riley')
      assert.strictEqual(restored.title, 'Draft')
      assert.deepStrictEqual(restored.content, first.content)
      assert.strictEqual((yield* workspace.current).versions.filter(version => version.pageId === page.id).length, 4)
      yield* workspace.updatePage(page.id, { isLocked: true }, 'avery')
      assert.strictEqual((yield* Effect.flip(workspace.restoreVersion(first.id, 'avery'))).reason, 'This page is locked.')
      const secret = yield* workspace.createPage({ parentId: null, section: 'private', title: 'Mine' }, 'avery')
      yield* workspace.updatePage(secret.id, { title: 'Still mine' }, 'avery')
      const hidden = (yield* workspace.current).versions.find(version => version.pageId === secret.id)!
      assert.isNull(yield* workspace.version(hidden.id, 'morgan'))
      assert.strictEqual((yield* Effect.flip(workspace.restoreVersion(hidden.id, 'morgan'))).reason, 'That page does not exist.')
      yield* workspace.trashPage(secret.id, 'avery')
      yield* workspace.deletePage(secret.id, 'avery')
      assert.isFalse((yield* workspace.current).versions.some(version => version.pageId === secret.id))
    })))
})

describe('page: history', () => {
  const versions: ReadonlyArray<PagePage.VersionEntry> = [
    { id: 'v1', authorId: 'avery', author: avery, startedAt: NOW - 7_200_000, at: NOW - 7_200_000, title: 'Old' },
    { id: 'v2', authorId: 'avery', author: avery, startedAt: NOW - 60_000, at: NOW, title: 'New' },
  ]
  const model = (): PagePage.Model => {
    const data = demoData(NOW)
    const slice = PagePage.sliceOf({ version: 0, members: data.members, pages: data.pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }, DEMO_HOME, 'avery', NOW)
    return { ...PagePage.init({ ...slice, me: avery, view: 'page', pageId: DEMO_HOME }).model, versions }
  }
  const tags = (result: ReturnType<typeof PagePage.update>) => (result.commands ?? []).map(command => command.name)
  const preview = (versionId: string): PagePage.VersionPreview => ({ versionId, title: 'Old', icon: '', content: [] })

  it('opens from the ••• menu on the latest version, focused, and loads it', () => {
    const options = PagePage.update(model(), PagePage.Message.ClickedPageOptions()).model
    const opened = PagePage.update(options, PagePage.Message.ChosePicker({ value: 'history' }))
    assert.deepStrictEqual(opened.model.history, { selectedId: 'v2', preview: null })
    assert.isNull(opened.model.picker)
    assert.deepStrictEqual(tags(opened), ['LoadVersion', 'FocusElement'])
  })

  it('shows the version it loaded only while that version is picked', () => {
    const opened = PagePage.update(model(), PagePage.Message.ClickedHistory()).model
    const picked = PagePage.update(opened, PagePage.Message.ClickedVersion({ versionId: 'v1' }))
    assert.deepStrictEqual(tags(picked), ['LoadVersion'])
    assert.isNull(PagePage.update(picked.model, PagePage.Message.GotVersion({ preview: preview('v2') })).model.history?.preview ?? null)
    assert.deepStrictEqual(PagePage.update(picked.model, PagePage.Message.GotVersion({ preview: preview('v1') })).model.history?.preview, preview('v1'))
    assert.deepStrictEqual(PagePage.update(picked.model, PagePage.Message.MissedVersion({ versionId: 'v1' })).model.history, { selectedId: null, preview: null })
    assert.deepStrictEqual(tags(PagePage.update(opened, PagePage.Message.ClickedVersion({ versionId: 'nope' }))), [])
  })

  it('restores and closes; not on locked pages; Esc closes', () => {
    const opened = PagePage.update(model(), PagePage.Message.ClickedHistory()).model
    const restored = PagePage.update(opened, PagePage.Message.ClickedRestoreVersion({ versionId: 'v1' }))
    assert.isNull(restored.model.history)
    assert.deepStrictEqual(tags(restored), ['RestoreVersion'])
    const locked = { ...opened, page: { ...opened.page!, isLocked: true } }
    assert.deepStrictEqual(tags(PagePage.update(locked, PagePage.Message.ClickedRestoreVersion({ versionId: 'v1' }))), [])
    assert.isNull(PagePage.update(opened, PagePage.Message.ClickedCloseHistory()).model.history)
  })

  it('opens empty without versions and closes when the page goes to Trash', () => {
    const empty = PagePage.update({ ...model(), versions: [] }, PagePage.Message.ClickedHistory())
    assert.deepStrictEqual(empty.model.history, { selectedId: null, preview: null })
    assert.isNull(PagePage.update({ ...model(), isInTrash: true }, PagePage.Message.ClickedHistory()).model.history)
  })
})

describe('editor: a restored empty page', () => {
  it('gets one empty block to type in', () => {
    const state = apply(initial(paragraph('kept'), 'p-'), { _tag: 'ReplaceDocument', doc: [] })
    assert.deepStrictEqual(state.doc.map(block => [block.kind._tag, block.text.length]), [['Paragraph', 0]])
  })
})
