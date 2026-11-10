import { Data, Effect, Schema as S } from 'effect'

import { isIconLink } from './icon-link'
import { type Comment, type Cover, type Expanded, type Favorite, type Font, MAX_COMMENT, MAX_DOC_BYTES, MAX_TITLE, MAX_VERSIONS, type Member, type Page, type PageVersion, type Section, VERSION_WINDOW, sidebarWidth } from './domain'
import { type DatabaseChange, type Layout, type Value, TITLE, applyChange, checkValue, newDatabase, propertyOf, nextId, numberRows } from './database'
import { copyWithIds, find as findBlock, update as updateBlock } from './editor/blocks'
import { MAX_QUOTE } from './editor/island'
import { caretText, lengthOf, setComment, slice } from './editor/text'
import { type Block, Document } from './editor/schema'

/* The workspace's data and every change to it, as pure operations: an
   operation takes the data (and the time and an id source) and returns its
   result and the next data, or fails without changing anything. The
   in-memory store (tests) and the Postgres store (the app) run the same
   operations; Postgres then writes the rows that changed (`postgres.ts`),
   so untouched items stay the same objects. */

export type WorkspaceData = Readonly<{
  members: ReadonlyArray<Member>
  pages: ReadonlyArray<Page>
  favorites: ReadonlyArray<Favorite>
  expanded: ReadonlyArray<Expanded>
  comments: ReadonlyArray<Comment>
  versions: ReadonlyArray<PageVersion>
  /** Password hashes by member id. They never leave the store. */
  passwords: Readonly<Record<string, string>>
}>

export const emptyData: WorkspaceData = { members: [], pages: [], favorites: [], expanded: [], comments: [], versions: [], passwords: {} }

export class InvalidChange extends Data.TaggedError('InvalidChange')<{ readonly reason: string }> {}

export type OpContext = Readonly<{ at: number; id: (prefix: string) => string }>
export type Op<A, E = never> = (data: WorkspaceData, context: OpContext) => Effect.Effect<readonly [A, WorkspaceData], E>

const invalid = (reason: string) => Effect.fail(new InvalidChange({ reason }))

// READING

export const pageById = (pages: ReadonlyArray<Page>, id: string): Page | undefined => pages.find(page => page.id === id)

/** The page's ancestors, top first (stops at a missing parent or a loop). */
export const ancestorsOf = (pages: ReadonlyArray<Page>, page: Page): ReadonlyArray<Page> => {
  const out: Array<Page> = []
  for (let parentId = page.parentId; parentId !== null; ) {
    const parent = pageById(pages, parentId)
    if (parent === undefined || out.includes(parent) || parent === page) break
    out.unshift(parent)
    parentId = parent.parentId
  }
  return out
}

/** The page and everything inside it. */
export const subtreeOf = (pages: ReadonlyArray<Page>, rootId: string): ReadonlyArray<Page> => {
  const ids = new Set([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const page of pages) if (page.parentId !== null && ids.has(page.parentId) && !ids.has(page.id)) { ids.add(page.id); grew = true }
  }
  return pages.filter(page => ids.has(page.id))
}

/** In the trash itself or inside a trashed page. */
export const isTrashed = (pages: ReadonlyArray<Page>, page: Page): boolean => page.trashedAt !== null || ancestorsOf(pages, page).some(parent => parent.trashedAt !== null)

/** Private pages are their owner's alone. */
export const canSee = (page: Page, memberId: string): boolean => page.section === 'workspace' || page.ownerId === memberId

export const childrenOf = (pages: ReadonlyArray<Page>, parentId: string | null): ReadonlyArray<Page> =>
  pages.filter(page => page.parentId === parentId && page.trashedAt === null).sort((a, b) => a.position - b.position)

/** A position after every sibling, before `beforeId`, or between two. */
const positionFor = (siblings: ReadonlyArray<Page>, beforeId: string | null): number => {
  if (beforeId === null) return (siblings.at(-1)?.position ?? 0) + 1
  const index = siblings.findIndex(page => page.id === beforeId)
  if (index < 0) return (siblings.at(-1)?.position ?? 0) + 1
  const next = siblings[index]?.position ?? 1
  const previous = siblings[index - 1]?.position ?? next - 1
  return (previous + next) / 2
}

const replacePages = (pages: ReadonlyArray<Page>, changed: ReadonlyArray<Page>): ReadonlyArray<Page> => {
  const byId = new Map(changed.map(page => [page.id, page]))
  return pages.map(page => byId.get(page.id) ?? page)
}

const editablePage = (data: WorkspaceData, id: string, actorId: string): Effect.Effect<Page, InvalidChange> =>
  Effect.flatMap(visiblePage(data, id, actorId), page =>
    isTrashed(data.pages, page) ? invalid('This page is in the trash. Restore it to edit it.') : page.isLocked ? invalid('This page is locked.') : Effect.succeed(page))

const visiblePage = (data: WorkspaceData, id: string, actorId: string): Effect.Effect<Page, InvalidChange> => {
  const page = pageById(data.pages, id)
  return page === undefined || !canSee(page, actorId) ? invalid('That page does not exist.') : Effect.succeed(page)
}

// MEMBERS

export const addMember = (input: Readonly<{ name: string; email: string; passwordHash: string | null }>): Op<Readonly<{ member: Member; isNew: boolean }>, InvalidChange> => (data, { id }) => {
  const known = data.members.find(member => member.email === input.email)
  if (known !== undefined) return Effect.succeed([{ member: known, isNew: false }, data] as const)
  if (input.passwordHash === null) return invalid('A new account needs a password.')
  const member: Member = { id: id('m'), name: input.name, email: input.email, color: 'bg-indigo-500', isDark: false, theme: '', isDemo: false }
  return Effect.succeed([{ member, isNew: true }, { ...data, members: [...data.members, member], passwords: { ...data.passwords, [member.id]: input.passwordHash } }] as const)
}

const updateMember = (memberId: string, change: (member: Member) => Member): Op<void> => data =>
  Effect.succeed([undefined, { ...data, members: data.members.map(member => (member.id === memberId ? change(member) : member)) }] as const)

export const setTheme = (memberId: string, isDark: boolean): Op<void> => updateMember(memberId, member => ({ ...member, isDark }))
export const setSidebar = (memberId: string, change: Readonly<{ width?: number; isCollapsed?: boolean }>): Op<void> =>
  updateMember(memberId, member => ({
    ...member,
    ...(change.width === undefined ? {} : { sidebarWidth: sidebarWidth(change.width) }),
    ...(change.isCollapsed === undefined ? {} : { isSidebarCollapsed: change.isCollapsed }),
  }))
export const markInboxSeen = (memberId: string): Op<void> => (data, context) =>
  updateMember(memberId, member => ({ ...member, inboxSeenAt: context.at }))(data, context)
export const setPreset = (memberId: string, theme: string): Op<void> => updateMember(memberId, member => ({ ...member, theme }))

// PAGES

export type NewPage = Readonly<{
  /** An id chosen by the editor (a sub-page block names its page); else new. */
  id?: string
  parentId: string | null
  section: Section
  title?: string
  icon?: string
  /** Put it before this sibling; at the end when null. */
  beforeId?: string | null
  /** Values as a database row (checked by `addRow`). */
  values?: Page['values']
}>

export const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/

export const createPage = (input: NewPage, actorId: string): Op<Page, InvalidChange> => (data, { at, id }) =>
  Effect.gen(function* () {
    const parent = input.parentId === null ? null : yield* visiblePage(data, input.parentId, actorId)
    if (parent !== null && parent.isLocked) return yield* invalid('This page is locked.')
    if (input.id !== undefined && (!ID_PATTERN.test(input.id) || pageById(data.pages, input.id) !== undefined)) return yield* invalid('That page id cannot be used.')
    const title = (input.title ?? '').trim().slice(0, MAX_TITLE)
    const section = parent?.section ?? input.section
    const page: Page = {
      id: input.id ?? id('pg'),
      parentId: parent?.id ?? null,
      section,
      ownerId: parent?.ownerId ?? actorId,
      position: positionFor(childrenOf(data.pages, parent?.id ?? null).filter(sibling => canSee(sibling, actorId)), input.beforeId ?? null),
      title,
      icon: input.icon ?? '',
      cover: { _tag: 'NoCover' },
      coverPosition: 50,
      font: 'default',
      isSmallText: false,
      isFullWidth: false,
      isLocked: false,
      content: [],
      database: null,
      values: input.values ?? {},
      createdBy: actorId,
      createdAt: at,
      updatedBy: actorId,
      updatedAt: at,
      trashedAt: null,
      trashedBy: null,
      isDemo: false,
    }
    const expanded = parent === null || data.expanded.some(row => row.memberId === actorId && row.pageId === parent.id) ? data.expanded : [...data.expanded, { memberId: actorId, pageId: parent.id }]
    return [page, { ...data, pages: [...data.pages, page], expanded }] as const
  })

export type PagePatch = Readonly<{
  title?: string
  icon?: string
  cover?: Cover
  coverPosition?: number
  font?: Font
  isSmallText?: boolean
  isFullWidth?: boolean
  isLocked?: boolean
  /** The document as the editor sent it: decoded (and so sanitized) here. */
  content?: unknown
}>

const decodeDocument = S.decodeUnknownEffect(Document)

/** Addresses pages may hold: web, mail and links inside the app. */
export const isSafeUrl = (url: string): boolean => url === '' || /^(https?:\/\/|mailto:)/i.test(url) || /^\/(?!\/)/.test(url)

const isSafeBlock = (block: Block): boolean =>
  ('url' in block.kind ? isSafeUrl(block.kind.url) : true) &&
  block.text.every(piece => piece._tag !== 'Text' || piece.marks.link === null || isSafeUrl(piece.marks.link)) &&
  block.children.every(isSafeBlock)

// HISTORY

const versionOf = (page: Page, id: string, at: number): PageVersion =>
  ({ id, pageId: page.id, authorId: page.updatedBy, startedAt: at, at, title: page.title, icon: page.icon, content: page.content, isDemo: page.isDemo })

const sameText = (before: Page, after: Page): boolean =>
  before.title === after.title && before.icon === after.icon && (before.content === after.content || JSON.stringify(before.content) === JSON.stringify(after.content))

/** Keeps the page as it is after an edit of its title, icon or blocks: in its
 *  latest version while the same person keeps editing, else in a new one. The
 *  first recorded edit also keeps what the page was before it. */
export const recordVersion = (versions: ReadonlyArray<PageVersion>, before: Page, after: Page, context: OpContext): ReadonlyArray<PageVersion> => {
  if (sameText(before, after)) return versions
  const own = versions.filter(version => version.pageId === after.id)
  const latest = own.at(-1)
  if (latest !== undefined && latest.authorId === after.updatedBy && context.at - latest.startedAt < VERSION_WINDOW) {
    const merged: PageVersion = { ...latest, at: context.at, title: after.title, icon: after.icon, content: after.content }
    return versions.map(version => (version === latest ? merged : version))
  }
  const added = [...(latest === undefined ? [versionOf(before, context.id('version'), before.updatedAt)] : []), versionOf(after, context.id('version'), context.at)]
  const dropped = new Set(own.length + added.length > MAX_VERSIONS ? own.slice(0, own.length + added.length - MAX_VERSIONS) : [])
  return [...versions.filter(version => !dropped.has(version)), ...added]
}

/** Puts a page's title, icon and blocks back as a version had them. */
export const restoreVersion = (versionId: string, actorId: string): Op<Page, InvalidChange> => (data, context) =>
  Effect.gen(function* () {
    const version = data.versions.find(entry => entry.id === versionId)
    if (version === undefined) return yield* invalid('That version is gone.')
    const page = yield* visiblePage(data, version.pageId, actorId)
    if (page.isLocked) return yield* invalid('This page is locked.')
    return yield* updatePage(page.id, { title: version.title, icon: version.icon, content: version.content }, actorId)(data, context)
  })

export const updatePage = (pageId: string, patch: PagePatch, actorId: string): Op<Page, InvalidChange> => (data, context) =>
  Effect.gen(function* () {
    const page = yield* visiblePage(data, pageId, actorId)
    if (isTrashed(data.pages, page)) return yield* invalid('This page is in the trash. Restore it to edit it.')
    const editsContent = patch.title !== undefined || patch.content !== undefined || patch.icon !== undefined || patch.cover !== undefined
    if (page.isLocked && patch.isLocked !== false && editsContent) return yield* invalid('This page is locked.')
    let content = page.content
    if (patch.content !== undefined) {
      if (JSON.stringify(patch.content).length > MAX_DOC_BYTES) return yield* invalid('This page is too long to save.')
      content = yield* decodeDocument(patch.content).pipe(Effect.mapError(() => new InvalidChange({ reason: 'That content cannot be saved.' })))
      if (!content.every(isSafeBlock)) return yield* invalid('Links and media need an http(s), mailto: or /page address.')
    }
    if (patch.icon !== undefined && /^\w+:/.test(patch.icon) && !isIconLink(patch.icon)) return yield* invalid('Use an https:// image address.')
    const icon = patch.icon === undefined ? page.icon : isIconLink(patch.icon) ? patch.icon : [...patch.icon].slice(0, 4).join('')
    const coverPosition = patch.coverPosition === undefined ? page.coverPosition : Math.max(0, Math.min(100, Math.round(patch.coverPosition)))
    if (patch.cover?._tag === 'ImageCover' && !/^https:\/\//.test(patch.cover.url)) return yield* invalid('Use an https:// image address.')
    const next: Page = {
      ...page,
      title: patch.title === undefined ? page.title : patch.title.replace(/\s+/g, ' ').slice(0, MAX_TITLE),
      icon,
      cover: patch.cover ?? page.cover,
      coverPosition,
      font: patch.font ?? page.font,
      isSmallText: patch.isSmallText ?? page.isSmallText,
      isFullWidth: patch.isFullWidth ?? page.isFullWidth,
      isLocked: patch.isLocked ?? page.isLocked,
      content,
      updatedBy: actorId,
      updatedAt: context.at,
    }
    return [next, { ...data, pages: replacePages(data.pages, [next]), versions: recordVersion(data.versions, page, next, context) }] as const
  })

/** Moves a page into another (or to the top of a section), before a sibling
 *  or at the end. Everything inside it takes the new section. */
export const movePage = (pageId: string, target: Readonly<{ parentId: string | null; section: Section; beforeId: string | null }>, actorId: string): Op<Page, InvalidChange> => (data, { at }) =>
  Effect.gen(function* () {
    const page = yield* visiblePage(data, pageId, actorId)
    const parent = target.parentId === null ? null : yield* visiblePage(data, target.parentId, actorId)
    if (parent !== null && (parent.id === page.id || ancestorsOf(data.pages, parent).some(ancestor => ancestor.id === page.id))) return yield* invalid('A page cannot go inside itself.')
    const section = parent?.section ?? target.section
    const ownerId = section === 'private' ? actorId : page.ownerId
    const siblings = childrenOf(data.pages, parent?.id ?? null).filter(sibling => sibling.id !== page.id && canSee(sibling, actorId))
    const moved: Page = { ...page, parentId: parent?.id ?? null, section, ownerId, position: positionFor(siblings, target.beforeId), updatedAt: at, updatedBy: actorId }
    const inside = subtreeOf(data.pages, page.id).filter(entry => entry.id !== page.id).map(entry => (entry.section === section && entry.ownerId === ownerId ? entry : { ...entry, section, ownerId }))
    return [moved, { ...data, pages: replacePages(data.pages, [moved, ...inside]) }] as const
  })

/** A copy of the page and everything inside it, right after it. Sub-page
 *  blocks in the copies point at the copied pages. */
export const duplicatePage = (pageId: string, actorId: string): Op<Page, InvalidChange> => (data, { at, id }) =>
  Effect.gen(function* () {
    const page = yield* visiblePage(data, pageId, actorId)
    const tree = subtreeOf(data.pages, page.id).filter(entry => entry.trashedAt === null || entry.id === page.id)
    const ids = new Map(tree.map(entry => [entry.id, id('pg')]))
    const renamed = (content: Page['content']): Page['content'] =>
      JSON.parse(JSON.stringify(content), (key, value: unknown) => (key === 'pageId' && typeof value === 'string' ? (ids.get(value) ?? value) : value)) as Page['content']
    const siblings = childrenOf(data.pages, page.parentId)
    const after = siblings[siblings.findIndex(entry => entry.id === page.id) + 1]
    const copies = tree.map((entry): Page => ({
      ...entry,
      id: ids.get(entry.id) ?? entry.id,
      parentId: entry.id === page.id ? page.parentId : (ids.get(entry.parentId ?? '') ?? entry.parentId),
      position: entry.id === page.id ? (after === undefined ? page.position + 1 : (page.position + after.position) / 2) : entry.position,
      content: renamed(entry.content).map(child => copyWithIds(child, () => id('b'))),
      createdBy: actorId,
      createdAt: at,
      updatedBy: actorId,
      updatedAt: at,
      isLocked: false,
      isDemo: false,
    }))
    const root = copies.find(entry => entry.parentId === page.parentId && entry.id === ids.get(page.id))
    if (root === undefined) return yield* invalid('That page does not exist.')
    return [root, { ...data, pages: [...data.pages, ...copies] }] as const
  })

export const trashPage = (pageId: string, actorId: string): Op<Page, InvalidChange> => (data, { at }) =>
  Effect.gen(function* () {
    const page = yield* visiblePage(data, pageId, actorId)
    if (page.trashedAt !== null) return [page, data] as const
    const trashed: Page = { ...page, trashedAt: at, trashedBy: actorId }
    return [trashed, { ...data, pages: replacePages(data.pages, [trashed]) }] as const
  })

/** Out of the trash; to the top of its section when its parent is gone. */
export const restorePage = (pageId: string, actorId: string): Op<Page, InvalidChange> => data =>
  Effect.gen(function* () {
    const page = yield* visiblePage(data, pageId, actorId)
    const parent = page.parentId === null ? undefined : pageById(data.pages, page.parentId)
    const parentGone = page.parentId !== null && (parent === undefined || isTrashed(data.pages, parent))
    const restored: Page = { ...page, trashedAt: null, trashedBy: null, ...(parentGone ? { parentId: null } : {}) }
    return [restored, { ...data, pages: replacePages(data.pages, [restored]) }] as const
  })

// DATABASES

/** Turns an empty page into a database with one view of the layout. */
export const makeDatabase = (pageId: string, layout: Layout, actorId: string): Op<Page, InvalidChange> => (data, { at, id }) =>
  Effect.gen(function* () {
    const page = yield* editablePage(data, pageId, actorId)
    if (page.database !== null) return yield* invalid('This page is a database already.')
    if (page.content.some(entry => entry.text.length > 0 || entry.kind._tag !== 'Paragraph')) return yield* invalid('Only an empty page can become a database.')
    const next: Page = { ...page, database: newDatabase(layout, id), content: [], updatedBy: actorId, updatedAt: at }
    return [next, { ...data, pages: replacePages(data.pages, [next]) }] as const
  })

/** A new table database inside a page, for an inline database block (`input.id` is the block's page). */
export const createInlineDatabase = (input: Readonly<{ id: string; parentId: string; section: Section }>, actorId: string): Op<Page, InvalidChange> => (data, context) =>
  Effect.gen(function* () {
    const [page, next] = yield* createPage({ id: input.id, parentId: input.parentId, section: input.section }, actorId)(data, context)
    return yield* makeDatabase(page.id, 'table', actorId)(next, context)
  })

/** A change to a database's properties or views; returns what it added. */
export const changeDatabase = (pageId: string, change: DatabaseChange, actorId: string): Op<string | null, InvalidChange> => (data, { at, id }) =>
  Effect.gen(function* () {
    const page = yield* editablePage(data, pageId, actorId)
    if (page.database === null) return yield* invalid('This page is not a database.')
    if (change._tag === 'SetRollup' && change.relationId !== '' && change.targetId !== TITLE) {
      const relation = propertyOf(page.database, change.relationId)
      const target = relation?.type._tag !== 'Relation' ? undefined : relation.type.databaseId === '' ? page : pageById(data.pages, relation.type.databaseId)
      if (target?.database == null || propertyOf(target.database, change.targetId) === null) return yield* invalid('Pick a property of the related database.')
    }
    if (change._tag === 'SetRelation' && change.databaseId !== '') {
      const target = pageById(data.pages, change.databaseId)
      if (target?.database == null || target.trashedAt !== null || !canSee(target, actorId)) return yield* invalid('Pick a database to relate to.')
    }
    const changed = applyChange(page.database, change, id)
    if (typeof changed === 'string') return yield* invalid(changed)
    if (changed.database === page.database) return [changed.addedId, data] as const
    const next: Page = { ...page, database: changed.database, updatedBy: actorId, updatedAt: at }
    const rows = childrenOf(data.pages, page.id)
    const numbered = numberRows(changed.database, rows).filter((row, index) => row !== rows[index])
    return [changed.addedId, { ...data, pages: replacePages(data.pages, [next, ...numbered]) }] as const
  })

const databaseOf = (data: WorkspaceData, row: Page) => {
  const parent = row.parentId === null ? undefined : pageById(data.pages, row.parentId)
  return parent?.database == null ? null : parent.database
}

/** Sets (or, with null, clears) one value of a database row. */
export const setValue = (rowId: string, propertyId: string, value: Value | null, actorId: string): Op<Page, InvalidChange> => (data, { at }) =>
  Effect.gen(function* () {
    const row = yield* editablePage(data, rowId, actorId)
    const database = databaseOf(data, row)
    const property = database === null ? null : propertyOf(database, propertyId)
    if (property === null) return yield* invalid('That property is gone.')
    const checked = value === null ? null : checkValue(property, value, data.members)
    if (typeof checked === 'string') return yield* invalid(checked)
    if (checked?._tag === 'RelationValue' && property.type._tag === 'Relation') {
      const targetId = property.type.databaseId === '' ? row.parentId : property.type.databaseId
      const allowed = new Set(childrenOf(data.pages, targetId).filter(entry => entry.trashedAt === null && canSee(entry, actorId)).map(entry => entry.id))
      if (!checked.pageIds.every(id => allowed.has(id))) return yield* invalid('Pick pages from the related database.')
    }
    const { [propertyId]: _old, ...rest } = row.values
    const isEmpty = checked === null || (checked._tag === 'TextValue' && checked.text === '') || (checked._tag === 'OptionsValue' && checked.optionIds.length === 0) || (checked._tag === 'RelationValue' && checked.pageIds.length === 0) || (checked._tag === 'PeopleValue' && checked.memberIds.length === 0)
    const next: Page = { ...row, values: isEmpty ? rest : { ...rest, [propertyId]: checked }, updatedBy: actorId, updatedAt: at }
    return [next, { ...data, pages: replacePages(data.pages, [next]) }] as const
  })

/** A new row (page) in a database, with the values checked against it. */
export const addRow = (databaseId: string, input: Readonly<{ title: string; values: Page['values']; beforeId: string | null }>, actorId: string): Op<Page, InvalidChange> => (data, context) =>
  Effect.gen(function* () {
    const parent = yield* editablePage(data, databaseId, actorId)
    if (parent.database === null) return yield* invalid('This page is not a database.')
    const values: Record<string, Value> = {}
    for (const [propertyId, value] of Object.entries(input.values)) {
      const property = propertyId === TITLE ? null : propertyOf(parent.database, propertyId)
      if (property === null) continue
      const checked = checkValue(property, value, data.members)
      if (typeof checked !== 'string') values[propertyId] = checked
    }
    const rows = childrenOf(data.pages, parent.id)
    for (const property of parent.database.properties) {
      if (property.type._tag === 'Id') values[property.id] = { _tag: 'NumberValue', value: nextId(property, rows) }
    }
    return yield* createPage({ parentId: parent.id, section: parent.section, title: input.title, beforeId: input.beforeId, values }, actorId)(data, context)
  })

/** A new template in a database: a hidden row, edited as a page. */
export const addTemplate = (databaseId: string, actorId: string): Op<Page, InvalidChange> => (data, context) =>
  Effect.gen(function* () {
    const [row, next] = yield* addRow(databaseId, { title: 'New template', values: {}, beforeId: null }, actorId)(data, context)
    const template: Page = { ...row, isTemplate: true }
    return [template, { ...next, pages: next.pages.map(page => (page.id === row.id ? template : page)) }] as const
  })

/** A new row starting with a template's title, icon, values and content. */
export const addFromTemplate = (templateId: string, actorId: string): Op<Page, InvalidChange> => (data, context) =>
  Effect.gen(function* () {
    const template = yield* visiblePage(data, templateId, actorId)
    if (template.isTemplate !== true || template.parentId === null || isTrashed(data.pages, template)) return yield* invalid('That template is gone.')
    const [row, next] = yield* addRow(template.parentId, { title: template.title === 'New template' ? '' : template.title, values: template.values, beforeId: null }, actorId)(data, context)
    const filled: Page = { ...row, icon: template.icon, content: template.content.map(block => copyWithIds(block, () => context.id('blk'))) }
    return [filled, { ...next, pages: next.pages.map(page => (page.id === row.id ? filled : page)) }] as const
  })

/** Deletes a trashed page and everything inside it for good. */
export const deletePage = (pageId: string, actorId: string): Op<number, InvalidChange> => data =>
  Effect.gen(function* () {
    const page = yield* visiblePage(data, pageId, actorId)
    if (page.trashedAt === null) return yield* invalid('Move the page to the trash first.')
    const ids = new Set(subtreeOf(data.pages, page.id).map(entry => entry.id))
    return [ids.size, {
      ...data,
      pages: data.pages.filter(entry => !ids.has(entry.id)),
      favorites: data.favorites.filter(row => !ids.has(row.pageId)),
      expanded: data.expanded.filter(row => !ids.has(row.pageId)),
      comments: data.comments.filter(row => !ids.has(row.pageId)),
      versions: data.versions.filter(row => !ids.has(row.pageId)),
    }] as const
  })

export const setFavorite = (pageId: string, isFavorite: boolean, actorId: string): Op<void, InvalidChange> => data =>
  Effect.gen(function* () {
    yield* visiblePage(data, pageId, actorId)
    const mine = data.favorites.filter(row => row.memberId === actorId)
    const has = mine.some(row => row.pageId === pageId)
    if (has === isFavorite) return [undefined, data] as const
    const favorites = isFavorite
      ? [...data.favorites, { memberId: actorId, pageId, position: (mine.reduce((max, row) => Math.max(max, row.position), 0)) + 1 }]
      : data.favorites.filter(row => !(row.memberId === actorId && row.pageId === pageId))
    return [undefined, { ...data, favorites }] as const
  })

export const setExpanded = (pageId: string, isExpanded: boolean, actorId: string): Op<void> => data => {
  const has = data.expanded.some(row => row.memberId === actorId && row.pageId === pageId)
  if (has === isExpanded || pageById(data.pages, pageId) === undefined) return Effect.succeed([undefined, data] as const)
  const expanded = isExpanded ? [...data.expanded, { memberId: actorId, pageId }] : data.expanded.filter(row => !(row.memberId === actorId && row.pageId === pageId))
  return Effect.succeed([undefined, { ...data, expanded }] as const)
}

// COMMENTS

const commentText = (text: string): Effect.Effect<string, InvalidChange> => {
  const trimmed = text.trim()
  return trimmed === '' ? invalid('Write something first.') : trimmed.length > MAX_COMMENT ? invalid(`Keep comments under ${MAX_COMMENT} characters.`) : Effect.succeed(trimmed)
}

/** The comment, on a page the actor sees and that is not in the trash. */
const openComment = (data: WorkspaceData, commentId: string, actorId: string): Effect.Effect<Comment, InvalidChange> =>
  Effect.gen(function* () {
    const comment = data.comments.find(entry => entry.id === commentId)
    if (comment === undefined) return yield* invalid('That comment was deleted.')
    const page = yield* visiblePage(data, comment.pageId, actorId)
    if (isTrashed(data.pages, page)) return yield* invalid('Restore the page to change its comments.')
    return comment
  })

const replaceComment = (data: WorkspaceData, comment: Comment): WorkspaceData => ({ ...data, comments: data.comments.map(entry => (entry.id === comment.id ? comment : entry)) })

/** Text of a block a discussion is started on: `quote` must still be what is there. */
export type CommentAnchor = Readonly<{ blockId: string; from: number; to: number; quote: string }>

/** A new discussion on the page (`threadId` null), on text of it (`anchor`, which
 *  gets marked with the discussion), or a reply in an open one. */
export const addComment = (target: Readonly<{ pageId: string; threadId: string | null; anchor?: CommentAnchor | null }>, text: string, actorId: string): Op<Comment, InvalidChange> => (data, context) =>
  Effect.gen(function* () {
    const { at, id } = context
    const page = yield* visiblePage(data, target.pageId, actorId)
    if (isTrashed(data.pages, page)) return yield* invalid('Restore the page to comment on it.')
    const body = yield* commentText(text)
    const thread = target.threadId === null ? undefined : data.comments.find(entry => entry.id === target.threadId && entry.threadId === entry.id && entry.pageId === page.id)
    if (target.threadId !== null && thread === undefined) return yield* invalid('That discussion was deleted.')
    if (thread !== undefined && thread.resolvedAt !== null) return yield* invalid('Reopen the discussion to reply.')
    const commentId = id('comment')
    const anchor = thread === undefined ? (target.anchor ?? null) : null
    const comment: Comment = { id: commentId, pageId: page.id, threadId: thread?.id ?? commentId, authorId: actorId, text: body, createdAt: at, editedAt: null, resolvedAt: null, resolvedBy: null, quote: anchor?.quote ?? null, isDemo: false }
    const withComment = { ...data, comments: [...data.comments, comment] }
    if (anchor === null) return [comment, withComment] as const
    const block = findBlock(page.content, anchor.blockId)
    const from = Math.min(anchor.from, anchor.to), to = Math.max(anchor.from, anchor.to)
    const isSame = block !== null && Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to <= lengthOf(block.text) && from < to &&
      anchor.quote.length <= MAX_QUOTE && caretText(slice(block.text, from, to)) === anchor.quote
    if (!isSame) return yield* invalid('That text changed. Select it again to comment on it.')
    const content = updateBlock(page.content, anchor.blockId, entry => ({ ...entry, text: setComment(entry.text, from, to, commentId) }))
    const [, next] = yield* updatePage(page.id, { content }, actorId)(withComment, context)
    return [comment, next] as const
  })

export const editComment = (commentId: string, text: string, actorId: string): Op<Comment, InvalidChange> => (data, { at }) =>
  Effect.gen(function* () {
    const comment = yield* openComment(data, commentId, actorId)
    if (comment.authorId !== actorId) return yield* invalid('Only its author can edit a comment.')
    const body = yield* commentText(text)
    if (body === comment.text) return [comment, data] as const
    const edited: Comment = { ...comment, text: body, editedAt: at }
    return [edited, replaceComment(data, edited)] as const
  })

/** Deletes a comment; a discussion's first comment takes the discussion along. */
export const deleteComment = (commentId: string, actorId: string): Op<number, InvalidChange> => (data, { at }) =>
  Effect.gen(function* () {
    const comment = yield* openComment(data, commentId, actorId)
    if (comment.authorId !== actorId) return yield* invalid('Only its author can delete a comment.')
    const isThread = comment.id === comment.threadId
    const comments = data.comments.filter(entry => entry.id !== comment.id && !(isThread && entry.threadId === comment.id))
    // The text it was on loses its mark (a new revision, so open editors take it).
    const page = data.pages.find(entry => entry.id === comment.pageId)
    const isMarked = isThread && page !== undefined && JSON.stringify(page.content).includes(`"comment":${JSON.stringify(comment.id)}`)
    const pages = !isMarked ? data.pages : replacePages(data.pages, [{
      ...page,
      content: JSON.parse(JSON.stringify(page.content), (key, value: unknown) => (key === 'comment' && value === comment.id ? null : value)) as Page['content'],
      updatedAt: at,
    }])
    return [data.comments.length - comments.length, { ...data, comments, pages }] as const
  })

/** Resolves or reopens a discussion; anyone who sees the page may. */
export const resolveThread = (threadId: string, isResolved: boolean, actorId: string): Op<Comment, InvalidChange> => (data, { at }) =>
  Effect.gen(function* () {
    const thread = yield* openComment(data, threadId, actorId)
    if (thread.threadId !== thread.id) return yield* invalid('Only a discussion can be resolved.')
    if ((thread.resolvedAt !== null) === isResolved) return [thread, data] as const
    const next: Comment = { ...thread, resolvedAt: isResolved ? at : null, resolvedBy: isResolved ? actorId : null }
    return [next, replaceComment(data, next)] as const
  })

// DEMO

/** Adds the demo content unless it is there (false: nothing changed). */
export const addDemo = (demo: WorkspaceData): Op<boolean> => data => {
  if (data.members.some(member => member.isDemo)) return Effect.succeed([false, data] as const)
  const emails = new Set(data.members.map(member => member.email))
  const members = demo.members.filter(member => !emails.has(member.email))
  return Effect.succeed([true, {
    members: [...data.members, ...members],
    pages: [...data.pages, ...demo.pages],
    favorites: [...data.favorites, ...demo.favorites],
    expanded: [...data.expanded, ...demo.expanded],
    comments: [...data.comments, ...demo.comments],
    versions: [...data.versions, ...demo.versions],
    passwords: { ...data.passwords, ...demo.passwords },
  }] as const)
}

/** Replies whose discussion is gone go with it. */
const withoutOrphans = (comments: ReadonlyArray<Comment>): ReadonlyArray<Comment> => {
  const threads = new Set(comments.filter(row => row.id === row.threadId).map(row => row.id))
  return comments.filter(row => threads.has(row.threadId))
}

export type DemoCounts = Readonly<{ members: number; pages: number }>

export const clearDemo = (): Op<DemoCounts> => data => {
  const demoMembers = new Set(data.members.filter(member => member.isDemo).map(member => member.id))
  const demoPages = new Set(data.pages.filter(page => page.isDemo || (demoMembers.has(page.ownerId) && page.section === 'private')).map(page => page.id))
  return Effect.succeed([{ members: demoMembers.size, pages: demoPages.size }, {
    members: data.members.filter(member => !demoMembers.has(member.id)),
    pages: data.pages.filter(page => !demoPages.has(page.id)),
    favorites: data.favorites.filter(row => !demoMembers.has(row.memberId) && !demoPages.has(row.pageId)),
    expanded: data.expanded.filter(row => !demoMembers.has(row.memberId) && !demoPages.has(row.pageId)),
    comments: withoutOrphans(data.comments.filter(row => !row.isDemo && !demoMembers.has(row.authorId) && !demoPages.has(row.pageId))),
    versions: data.versions.filter(row => !row.isDemo && !demoPages.has(row.pageId)),
    passwords: Object.fromEntries(Object.entries(data.passwords).filter(([memberId]) => !demoMembers.has(memberId))),
  }] as const)
}
