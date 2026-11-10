import { randomUUID } from 'node:crypto'

import { PgClient } from '@effect/sql-pg'
import { Array as Arr, Clock, Effect, Layer, Queue, Redacted, Schema as S, type Scope, Semaphore, SubscriptionRef } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type Comment, Cover, type Member, type Page, type PageVersion } from './domain'
import { Database, Values } from './database'
import { Document } from './editor/schema'
import { type Backend, type Snapshot, Workspace, fromBackend, newId, snapshotOf } from './store'
import type { WorkspaceData } from './workspace'

/* The workspace in Postgres.

   - Each process keeps the whole workspace in memory (pages read it there)
     and runs operations under an advisory lock, in a transaction that first
     catches up with commits from other processes (a full load when the
     version moved), then writes only the rows that changed (by reference:
     an operation keeps untouched items as the same objects).
   - Commits NOTIFY the other processes, which then load the new version.
   - Startup listens before it reads, so no commit falls into a gap. */

const CHANNEL = 'hypernotes_changes'
const LOCK = 7411

const DEFAULT_URL = 'postgres://hypernotes:hypernotes-dev@localhost:5436/hypernotes'

export const clientLayerFor = (url: string) => PgClient.layer({ url: Redacted.make(url) })
export const clientLayer = clientLayerFor(process.env['DATABASE_URL'] ?? DEFAULT_URL)

type Sql = SqlClient.SqlClient

const migrate = (sql: Sql) =>
  sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SELECT pg_advisory_xact_lock(${LOCK})`
      yield* sql`CREATE TABLE IF NOT EXISTS workspace_meta (id INTEGER PRIMARY KEY, version BIGINT NOT NULL)`
      yield* sql`INSERT INTO workspace_meta (id, version) VALUES (1, 1) ON CONFLICT (id) DO NOTHING`
      yield* sql`
        CREATE TABLE IF NOT EXISTS members (
          seq BIGSERIAL, id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
          color TEXT NOT NULL, is_dark BOOLEAN NOT NULL DEFAULT FALSE, theme TEXT NOT NULL DEFAULT '', is_demo BOOLEAN NOT NULL DEFAULT FALSE
        )`
      yield* sql`
        CREATE TABLE IF NOT EXISTS pages (
          seq BIGSERIAL, id TEXT PRIMARY KEY, parent_id TEXT, section TEXT NOT NULL, owner_id TEXT NOT NULL, position DOUBLE PRECISION NOT NULL,
          title TEXT NOT NULL, icon TEXT NOT NULL, cover JSONB NOT NULL, cover_position DOUBLE PRECISION NOT NULL, font TEXT NOT NULL,
          is_small_text BOOLEAN NOT NULL, is_full_width BOOLEAN NOT NULL, is_locked BOOLEAN NOT NULL, content JSONB NOT NULL,
          created_by TEXT NOT NULL, created_at BIGINT NOT NULL, updated_by TEXT NOT NULL, updated_at BIGINT NOT NULL,
          trashed_at BIGINT, trashed_by TEXT, is_demo BOOLEAN NOT NULL DEFAULT FALSE
        )`
      yield* sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS database JSONB`
      yield* sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS row_values JSONB NOT NULL DEFAULT '{}'`
      yield* sql`CREATE TABLE IF NOT EXISTS favorites (member_id TEXT NOT NULL, page_id TEXT NOT NULL, position DOUBLE PRECISION NOT NULL, PRIMARY KEY (member_id, page_id))`
      yield* sql`
        CREATE TABLE IF NOT EXISTS comments (
          seq BIGSERIAL, id TEXT PRIMARY KEY, page_id TEXT NOT NULL, thread_id TEXT NOT NULL, author_id TEXT NOT NULL, text TEXT NOT NULL,
          created_at BIGINT NOT NULL, edited_at BIGINT, resolved_at BIGINT, resolved_by TEXT, is_demo BOOLEAN NOT NULL DEFAULT FALSE
        )`
      yield* sql`
        CREATE TABLE IF NOT EXISTS page_versions (
          seq BIGSERIAL, id TEXT PRIMARY KEY, page_id TEXT NOT NULL, author_id TEXT NOT NULL, started_at BIGINT NOT NULL, at BIGINT NOT NULL,
          title TEXT NOT NULL, icon TEXT NOT NULL, content JSONB NOT NULL, is_demo BOOLEAN NOT NULL DEFAULT FALSE
        )`
      yield* sql`CREATE TABLE IF NOT EXISTS expanded (member_id TEXT NOT NULL, page_id TEXT NOT NULL, PRIMARY KEY (member_id, page_id))`
    }),
  )

// ROWS

type Row = Record<string, string | number | boolean | null>
type Table<A> = Readonly<{ name: string; keys: ReadonlyArray<string>; items: (data: WorkspaceData) => ReadonlyArray<A>; row: (item: A, data: WorkspaceData) => Row }>

const memberRow = (member: Member, data: WorkspaceData): Row => ({
  id: member.id, name: member.name, email: member.email, password_hash: data.passwords[member.id] ?? '', color: member.color,
  is_dark: member.isDark, theme: member.theme, is_demo: member.isDemo,
})

const pageRow = (page: Page): Row => ({
  id: page.id, parent_id: page.parentId, section: page.section, owner_id: page.ownerId, position: page.position, title: page.title, icon: page.icon,
  cover: JSON.stringify(page.cover), cover_position: page.coverPosition, font: page.font, is_small_text: page.isSmallText, is_full_width: page.isFullWidth,
  is_locked: page.isLocked, content: JSON.stringify(page.content), database: page.database === null ? null : JSON.stringify(page.database), row_values: JSON.stringify(page.values), created_by: page.createdBy, created_at: page.createdAt, updated_by: page.updatedBy,
  updated_at: page.updatedAt, trashed_at: page.trashedAt, trashed_by: page.trashedBy, is_demo: page.isDemo,
})

/** Rows to write and to delete: items compared by reference (members also
 *  by password, which lives beside them). */
const changes = <A>(table: Table<A>, before: WorkspaceData, after: WorkspaceData) => {
  const key = (row: Row) => table.keys.map(name => String(row[name])).join('\u0000')
  const old = new Map(table.items(before).map(item => [key(table.row(item, before)), item]))
  const next = table.items(after).map(item => ({ item, row: table.row(item, after) }))
  const kept = new Set(next.map(({ row }) => key(row)))
  return {
    upserts: next.filter(({ item, row }) => old.get(key(row)) !== item || (table.name === 'members' && before.passwords !== after.passwords && JSON.stringify(row) !== JSON.stringify(table.row(item, before)))).map(({ row }) => row),
    removed: table.items(before).map(item => table.row(item, before)).filter(row => !kept.has(key(row))),
  }
}

const MEMBERS: Table<Member> = { name: 'members', keys: ['id'], items: data => data.members, row: memberRow }
const PAGES: Table<Page> = { name: 'pages', keys: ['id'], items: data => data.pages, row: pageRow }
const FAVORITES: Table<WorkspaceData['favorites'][number]> = { name: 'favorites', keys: ['member_id', 'page_id'], items: data => data.favorites, row: row => ({ member_id: row.memberId, page_id: row.pageId, position: row.position }) }
const EXPANDED: Table<WorkspaceData['expanded'][number]> = { name: 'expanded', keys: ['member_id', 'page_id'], items: data => data.expanded, row: row => ({ member_id: row.memberId, page_id: row.pageId }) }

const COMMENTS: Table<Comment> = { name: 'comments', keys: ['id'], items: data => data.comments, row: comment => ({
  id: comment.id, page_id: comment.pageId, thread_id: comment.threadId, author_id: comment.authorId, text: comment.text, created_at: comment.createdAt,
  edited_at: comment.editedAt, resolved_at: comment.resolvedAt, resolved_by: comment.resolvedBy, is_demo: comment.isDemo,
}) }

const VERSIONS: Table<PageVersion> = { name: 'page_versions', keys: ['id'], items: data => data.versions, row: version => ({
  id: version.id, page_id: version.pageId, author_id: version.authorId, started_at: version.startedAt, at: version.at, title: version.title, icon: version.icon,
  content: JSON.stringify(version.content), is_demo: version.isDemo,
}) }

const CHUNK = 200

const persist = (sql: Sql, before: WorkspaceData, after: WorkspaceData) =>
  Effect.gen(function* () {
    const all = [
      { table: MEMBERS, ...(before.members === after.members && before.passwords === after.passwords ? { upserts: [], removed: [] } : changes(MEMBERS, before, after)) },
      { table: PAGES, ...(before.pages === after.pages ? { upserts: [], removed: [] } : changes(PAGES, before, after)) },
      { table: FAVORITES, ...(before.favorites === after.favorites ? { upserts: [], removed: [] } : changes(FAVORITES, before, after)) },
      { table: EXPANDED, ...(before.expanded === after.expanded ? { upserts: [], removed: [] } : changes(EXPANDED, before, after)) },
      { table: VERSIONS, ...(before.versions === after.versions ? { upserts: [], removed: [] } : changes(VERSIONS, before, after)) },
      { table: COMMENTS, ...(before.comments === after.comments ? { upserts: [], removed: [] } : changes(COMMENTS, before, after)) },
    ]
    for (const { table, upserts } of all) {
      const columns = Object.keys(upserts[0] ?? {}).filter(column => !table.keys.includes(column))
      for (let start = 0; start < upserts.length; start += CHUNK) {
        const chunk = upserts.slice(start, start + CHUNK)
        if (!Arr.isArrayNonEmpty(chunk)) continue
        yield* columns.length === 0
          ? sql`INSERT INTO ${sql(table.name)} ${sql.insert(chunk)} ON CONFLICT DO NOTHING`
          : sql`INSERT INTO ${sql(table.name)} ${sql.insert(chunk)}
              ON CONFLICT (${sql.literal(table.keys.join(', '))})
              DO UPDATE SET ${sql.literal(columns.map(column => `${column} = EXCLUDED.${column}`).join(', '))}`
      }
    }
    for (const { table, removed } of [...all].reverse()) {
      for (const row of removed) yield* sql`DELETE FROM ${sql(table.name)} WHERE ${sql.and(table.keys.map(key => sql`${sql(key)} = ${row[key] ?? null}`))}`
    }
  })

const decodeCover = S.decodeUnknownSync(Cover)
const decodeDocument = S.decodeUnknownSync(Document)
const decodeDatabase = S.decodeUnknownSync(Database)
const decodeValues = S.decodeUnknownSync(Values)
const json = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value)

const load = (sql: Sql): Effect.Effect<Snapshot, SqlError.SqlError> =>
  Effect.gen(function* () {
    const [meta] = yield* sql<{ version: string }>`SELECT version FROM workspace_meta WHERE id = 1`
    const members = yield* sql<Record<string, unknown>>`SELECT * FROM members ORDER BY seq`
    const pages = yield* sql<Record<string, unknown>>`SELECT * FROM pages ORDER BY seq`
    const favorites = yield* sql<Record<string, unknown>>`SELECT * FROM favorites`
    const expanded = yield* sql<Record<string, unknown>>`SELECT * FROM expanded`
    const comments = yield* sql<Record<string, unknown>>`SELECT * FROM comments ORDER BY seq`
    const versions = yield* sql<Record<string, unknown>>`SELECT * FROM page_versions ORDER BY seq`
    const orNull = (value: unknown): number | null => (value == null ? null : Number(value))
    const data: WorkspaceData = {
      members: members.map((row): Member => ({
        id: String(row['id']), name: String(row['name']), email: String(row['email']), color: String(row['color']),
        isDark: row['is_dark'] === true, theme: String(row['theme']), isDemo: row['is_demo'] === true,
      })),
      pages: pages.map((row): Page => ({
        id: String(row['id']),
        parentId: row['parent_id'] == null ? null : String(row['parent_id']),
        section: row['section'] === 'private' ? 'private' : 'workspace',
        ownerId: String(row['owner_id']),
        position: Number(row['position']),
        title: String(row['title']),
        icon: String(row['icon']),
        cover: decodeCover(json(row['cover'])),
        coverPosition: Number(row['cover_position']),
        font: row['font'] === 'serif' || row['font'] === 'mono' ? row['font'] : 'default',
        isSmallText: row['is_small_text'] === true,
        isFullWidth: row['is_full_width'] === true,
        isLocked: row['is_locked'] === true,
        content: decodeDocument(json(row['content'])),
        database: row['database'] == null ? null : decodeDatabase(json(row['database'])),
        values: row['row_values'] == null ? {} : decodeValues(json(row['row_values'])),
        createdBy: String(row['created_by']),
        createdAt: Number(row['created_at']),
        updatedBy: String(row['updated_by']),
        updatedAt: Number(row['updated_at']),
        trashedAt: row['trashed_at'] == null ? null : Number(row['trashed_at']),
        trashedBy: row['trashed_by'] == null ? null : String(row['trashed_by']),
        isDemo: row['is_demo'] === true,
      })),
      favorites: favorites.map(row => ({ memberId: String(row['member_id']), pageId: String(row['page_id']), position: Number(row['position']) })),
      expanded: expanded.map(row => ({ memberId: String(row['member_id']), pageId: String(row['page_id']) })),
      versions: versions.map((row): PageVersion => ({
        id: String(row['id']), pageId: String(row['page_id']), authorId: String(row['author_id']), startedAt: Number(row['started_at']), at: Number(row['at']),
        title: String(row['title']), icon: String(row['icon']), content: decodeDocument(json(row['content'])), isDemo: row['is_demo'] === true,
      })),
      comments: comments.map((row): Comment => ({
        id: String(row['id']), pageId: String(row['page_id']), threadId: String(row['thread_id']), authorId: String(row['author_id']), text: String(row['text']),
        createdAt: Number(row['created_at']), editedAt: orNull(row['edited_at']), resolvedAt: orNull(row['resolved_at']),
        resolvedBy: row['resolved_by'] == null ? null : String(row['resolved_by']), isDemo: row['is_demo'] === true,
      })),
      passwords: Object.fromEntries(members.filter(row => row['password_hash'] !== '').map(row => [String(row['id']), String(row['password_hash'])])),
    }
    return snapshotOf(Number(meta?.version ?? 1), data)
  })

/** Under the database lock: the local snapshot, or a fresh load when another
 *  process committed since. */
const catchUp = (sql: Sql, local: Snapshot): Effect.Effect<Snapshot> =>
  Effect.gen(function* () {
    const [meta] = yield* sql<{ version: string }>`SELECT version FROM workspace_meta WHERE id = 1`.pipe(Effect.orDie)
    return Number(meta?.version ?? 1) <= local.version ? local : yield* load(sql).pipe(Effect.orDie)
  })

export const postgresBackend: Effect.Effect<Backend, never, SqlClient.SqlClient | PgClient.PgClient | Scope.Scope> =
  Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms()
    const pg = yield* PgClient.PgClient
    yield* migrate(sql).pipe(Effect.orDie)
    const notifications = yield* pg.listen(CHANNEL).pipe(Effect.orDie)
    const initial = yield* sql.withTransaction(Effect.gen(function* () {
      yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`
      yield* sql`SET TRANSACTION READ ONLY`
      return yield* load(sql)
    })).pipe(Effect.orDie)
    const ref = yield* SubscriptionRef.make(initial)
    const lock = yield* Semaphore.make(1)
    // Tells this process's own notifications from the others'.
    const instance = randomUUID()

    yield* Queue.takeAll(notifications).pipe(
      Effect.orDie,
      Effect.flatMap(batch =>
        batch.every(notification => notification.payload === instance)
          ? Effect.void
          : lock.withPermits(1)(
              Effect.gen(function* () {
                const local = yield* SubscriptionRef.get(ref)
                const fresh = yield* sql.withTransaction(Effect.gen(function* () {
                  yield* sql`SELECT pg_advisory_xact_lock(${LOCK})`.pipe(Effect.orDie)
                  return yield* catchUp(sql, local)
                })).pipe(Effect.orDie)
                if (fresh.version > local.version) yield* SubscriptionRef.set(ref, fresh)
              }),
            ),
      ),
      Effect.forever,
      Effect.forkScoped,
    )

    return {
      current: SubscriptionRef.get(ref),
      changes: SubscriptionRef.changes(ref),
      run: op =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const local = yield* SubscriptionRef.get(ref)
            const outcome = yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`SELECT pg_advisory_xact_lock(${LOCK})`.pipe(Effect.orDie)
                const base = yield* catchUp(sql, local)
                const at = yield* Clock.currentTimeMillis
                const [result, next] = yield* op(base.data, { at, id: newId })
                if (next === base.data) return { result, snapshot: base }
                yield* persist(sql, base.data, next).pipe(Effect.orDie)
                yield* sql`UPDATE workspace_meta SET version = ${base.version + 1} WHERE id = 1`.pipe(Effect.orDie)
                yield* sql`SELECT pg_notify(${CHANNEL}, ${instance})`.pipe(Effect.orDie)
                return { result, snapshot: snapshotOf(base.version + 1, next) }
              }),
            ).pipe(Effect.catchTag('SqlError', Effect.die))
            if (outcome.snapshot !== local) yield* SubscriptionRef.set(ref, outcome.snapshot)
            return outcome.result
          }),
        ),
    }
  })

/** The Workspace service on Postgres (needs `clientLayer`). */
export const layer = Layer.effect(Workspace, Effect.map(postgresBackend, fromBackend))
