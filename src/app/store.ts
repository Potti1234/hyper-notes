import { randomUUID } from 'node:crypto'

import { Clock, Context, Effect, Layer, type Scope, Semaphore, Stream, SubscriptionRef } from 'effect'

import type { DatabaseChange, Layout, Value } from './database'
import type { Comment, Member, Page, PageVersion, Section } from './domain'
import { hashPassword, verifyPassword } from './password'
import {
  type CommentAnchor,
  type DemoCounts,
  type InvalidChange,
  type NewPage,
  type Op,
  type PagePatch,
  type WorkspaceData,
  addComment,
  addDemo,
  addMember,
  canSee,
  clearDemo,
  createPage,
  deleteComment,
  deletePage,
  duplicatePage,
  editComment,
  movePage,
  resolveThread,
  restorePage,
  restoreVersion,
  setExpanded,
  setFavorite,
  setPreset,
  setSidebar,
  setTheme,
  trashPage,
  updatePage,
  makeDatabase,
  changeDatabase,
  setValue,
  addRow,
} from './workspace'

export { InvalidChange } from './workspace'

/* The workspace: everyone's shared, live state, with a change feed
   (`changes` emits the current state at once, then every new one); pages
   subscribe to it. A backend holds the data and runs the operations of
   `workspace.ts` one at a time: in memory for tests (`memoryLayer`), in
   Postgres for the app (`postgres.ts`). */

export type WorkspaceState = Readonly<{
  /** Increases with every change. */
  version: number
  members: WorkspaceData['members']
  pages: WorkspaceData['pages']
  favorites: WorkspaceData['favorites']
  expanded: WorkspaceData['expanded']
  comments: WorkspaceData['comments']
  versions: WorkspaceData['versions']
}>

/** The data at one version, and the state pages see (without passwords). */
export type Snapshot = Readonly<{ version: number; data: WorkspaceData; state: WorkspaceState }>

export const snapshotOf = (version: number, data: WorkspaceData): Snapshot => ({
  version,
  data,
  state: { version, members: data.members, pages: data.pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions },
})

export type Backend = Readonly<{
  current: Effect.Effect<Snapshot>
  changes: Stream.Stream<Snapshot>
  /** Runs an operation atomically and makes its result the new state. */
  run: <A, E>(op: Op<A, E>) => Effect.Effect<A, E>
}>

export type NewAccount = Readonly<{ name: string; email: string; password: string }>

export class Workspace extends Context.Service<
  Workspace,
  {
    readonly current: Effect.Effect<WorkspaceState>
    readonly changes: Stream.Stream<WorkspaceState>
    readonly member: (id: string) => Effect.Effect<Member | undefined>
    /** The member with this email and password. */
    readonly authenticate: (email: string, password: string) => Effect.Effect<Member | undefined>
    readonly addMember: (input: NewAccount) => Effect.Effect<Readonly<{ member: Member; isNew: boolean }>, InvalidChange>
    readonly setTheme: (memberId: string, isDark: boolean) => Effect.Effect<void>
    readonly setSidebar: (memberId: string, change: Readonly<{ width?: number; isCollapsed?: boolean }>) => Effect.Effect<void>
    readonly setPreset: (memberId: string, theme: string) => Effect.Effect<void>
    readonly createPage: (input: NewPage, actorId: string) => Effect.Effect<Page, InvalidChange>
    readonly updatePage: (pageId: string, patch: PagePatch, actorId: string) => Effect.Effect<Page, InvalidChange>
    readonly makeDatabase: (pageId: string, layout: Layout, actorId: string) => Effect.Effect<Page, InvalidChange>
    readonly changeDatabase: (pageId: string, change: DatabaseChange, actorId: string) => Effect.Effect<string | null, InvalidChange>
    readonly setValue: (rowId: string, propertyId: string, value: Value | null, actorId: string) => Effect.Effect<Page, InvalidChange>
    readonly addRow: (databaseId: string, input: Readonly<{ title: string; values: Page['values']; beforeId: string | null }>, actorId: string) => Effect.Effect<Page, InvalidChange>
    readonly movePage: (pageId: string, target: Readonly<{ parentId: string | null; section: Section; beforeId: string | null }>, actorId: string) => Effect.Effect<Page, InvalidChange>
    readonly duplicatePage: (pageId: string, actorId: string) => Effect.Effect<Page, InvalidChange>
    readonly trashPage: (pageId: string, actorId: string) => Effect.Effect<Page, InvalidChange>
    readonly restorePage: (pageId: string, actorId: string) => Effect.Effect<Page, InvalidChange>
    readonly deletePage: (pageId: string, actorId: string) => Effect.Effect<number, InvalidChange>
    readonly setFavorite: (pageId: string, isFavorite: boolean, actorId: string) => Effect.Effect<void, InvalidChange>
    readonly setExpanded: (pageId: string, isExpanded: boolean, actorId: string) => Effect.Effect<void>
    readonly addComment: (target: Readonly<{ pageId: string; threadId: string | null; anchor?: CommentAnchor | null }>, text: string, actorId: string) => Effect.Effect<Comment, InvalidChange>
    readonly editComment: (commentId: string, text: string, actorId: string) => Effect.Effect<Comment, InvalidChange>
    readonly deleteComment: (commentId: string, actorId: string) => Effect.Effect<number, InvalidChange>
    readonly restoreVersion: (versionId: string, actorId: string) => Effect.Effect<Page, InvalidChange>
    readonly version: (versionId: string, actorId: string) => Effect.Effect<PageVersion | null>
    readonly resolveThread: (threadId: string, isResolved: boolean, actorId: string) => Effect.Effect<Comment, InvalidChange>
    /** Adds the demo content (false: it is there already). */
    readonly seedDemo: (demo: WorkspaceData) => Effect.Effect<boolean>
    readonly clearDemo: Effect.Effect<DemoCounts>
  }
>()('hypernotes/Workspace') {}

const traced = <A, E>(backend: Backend, name: string, op: Op<A, E>): Effect.Effect<A, E> => backend.run(op).pipe(Effect.withSpan(`Workspace.${name}`))

export const fromBackend = (backend: Backend): Workspace['Service'] => ({
  current: Effect.map(backend.current, snapshot => snapshot.state),
  changes: Stream.map(backend.changes, snapshot => snapshot.state),
  member: id => Effect.map(backend.current, ({ data }) => data.members.find(member => member.id === id)),
  authenticate: (email, password) =>
    Effect.gen(function* () {
      const { data } = yield* backend.current
      const member = data.members.find(candidate => candidate.email === email.trim().toLowerCase())
      // Unknown emails are checked against a dummy hash: the same time either way.
      const matches = yield* verifyPassword(password, member === undefined ? undefined : data.passwords[member.id])
      return matches ? member : undefined
    }),
  addMember: input =>
    Effect.gen(function* () {
      const { data } = yield* backend.current
      const email = input.email.trim().toLowerCase()
      const isKnown = data.members.some(member => member.email === email)
      const passwordHash = isKnown ? null : yield* hashPassword(input.password)
      return yield* traced(backend, 'addMember', addMember({ name: input.name, email, passwordHash }))
    }),
  setTheme: (memberId, isDark) => traced(backend, 'setTheme', setTheme(memberId, isDark)),
  setSidebar: (memberId, change) => traced(backend, 'setSidebar', setSidebar(memberId, change)),
  setPreset: (memberId, theme) => traced(backend, 'setPreset', setPreset(memberId, theme)),
  createPage: (input, actorId) => traced(backend, 'createPage', createPage(input, actorId)),
  updatePage: (pageId, patch, actorId) => traced(backend, 'updatePage', updatePage(pageId, patch, actorId)),
  makeDatabase: (pageId, layout, actorId) => traced(backend, 'makeDatabase', makeDatabase(pageId, layout, actorId)),
  changeDatabase: (pageId, change, actorId) => traced(backend, 'changeDatabase', changeDatabase(pageId, change, actorId)),
  setValue: (rowId, propertyId, value, actorId) => traced(backend, 'setValue', setValue(rowId, propertyId, value, actorId)),
  addRow: (databaseId, input, actorId) => traced(backend, 'addRow', addRow(databaseId, input, actorId)),
  movePage: (pageId, target, actorId) => traced(backend, 'movePage', movePage(pageId, target, actorId)),
  duplicatePage: (pageId, actorId) => traced(backend, 'duplicatePage', duplicatePage(pageId, actorId)),
  trashPage: (pageId, actorId) => traced(backend, 'trashPage', trashPage(pageId, actorId)),
  restorePage: (pageId, actorId) => traced(backend, 'restorePage', restorePage(pageId, actorId)),
  deletePage: (pageId, actorId) => traced(backend, 'deletePage', deletePage(pageId, actorId)),
  setFavorite: (pageId, isFavorite, actorId) => traced(backend, 'setFavorite', setFavorite(pageId, isFavorite, actorId)),
  setExpanded: (pageId, isExpanded, actorId) => traced(backend, 'setExpanded', setExpanded(pageId, isExpanded, actorId)),
  addComment: (target, text, actorId) => traced(backend, 'addComment', addComment(target, text, actorId)),
  editComment: (commentId, text, actorId) => traced(backend, 'editComment', editComment(commentId, text, actorId)),
  deleteComment: (commentId, actorId) => traced(backend, 'deleteComment', deleteComment(commentId, actorId)),
  restoreVersion: (versionId, actorId) => traced(backend, 'restoreVersion', restoreVersion(versionId, actorId)),
  version: (versionId, actorId) => Effect.map(backend.current, ({ data }) => {
    const found = data.versions.find(entry => entry.id === versionId)
    const page = found === undefined ? undefined : data.pages.find(entry => entry.id === found.pageId)
    return found !== undefined && page !== undefined && canSee(page, actorId) ? found : null
  }),
  resolveThread: (threadId, isResolved, actorId) => traced(backend, 'resolveThread', resolveThread(threadId, isResolved, actorId)),
  seedDemo: demo => traced(backend, 'seedDemo', addDemo(demo)),
  clearDemo: traced(backend, 'clearDemo', clearDemo()),
})

/** Ids that are unique across processes and restarts. */
export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`

export const memoryBackend = (initial: WorkspaceData): Effect.Effect<Backend> =>
  Effect.gen(function* () {
    const ref = yield* SubscriptionRef.make(snapshotOf(1, initial))
    const lock = yield* Semaphore.make(1)
    return {
      current: SubscriptionRef.get(ref),
      changes: SubscriptionRef.changes(ref),
      run: op =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const at = yield* Clock.currentTimeMillis
            const snapshot = yield* SubscriptionRef.get(ref)
            const [result, next] = yield* op(snapshot.data, { at, id: newId })
            if (next !== snapshot.data) yield* SubscriptionRef.set(ref, snapshotOf(snapshot.version + 1, next))
            return result
          }),
        ),
    }
  })

/** The workspace in this process's memory, starting from `initial`. */
export const memoryLayer = (initial: Effect.Effect<WorkspaceData>) =>
  Layer.effect(Workspace, Effect.flatMap(initial, memoryBackend).pipe(Effect.map(fromBackend)))

/** Who has which page open. Joining is a scoped resource: a viewer is listed
 *  exactly as long as their page's live connection is open. */
export class Viewers extends Context.Service<
  Viewers,
  {
    readonly join: (pageId: string, memberId: string) => Effect.Effect<void, never, Scope.Scope>
    /** Member ids viewing the page, at once and on every change. */
    readonly of: (pageId: string) => Stream.Stream<ReadonlyArray<string>>
  }
>()('hypernotes/Viewers') {
  static readonly layer = Layer.effect(
    Viewers,
    Effect.gen(function* () {
      type Entry = Readonly<{ key: number; pageId: string; memberId: string }>
      const entries = yield* SubscriptionRef.make<ReadonlyArray<Entry>>([])
      let nextKey = 1
      return {
        join: (pageId, memberId) =>
          Effect.acquireRelease(
            Effect.sync(() => nextKey++).pipe(Effect.tap(key => SubscriptionRef.update(entries, list => [...list, { key, pageId, memberId }]))),
            key => SubscriptionRef.update(entries, list => list.filter(entry => entry.key !== key)),
          ).pipe(Effect.asVoid),
        of: pageId =>
          SubscriptionRef.changes(entries).pipe(
            Stream.map(list => [...new Set(list.filter(entry => entry.pageId === pageId).map(entry => entry.memberId))].sort()),
            Stream.changesWith((a, b) => a.length === b.length && a.every((value, index) => value === b[index])),
          ),
      }
    }),
  )
}
