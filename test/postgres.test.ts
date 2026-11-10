import { assert, describe, it } from '@effect/vitest'
import { Clock, Context, Effect, Layer, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { optionsOf } from '@/app/database'
import * as Postgres from '@/app/postgres'
import { DEMO_HOME, demoData } from '@/app/seed'
import { Workspace } from '@/app/store'
import { paragraph } from '@/app/editor/blocks'

/* The workspace in Postgres, against a throwaway database (`npm run test:pg`
   creates it). Two stores on one database stand for two app processes: a
   change one makes reaches the other through LISTEN/NOTIFY. Skipped without
   TEST_DATABASE_URL. */

const url = process.env['TEST_DATABASE_URL']

const reset = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`DROP TABLE IF EXISTS page_versions, comments, expanded, favorites, pages, members, workspace_meta CASCADE`
}).pipe(Effect.provide(Postgres.clientLayerFor(url ?? '')))

const store = Effect.map(Layer.build(Postgres.layer.pipe(Layer.provide(Postgres.clientLayerFor(url ?? '')))), context => Context.get(context, Workspace))

describe.skipIf(url === undefined)('workspace in Postgres', () => {
  it.live('stores pages with their documents and reaches the other process', () =>
    Effect.scoped(Effect.gen(function* () {
      yield* reset
      const one = yield* store
      const now = yield* Clock.currentTimeMillis
      assert.isTrue(yield* one.seedDemo(demoData(now)))
      assert.isFalse(yield* one.seedDemo(demoData(now)))
      const two = yield* store
      const before = yield* two.current
      assert.strictEqual(before.pages.length, demoData(now).pages.length)
      const home = before.pages.find(page => page.id === DEMO_HOME)!
      assert.deepStrictEqual(home.content, demoData(now).pages.find(page => page.id === DEMO_HOME)!.content)

      const child = yield* one.createPage({ parentId: DEMO_HOME, section: 'workspace', title: 'From one' }, 'avery')
      yield* one.updatePage(child.id, { content: [paragraph('p1', 'Saved in Postgres')], cover: { _tag: 'GalleryCover', name: 'gradient-1' }, font: 'serif' }, 'avery')
      yield* one.setFavorite(child.id, true, 'morgan')
      yield* one.setExpanded(DEMO_HOME, true, 'morgan')
      yield* one.setTheme('avery', true)
      const thread = yield* one.addComment({ pageId: child.id, threadId: null }, 'Stored comment', 'avery')
      yield* one.resolveThread(thread.id, true, 'morgan')
      const after = yield* two.changes.pipe(Stream.filter(state => state.pages.some(page => page.id === child.id && page.font === 'serif') && state.expanded.length > 0 && state.comments.some(comment => comment.pageId === child.id && comment.resolvedAt !== null) && state.members.some(member => member.id === 'avery' && member.isDark)), Stream.runHead, Effect.timeout('5 seconds'))
      const state = after._tag === 'Some' ? after.value : yield* two.current
      const stored = state.pages.find(page => page.id === child.id)!
      assert.strictEqual(stored.title, 'From one')
      assert.deepStrictEqual(stored.content, [paragraph('p1', 'Saved in Postgres')])
      assert.deepStrictEqual(stored.cover, { _tag: 'GalleryCover', name: 'gradient-1' })
      assert.isTrue(state.favorites.some(row => row.memberId === 'morgan' && row.pageId === child.id))
      assert.isTrue(state.members.find(member => member.id === 'avery')?.isDark)
      assert.deepStrictEqual(state.versions.filter(version => version.pageId === child.id).map(version => version.content), [[], [paragraph('p1', 'Saved in Postgres')]])
      assert.deepStrictEqual(state.comments.filter(comment => comment.pageId === child.id).map(comment => [comment.text, comment.resolvedBy]), [['Stored comment', 'morgan']])

      yield* two.trashPage(child.id, 'morgan')
      yield* two.deletePage(child.id, 'morgan')
      yield* one.changes.pipe(Stream.filter(entry => !entry.pages.some(page => page.id === child.id)), Stream.runHead, Effect.timeout('5 seconds'))
      const fresh = yield* store
      const reloaded = yield* fresh.current
      assert.isFalse(reloaded.pages.some(page => page.id === child.id))
      assert.isFalse(reloaded.favorites.some(row => row.pageId === child.id))
      assert.isFalse(reloaded.comments.some(comment => comment.pageId === child.id))
      assert.isFalse(reloaded.versions.some(version => version.pageId === child.id))
    })))

  it.live('stores databases and the values of their rows', () =>
    Effect.scoped(Effect.gen(function* () {
      yield* reset
      const one = yield* store
      yield* one.seedDemo(demoData(yield* Clock.currentTimeMillis))
      const tasks = yield* one.createPage({ parentId: null, section: 'workspace', title: 'Tasks' }, 'avery')
      const database = (yield* one.makeDatabase(tasks.id, 'board', 'avery')).database!
      const status = database.properties[0]!
      const done = optionsOf(status)[2]!
      const row = yield* one.addRow(tasks.id, { title: 'Ship it', values: { [status.id]: { _tag: 'OptionValue', optionId: done.id } }, beforeId: null }, 'avery')
      const tag = yield* one.changeDatabase(tasks.id, { _tag: 'AddOption', propertyId: database.properties[1]!.id, name: 'Launch' }, 'avery')
      yield* one.setValue(row.id, database.properties[1]!.id, { _tag: 'OptionsValue', optionIds: [tag!] }, 'avery')
      const fresh = yield* store
      const state = yield* fresh.current
      const stored = state.pages.find(page => page.id === tasks.id)!
      assert.deepStrictEqual(stored.database?.properties.map(property => property.name), ['Status', 'Tags'])
      assert.deepStrictEqual(stored.database?.views.map(view => [view.layout, view.groupBy]), [['board', status.id]])
      const storedRow = state.pages.find(page => page.id === row.id)!
      assert.deepStrictEqual(storedRow.values, { [status.id]: { _tag: 'OptionValue', optionId: done.id }, [database.properties[1]!.id]: { _tag: 'OptionsValue', optionIds: [tag!] } })
      assert.deepStrictEqual(state.pages.find(page => page.id === DEMO_HOME)?.values, {})
    })))

  it.live('clears demo content and keeps real pages', () =>
    Effect.scoped(Effect.gen(function* () {
      yield* reset
      const one = yield* store
      yield* one.seedDemo(demoData(yield* Clock.currentTimeMillis))
      const { member } = yield* one.addMember({ name: 'Real Person', email: 'real@hypernotes.example', password: 'a-long-password' })
      const real = yield* one.createPage({ parentId: null, section: 'workspace', title: 'Real' }, member.id)
      const removed = yield* one.clearDemo
      assert.isAbove(removed.pages, 0)
      const fresh = yield* store
      const state = yield* fresh.current
      assert.deepStrictEqual(state.pages.map(page => page.id), [real.id])
      assert.deepStrictEqual(state.members.map(entry => entry.id), [member.id])
      assert.isDefined(yield* fresh.authenticate('real@hypernotes.example', 'a-long-password'))
    })))
})
