import { Data, Effect, Schema as S } from 'effect'

import { type Cover, type Expanded, type Favorite, type Font, MAX_DOC_BYTES, MAX_TITLE, type Member, type Page, type Section } from './domain'
import { copyWithIds } from './editor/blocks'
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
  /** Password hashes by member id. They never leave the store. */
  passwords: Readonly<Record<string, string>>
}>

export const emptyData: WorkspaceData = { members: [], pages: [], favorites: [], expanded: [], passwords: {} }

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

export const updatePage = (pageId: string, patch: PagePatch, actorId: string): Op<Page, InvalidChange> => (data, { at }) =>
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
    const icon = patch.icon === undefined ? page.icon : [...patch.icon].slice(0, 4).join('')
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
      updatedAt: at,
    }
    return [next, { ...data, pages: replacePages(data.pages, [next]) }] as const
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
    passwords: { ...data.passwords, ...demo.passwords },
  }] as const)
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
    passwords: Object.fromEntries(Object.entries(data.passwords).filter(([memberId]) => !demoMembers.has(memberId))),
  }] as const)
}
