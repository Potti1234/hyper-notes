import { assert, describe, it } from '@effect/vitest'
import { Effect, Scope, Stream } from 'effect'

import * as PagePage from '@/app/page/page'
import { DEMO_MEMBERS, demoData } from '@/app/seed'
import { Viewers } from '@/app/store'

/* Presence: who has a page open is a scoped join on Viewers, and the page
   lists those people as avatars (everyone but you). */

const NOW = Date.UTC(2026, 10, 10, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!
const morgan = DEMO_MEMBERS.find(member => member.id === 'morgan')!

const model = () => {
  const data = demoData(NOW)
  const slice = PagePage.sliceOf({ version: 0, members: data.members, pages: data.pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }, 'demo-wiki', 'avery', NOW)
  return PagePage.init({ ...slice, me: avery, view: 'page', pageId: 'demo-wiki' }).model
}

describe('presence', () => {
  it.effect('a viewer is listed while joined and gone once their scope closes', () =>
    Effect.gen(function* () {
      const viewers = yield* Viewers
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      yield* viewers.join('demo-wiki', 'avery').pipe(Scope.provide(first))
      yield* viewers.join('demo-wiki', 'morgan').pipe(Scope.provide(second))
      yield* viewers.join('demo-wiki', 'morgan').pipe(Scope.provide(first))
      const now = () => viewers.of('demo-wiki').pipe(Stream.take(1), Stream.runCollect)
      assert.deepStrictEqual([...(yield* now())], [['avery', 'morgan']])
      yield* Scope.close(second, Effect.void.pipe(Effect.exit, Effect.runSync))
      assert.deepStrictEqual([...(yield* now())], [['avery', 'morgan']])
      yield* Scope.close(first, Effect.void.pipe(Effect.exit, Effect.runSync))
      assert.deepStrictEqual([...(yield* now())], [[]])
    }).pipe(Effect.provide(Viewers.layer)))

  it('the page starts offline with nobody listed, then follows the live list', () => {
    const start = model()
    assert.isFalse(start.isConnected)
    assert.deepStrictEqual(start.viewers, [])
    const online = PagePage.update(start, PagePage.Message.ChangedConnection({ isConnected: true }))
    const listed = PagePage.update(online.model, PagePage.Message.ChangedViewers({ viewers: [avery, morgan] }))
    assert.isTrue(listed.model.isConnected)
    assert.deepStrictEqual(listed.model.viewers.map(member => member.id), ['avery', 'morgan'])
    assert.deepStrictEqual(listed.commands ?? [], [])
  })
})
