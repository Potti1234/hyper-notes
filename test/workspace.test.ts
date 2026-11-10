import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { DEMO_HOME } from '@/app/seed'
import { Workspace } from '@/app/store'
import { block, paragraph } from '@/app/editor/blocks'
import { ancestorsOf, isTrashed, subtreeOf } from '@/app/workspace'
import { workspaceLayer } from './support'

/* Pages in the shared workspace: create, nest, move, duplicate, trash,
   restore, delete, favorites and the sidebar's open rows. */

const run = <A, E>(effect: Effect.Effect<A, E, Workspace>) => Effect.provide(effect, workspaceLayer())

describe('workspace: pages', () => {
  it.effect('creates nested pages at the end of their parent', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const one = yield* workspace.createPage({ parentId: DEMO_HOME, section: 'workspace' }, 'avery')
      const two = yield* workspace.createPage({ parentId: DEMO_HOME, section: 'workspace', title: 'Second' }, 'avery')
      const state = yield* workspace.current
      assert.isAbove(two.position, one.position)
      assert.strictEqual(one.title, '')
      assert.deepStrictEqual(ancestorsOf(state.pages, two).map(page => page.id), [DEMO_HOME])
    })))

  it.effect('keeps private pages to their owner and moves them into the workspace', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const page = yield* workspace.createPage({ parentId: null, section: 'private', title: 'Mine' }, 'morgan')
      assert.strictEqual(page.ownerId, 'morgan')
      const intoPrivate = yield* Effect.flip(workspace.createPage({ parentId: page.id, section: 'private' }, 'riley'))
      assert.strictEqual(intoPrivate._tag, 'InvalidChange')
      const moved = yield* workspace.movePage(page.id, { parentId: null, section: 'workspace', beforeId: null }, 'morgan')
      assert.strictEqual(moved.section, 'workspace')
      const inside = yield* workspace.createPage({ parentId: page.id, section: 'private' }, 'riley')
      assert.strictEqual(inside.section, 'workspace')
    })))

  it.effect('refuses to move a page into its own subtree', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const child = yield* workspace.createPage({ parentId: DEMO_HOME, section: 'workspace' }, 'avery')
      const error = yield* Effect.flip(workspace.movePage(DEMO_HOME, { parentId: child.id, section: 'workspace', beforeId: null }, 'avery'))
      assert.strictEqual(error._tag, 'InvalidChange')
    })))

  it.effect('duplicates a page with its sub-pages and fresh block ids', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const before = yield* workspace.current
      const original = before.pages.find(page => page.id === DEMO_HOME)!
      const copy = yield* workspace.duplicatePage(DEMO_HOME, 'avery')
      const after = yield* workspace.current
      assert.notStrictEqual(copy.id, DEMO_HOME)
      assert.strictEqual(copy.content.length, original.content.length)
      assert.notStrictEqual(copy.content[0]?.id, original.content[0]?.id)
      assert.strictEqual(subtreeOf(after.pages, copy.id).length, subtreeOf(before.pages, DEMO_HOME).length)
    })))

  it.effect('trashes a subtree, restores it, and deletes it for good', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const child = yield* workspace.createPage({ parentId: DEMO_HOME, section: 'workspace' }, 'avery')
      yield* workspace.trashPage(DEMO_HOME, 'avery')
      let state = yield* workspace.current
      assert.isTrue(isTrashed(state.pages, state.pages.find(page => page.id === child.id)!))
      const locked = yield* Effect.flip(workspace.updatePage(child.id, { title: 'x' }, 'avery'))
      assert.strictEqual(locked._tag, 'InvalidChange')
      yield* workspace.restorePage(DEMO_HOME, 'avery')
      state = yield* workspace.current
      assert.isFalse(isTrashed(state.pages, state.pages.find(page => page.id === child.id)!))
      yield* workspace.trashPage(DEMO_HOME, 'avery')
      const removed = yield* workspace.deletePage(DEMO_HOME, 'avery')
      state = yield* workspace.current
      assert.isAtLeast(removed, 2)
      assert.isFalse(state.pages.some(page => page.id === child.id || page.id === DEMO_HOME))
      assert.isFalse(state.favorites.some(row => row.pageId === DEMO_HOME))
    })))

  it.effect('validates content through the block schema and keeps untouched pages', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const before = yield* workspace.current
      const content = [paragraph('b1', 'Hello'), block('b2', { _tag: 'Divider' })]
      const page = yield* workspace.updatePage(DEMO_HOME, { content }, 'morgan')
      const after = yield* workspace.current
      assert.strictEqual(page.updatedBy, 'morgan')
      assert.deepStrictEqual(page.content, content)
      after.pages.forEach(entry => {
        if (entry.id !== DEMO_HOME) assert.strictEqual(entry, before.pages.find(other => other.id === entry.id))
      })
      const bad = yield* Effect.flip(workspace.updatePage(DEMO_HOME, { content: [{ id: 'x', kind: { _tag: 'Nope' } }] as never }, 'avery'))
      assert.strictEqual(bad._tag, 'InvalidChange')
      const javascript = yield* Effect.flip(workspace.updatePage(DEMO_HOME, { content: [block('i1', { _tag: 'Image', url: 'javascript:alert(1)', width: null })] }, 'avery'))
      assert.strictEqual(javascript._tag, 'InvalidChange')
    })))

  it.effect('locks a page against edits but not against unlocking', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      yield* workspace.updatePage(DEMO_HOME, { isLocked: true }, 'avery')
      const error = yield* Effect.flip(workspace.updatePage(DEMO_HOME, { title: 'Changed' }, 'avery'))
      assert.strictEqual(error._tag, 'InvalidChange')
      const unlocked = yield* workspace.updatePage(DEMO_HOME, { isLocked: false }, 'avery')
      assert.isFalse(unlocked.isLocked)
    })))

  it.effect('stores favorites and open rows per member', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      yield* workspace.setFavorite(DEMO_HOME, true, 'morgan')
      yield* workspace.setFavorite(DEMO_HOME, true, 'morgan')
      yield* workspace.setExpanded(DEMO_HOME, true, 'morgan')
      let state = yield* workspace.current
      assert.strictEqual(state.favorites.filter(row => row.memberId === 'morgan').length, 1)
      assert.isTrue(state.expanded.some(row => row.memberId === 'morgan' && row.pageId === DEMO_HOME))
      yield* workspace.setFavorite(DEMO_HOME, false, 'morgan')
      yield* workspace.setExpanded(DEMO_HOME, false, 'morgan')
      state = yield* workspace.current
      assert.isFalse(state.favorites.some(row => row.memberId === 'morgan'))
      assert.isFalse(state.expanded.some(row => row.memberId === 'morgan' && row.pageId === DEMO_HOME))
    })))
})
