import { Effect, Match as M, Schema as S, Stream } from 'effect'
import { Command, Subscription, type Update } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import * as Navigation from 'foldkit/navigation'

import { type Program, region } from '@hyper-effect/core'
import * as Island from '@hyper-effect/island'

import * as Icon from '@/lib/icon'
import { button } from '@/ui/button'
import { input } from '@/ui/input'

import { requireMember } from '../auth'
import { Member, Page, Section, formatAgo, titleOf } from '../domain'
import { EditorEvent, PageEditor } from '../editor/island'
import { context, renderDocument } from '../editor/render'
import { Document as BlockDocument } from '../editor/schema'
import { Workspace, type WorkspaceState } from '../store'
import { box, pageRoot } from '../view/design'
import { pageIcon } from '../view/icons'
import { PICKER_INPUT_ID, Picker, type PickerItem, checkedIndex, keyAction, open as openPicker, pickerView } from '../view/picker'
import { Nav, navOf, sameNav, sidebar } from '../view/shell'
import { ancestorsOf, canSee, isTrashed, subtreeOf } from '../workspace'

/* A page of the workspace: the sidebar, the page's top bar (breadcrumbs,
   favorite, •••), its header and its document. `/` shows the first page,
   `/?trash=1` the trash. The sidebar's page menus, "Move to" and search are
   one picker in the Model. */

// MODEL

export const Crumb = S.Struct({ id: S.String, title: S.String, icon: S.String })
export type Crumb = typeof Crumb.Type

export const TrashEntry = S.Struct({ id: S.String, title: S.String, icon: S.String, trashedAt: S.Number, path: S.String })
export type TrashEntry = typeof TrashEntry.Type

/** A page someone can see, for search and "Move to". */
export const PageEntry = S.Struct({ id: S.String, title: S.String, icon: S.String, path: S.String, section: Section })
export type PageEntry = typeof PageEntry.Type

export const View = S.Literals(['page', 'trash', 'empty'])
export type View = typeof View.Type

export const Model = S.Struct({
  me: Member,
  view: View,
  pageId: S.NullOr(S.String),
  /** Null once it is gone (deleted for good, or made private by someone else). */
  page: S.NullOr(Page),
  crumbs: S.Array(Crumb),
  isFavorite: S.Boolean,
  isInTrash: S.Boolean,
  nav: Nav,
  pages: S.Array(PageEntry),
  trash: S.Array(TrashEntry),
  now: S.Number,
  picker: S.NullOr(Picker),
  titleDraft: S.NullOr(S.String),
  notice: S.NullOr(S.String),
})
export type Model = typeof Model.Type

// MESSAGE

export const PAGE_ACTIONS = ['favorite', 'duplicate', 'move', 'trash', 'open'] as const

export const Message = defineMessageUnion({
  ClickedToggle: { pageId: S.String, isOpen: S.Boolean },
  ClickedAdd: { parentId: S.NullOr(S.String), section: Section },
  ClickedMenu: { pageId: S.String, anchor: S.String },
  ClickedSearch: {},
  ChangedPickerQuery: { query: S.String },
  PressedPickerKey: { key: S.String },
  ChosePicker: { value: S.String },
  ClosedPicker: {},
  ChangedTitle: { title: S.String },
  SubmittedTitle: {},
  /** The editor island's content, a new sub-page, a page to open. */
  GotEditorEvent: { event: EditorEvent },
  ClickedFavorite: {},
  ClickedRestore: { pageId: S.String },
  ClickedDeleteForever: { pageId: S.String },
  ClickedToggleTheme: {},
  ClickedDismissNotice: {},
  GotPage: {
    me: Member,
    page: S.NullOr(Page),
    crumbs: S.Array(Crumb),
    isFavorite: S.Boolean,
    isInTrash: S.Boolean,
    nav: Nav,
    pages: S.Array(PageEntry),
    trash: S.Array(TrashEntry),
    now: S.Number,
  },
  SucceededCreate: { id: S.String },
  SucceededTrash: { pageId: S.String },
  FailedChange: { reason: S.String },
  CompletedChange: {},
  CompletedBrowserAction: {},
})
export type Message = typeof Message.Type

/** What a browser may post (each re-checked in update and by the store). */
export const ClientMessage = S.Union([
  Message.ClickedToggle,
  Message.ClickedAdd,
  Message.ClickedMenu,
  Message.ClickedSearch,
  Message.PressedPickerKey,
  Message.ChosePicker,
  Message.ClosedPicker,
  Message.SubmittedTitle,
  Message.GotEditorEvent,
  Message.ClickedFavorite,
  Message.ClickedRestore,
  Message.ClickedDeleteForever,
  Message.ClickedToggleTheme,
  Message.ClickedDismissNotice,
])
export type ClientMessage = typeof ClientMessage.Type

// COMMAND

const failed = (reason: string) => Effect.succeed(Message.FailedChange({ reason }))
const done = Effect.as(Message.CompletedChange())

export const CreatePage = Command.define('CreatePage', {
  args: { parentId: S.NullOr(S.String), section: Section, actorId: S.String },
  messages: [Message.SucceededCreate, Message.FailedChange],
  execute: ({ parentId, section, actorId }) =>
    Workspace.use(workspace => workspace.createPage({ parentId, section }, actorId)).pipe(
      Effect.map(page => Message.SucceededCreate({ id: page.id })),
      Effect.catchTag('InvalidChange', ({ reason }) => failed(reason)),
    ),
})

export const SaveTitle = Command.define('SaveTitle', {
  args: { pageId: S.String, title: S.String, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ pageId, title, actorId }) =>
    Workspace.use(workspace => workspace.updatePage(pageId, { title }, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const SaveContent = Command.define('SaveContent', {
  args: { pageId: S.String, content: BlockDocument, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ pageId, content, actorId }) =>
    Workspace.use(workspace => workspace.updatePage(pageId, { content }, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const CreateSubPage = Command.define('CreateSubPage', {
  args: { parentId: S.String, childId: S.String, section: Section, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ parentId, childId, section, actorId }) =>
    Workspace.use(workspace => workspace.createPage({ id: childId, parentId, section }, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const SetExpanded = Command.define('SetExpanded', {
  args: { pageId: S.String, isOpen: S.Boolean, actorId: S.String },
  messages: [Message.CompletedChange],
  execute: ({ pageId, isOpen, actorId }) => Workspace.use(workspace => workspace.setExpanded(pageId, isOpen, actorId)).pipe(done),
})

export const SetFavorite = Command.define('SetFavorite', {
  args: { pageId: S.String, isFavorite: S.Boolean, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ pageId, isFavorite, actorId }) =>
    Workspace.use(workspace => workspace.setFavorite(pageId, isFavorite, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const DuplicatePage = Command.define('DuplicatePage', {
  args: { pageId: S.String, actorId: S.String },
  messages: [Message.SucceededCreate, Message.FailedChange],
  execute: ({ pageId, actorId }) =>
    Workspace.use(workspace => workspace.duplicatePage(pageId, actorId)).pipe(
      Effect.map(page => Message.SucceededCreate({ id: page.id })),
      Effect.catchTag('InvalidChange', ({ reason }) => failed(reason)),
    ),
})

export const MovePage = Command.define('MovePage', {
  args: { pageId: S.String, parentId: S.NullOr(S.String), section: Section, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ pageId, parentId, section, actorId }) =>
    Workspace.use(workspace => workspace.movePage(pageId, { parentId, section, beforeId: null }, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const TrashPage = Command.define('TrashPage', {
  args: { pageId: S.String, actorId: S.String },
  messages: [Message.SucceededTrash, Message.FailedChange],
  execute: ({ pageId, actorId }) =>
    Workspace.use(workspace => workspace.trashPage(pageId, actorId)).pipe(
      Effect.as(Message.SucceededTrash({ pageId })),
      Effect.catchTag('InvalidChange', ({ reason }) => failed(reason)),
    ),
})

export const RestorePage = Command.define('RestorePage', {
  args: { pageId: S.String, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ pageId, actorId }) =>
    Workspace.use(workspace => workspace.restorePage(pageId, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const DeletePage = Command.define('DeletePage', {
  args: { pageId: S.String, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ pageId, actorId }) =>
    Workspace.use(workspace => workspace.deletePage(pageId, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const SetTheme = Command.define('SetTheme', {
  args: { memberId: S.String, isDark: S.Boolean },
  messages: [Message.CompletedChange],
  execute: ({ memberId, isDark }) => Workspace.use(workspace => workspace.setTheme(memberId, isDark)).pipe(done),
})

export const LoadUrl = Command.define('LoadUrl', {
  args: { url: S.String },
  messages: [Message.CompletedBrowserAction],
  execute: ({ url }) => Navigation.load(url).pipe(Effect.as(Message.CompletedBrowserAction())),
})

// SLICE (what the page shows of the shared state)

export type Slice = Omit<typeof Message.GotPage.Type, '_tag' | 'me'> & Readonly<{ me: Member | null }>

const pathOf = (state: WorkspaceState, page: Page): string => ancestorsOf(state.pages, page).map(titleOf).join(' / ')

export const sliceOf = (state: WorkspaceState, pageId: string | null, memberId: string, now: number): Slice => {
  const found = pageId === null ? undefined : state.pages.find(page => page.id === pageId)
  const page = found !== undefined && canSee(found, memberId) ? found : null
  const visible = state.pages.filter(entry => canSee(entry, memberId))
  return {
    me: state.members.find(member => member.id === memberId) ?? null,
    page,
    crumbs: page === null ? [] : [...ancestorsOf(state.pages, page), page].map(entry => ({ id: entry.id, title: titleOf(entry), icon: entry.icon })),
    isFavorite: page !== null && state.favorites.some(row => row.memberId === memberId && row.pageId === page.id),
    isInTrash: page !== null && isTrashed(state.pages, page),
    nav: navOf(state, memberId),
    pages: visible.filter(entry => !isTrashed(state.pages, entry)).map(entry => ({ id: entry.id, title: titleOf(entry), icon: entry.icon, path: pathOf(state, entry), section: entry.section })),
    trash: visible.filter(entry => entry.trashedAt !== null).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0)).map(entry => ({ id: entry.id, title: titleOf(entry), icon: entry.icon, trashedAt: entry.trashedAt ?? 0, path: pathOf(state, entry) })),
    now,
  }
}

const sameSlice = (a: Slice, b: Slice): boolean =>
  a.me === b.me && a.page === b.page && a.isFavorite === b.isFavorite && a.isInTrash === b.isInTrash && sameNav(a.nav, b.nav) &&
  JSON.stringify([a.crumbs, a.pages, a.trash]) === JSON.stringify([b.crumbs, b.pages, b.trash])

// INIT

export type Flags = Readonly<{ me: Member; view: View; pageId: string | null } & Omit<Slice, 'me'>>

export const init = (flags: Flags): Update.Return<Model, Message, Workspace> => ({
  model: { ...flags, picker: null, titleDraft: null, notice: null },
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, Workspace>

const isKnown = (model: Model, pageId: string) => model.pages.some(entry => entry.id === pageId) || model.trash.some(entry => entry.id === pageId)

/** The choices the open picker offers. */
export const pickerItems = (model: Model): ReadonlyArray<PickerItem> => {
  const picker = model.picker
  if (picker === null) return []
  switch (picker.field) {
    case 'page': {
      const isFavorite = model.nav.favorites.some(row => row.id === picker.pageId)
      return [
        { value: 'favorite', label: isFavorite ? 'Remove from Favorites' : 'Add to Favorites' },
        { value: 'duplicate', label: 'Duplicate', shortcut: 'Ctrl D' },
        { value: 'move', label: 'Move to', shortcut: 'Ctrl Shift P' },
        { value: 'trash', label: 'Move to Trash' },
        { value: 'open', label: 'Open' },
      ]
    }
    case 'move': {
      const own = model.pages.find(entry => entry.id === picker.pageId)
      const inside = new Set(own === undefined ? [] : model.pages.filter(entry => entry.id === own.id || entry.path.split(' / ').includes(own.title)).map(entry => entry.id))
      return [
        { value: 'section:workspace', label: 'Workspace', group: 'Sections' },
        { value: 'section:private', label: 'Private', group: 'Sections' },
        ...model.pages.filter(entry => !inside.has(entry.id)).map(entry => ({ value: `page:${entry.id}`, label: entry.title, group: 'Pages', keywords: entry.path })),
      ]
    }
    case 'search':
      return model.pages.map(entry => (entry.path === '' ? { value: entry.id, label: entry.title } : { value: entry.id, label: entry.title, keywords: entry.path }))
  }
}

const choose = (model: Model, picker: Picker, value: string): UpdateReturn => {
  const closed = { ...model, picker: null }
  const actorId = model.me.id
  switch (picker.field) {
    case 'search':
      return isKnown(model, value) ? { model: closed, commands: [LoadUrl({ url: `/p/${value}` })] } : { model: closed }
    case 'page':
      if (!isKnown(model, picker.pageId)) return { model: closed }
      switch (value) {
        case 'favorite': return { model: closed, commands: [SetFavorite({ pageId: picker.pageId, isFavorite: !model.nav.favorites.some(row => row.id === picker.pageId), actorId })] }
        case 'duplicate': return { model: closed, commands: [DuplicatePage({ pageId: picker.pageId, actorId })] }
        case 'move': return { model: { ...model, picker: openPicker('move', picker.pageId, picker.anchor) } }
        case 'trash': return { model: closed, commands: [TrashPage({ pageId: picker.pageId, actorId })] }
        case 'open': return { model: closed, commands: [LoadUrl({ url: `/p/${picker.pageId}` })] }
        default: return { model: closed }
      }
    case 'move': {
      if (value === 'section:workspace' || value === 'section:private') return { model: closed, commands: [MovePage({ pageId: picker.pageId, parentId: null, section: value === 'section:private' ? 'private' : 'workspace', actorId })] }
      const parentId = value.startsWith('page:') ? value.slice(5) : ''
      const parent = model.pages.find(entry => entry.id === parentId)
      return parent === undefined ? { model: closed } : { model: closed, commands: [MovePage({ pageId: picker.pageId, parentId, section: parent.section, actorId })] }
    }
  }
}

export const update = (model: Model, message: Message): UpdateReturn =>
  M.value(message).pipe(
    M.withReturnType<UpdateReturn>(),
    M.tagsExhaustive({
      ClickedToggle: ({ pageId, isOpen }) => (isKnown(model, pageId) ? { model, commands: [SetExpanded({ pageId, isOpen, actorId: model.me.id })] } : { model }),
      ClickedAdd: ({ parentId, section }) =>
        parentId !== null && !isKnown(model, parentId) ? { model } : { model, commands: [CreatePage({ parentId, section, actorId: model.me.id })] },
      ClickedMenu: ({ pageId, anchor }) => (isKnown(model, pageId) && /^--[A-Za-z0-9_-]+$/.test(anchor) ? { model: { ...model, picker: openPicker('page', pageId, anchor) } } : { model }),
      ClickedSearch: () => ({ model: { ...model, picker: openPicker('search', '', null) } }),
      ChangedPickerQuery: ({ query }) => (model.picker === null ? { model } : { model: { ...model, picker: { ...model.picker, query: query.slice(0, 200), active: 0 } } }),
      PressedPickerKey: ({ key }) => {
        if (model.picker === null) return { model }
        const action = keyAction(model.picker, pickerItems(model), key)
        switch (action._tag) {
          case 'move': return { model: { ...model, picker: { ...model.picker, active: action.active } } }
          case 'choose': return choose(model, model.picker, action.value)
          case 'close': return { model: { ...model, picker: null } }
          case 'none': return { model }
        }
      },
      ChosePicker: ({ value }) => (model.picker === null ? { model } : choose(model, model.picker, value)),
      ClosedPicker: () => ({ model: { ...model, picker: null } }),
      ChangedTitle: ({ title }) => ({ model: { ...model, titleDraft: title } }),
      GotEditorEvent: ({ event }) => {
        const { page } = model
        if (page === null || event.pageId !== page.id || model.isInTrash || page.isLocked) return { model }
        switch (event._tag) {
          case 'ChangedContent': return { model, commands: [SaveContent({ pageId: page.id, content: event.content, actorId: model.me.id })] }
          case 'CreatedSubPage': return /^[A-Za-z0-9_-]{1,64}$/.test(event.childId) ? { model, commands: [CreateSubPage({ parentId: page.id, childId: event.childId, section: page.section, actorId: model.me.id })] } : { model }
          case 'OpenedPage': return { model }
        }
      },
      SubmittedTitle: () =>
        model.page === null || model.titleDraft === null || model.page.isLocked || model.isInTrash
          ? { model: { ...model, titleDraft: null } }
          : { model: { ...model, titleDraft: null }, commands: [SaveTitle({ pageId: model.page.id, title: model.titleDraft, actorId: model.me.id })] },
      ClickedFavorite: () => (model.page === null ? { model } : { model, commands: [SetFavorite({ pageId: model.page.id, isFavorite: !model.isFavorite, actorId: model.me.id })] }),
      ClickedRestore: ({ pageId }) => (isKnown(model, pageId) ? { model, commands: [RestorePage({ pageId, actorId: model.me.id })] } : { model }),
      ClickedDeleteForever: ({ pageId }) => (model.trash.some(entry => entry.id === pageId) ? { model, commands: [DeletePage({ pageId, actorId: model.me.id })] } : { model }),
      ClickedToggleTheme: () => ({ model, commands: [SetTheme({ memberId: model.me.id, isDark: !model.me.isDark })] }),
      ClickedDismissNotice: () => ({ model: { ...model, notice: null } }),
      GotPage: ({ _tag: _, ...slice }) => ({ model: { ...model, ...slice } }),
      SucceededCreate: ({ id }) => ({ model, commands: [LoadUrl({ url: `/p/${id}` })] }),
      SucceededTrash: () => ({ model }),
      FailedChange: ({ reason }) => ({ model: { ...model, notice: reason } }),
      CompletedChange: () => ({ model }),
      CompletedBrowserAction: () => ({ model }),
    }),
  )

// SUBSCRIPTION

export const subscriptions = Subscription.make<Model, Message, Workspace>()(entry => ({
  page: entry(
    { pageId: S.NullOr(S.String), memberId: S.String },
    {
      modelToDependencies: model => ({ pageId: model.pageId, memberId: model.me.id }),
      dependenciesToStream: ({ pageId, memberId }) =>
        Stream.unwrap(
          Workspace.use(workspace =>
            Effect.succeed(
              workspace.changes.pipe(
                Stream.mapEffect(state => Effect.map(Effect.clockWith(clock => clock.currentTimeMillis), now => sliceOf(state, pageId, memberId, now))),
                Stream.changesWith(sameSlice),
                Stream.filter((slice): slice is Slice & { me: Member } => slice.me !== null),
                Stream.map(slice => Message.GotPage(slice)),
              ),
            ),
          ),
        ),
    },
  ),
}))

// VIEW

const topBar = (model: Model, h: HtmlBuilder<Message>): Html =>
  box({ as: 'header', class: 'flex h-11 shrink-0 items-center gap-1 px-3', attributes: [h.Id('topbar')], children: [
      box({ as: 'nav', class: 'flex min-w-0 flex-1 items-center gap-0.5 text-[14px]', attributes: [h.AriaLabel('Breadcrumbs')], children: model.crumbs.flatMap((crumb, index) => [
          ...(index === 0 ? [] : [box({ as: 'span', class: 'px-0.5 text-muted-foreground', children: ['/'] }, h)]),
          box({ as: 'a', class: 'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-accent', attributes: [h.Href(`/p/${crumb.id}`), h.DataAttribute('crumb', crumb.id)], children: [
              pageIcon(crumb.icon, h),
              box({ as: 'span', class: 'min-w-0 max-w-40 truncate', children: [crumb.title] }, h),
            ] }, h),
        ]) }, h),
      ...(model.page === null ? [] : [
        box({ as: 'span', class: 'px-2 text-[13px] text-muted-foreground', attributes: [h.Id('edited-at')], children: [`Edited ${formatAgo(model.page.updatedAt, model.now)}`] }, h),
        button({ variant: 'ghost', size: 'icon-sm', id: 'favorite-toggle', ariaLabel: model.isFavorite ? 'Remove from Favorites' : 'Add to Favorites', title: model.isFavorite ? 'Remove from Favorites' : 'Add to Favorites', onClick: Message.ClickedFavorite(), children: [Icon.icon(model.isFavorite ? 'star' : 'star', { class: model.isFavorite ? 'size-4 fill-amber-400 text-amber-400' : 'size-4' }, h)] }, h),
      ]),
    ] }, h)

const trashBanner = (page: Page, h: HtmlBuilder<Message>): Html =>
  box({ class: 'flex items-center justify-center gap-3 bg-destructive px-4 py-1.5 text-[14px] text-white', attributes: [h.Id('trash-banner')], children: [
      box({ as: 'span', children: ['This page is in Trash.'] }, h),
      button({ variant: 'outline', size: 'compact', id: 'restore-page', onClick: Message.ClickedRestore({ pageId: page.id }), children: ['Restore page'] }, h),
      button({ variant: 'outline', size: 'compact', id: 'delete-page', onClick: Message.ClickedDeleteForever({ pageId: page.id }), children: ['Delete from Trash'] }, h),
    ] }, h)

const pageBody = (model: Model, page: Page, h: HtmlBuilder<Message>): Html =>
  box({ as: 'article', class: 'mx-auto w-full max-w-[708px] px-6 pt-20 pb-40', attributes: [h.Id('page-body')], children: [
      box({ class: 'mb-2', children: [pageIcon(page.icon, h, 'lg')] }, h),
      input({ id: 'page-title', value: model.titleDraft ?? page.title, placeholder: 'Untitled', ariaLabel: 'Page title', autocomplete: 'off', variant: 'inline-lg', onInput: title => Message.ChangedTitle({ title }) }, h),
      editorView(model, page, h),
    ] }, h)

/** The page's blocks: the editor island, or read-only when locked or in Trash. */
const editorView = (model: Model, page: Page, h: HtmlBuilder<Message>): Html => {
  const isEditable = !model.isInTrash && !page.isLocked
  const props = { pageId: page.id, content: page.content, revision: page.updatedAt, isEditable, pages: model.pages.map(({ id, title, icon }) => ({ id, title, icon })), members: [], crumbs: model.crumbs }
  return isEditable
    ? Island.view(PageEditor, { id: `editor-${page.id}`, props, onEvent: event => Message.GotEditorEvent({ event }) }, h)
    : box({ class: 'nb-editor nb-read-only', attributes: [h.DataAttribute('read-only', page.id)], children: [...renderDocument(page.content, context(props), h)] }, h)
}

const trashView = (model: Model, h: HtmlBuilder<Message>): Html =>
  box({ as: 'section', class: 'mx-auto w-full max-w-[708px] px-6 pt-16', attributes: [h.Id('trash')], children: [
      box({ as: 'h1', class: 'mb-4 text-[32px] font-bold', children: ['Trash'] }, h),
      ...(model.trash.length === 0 ? [box({ as: 'p', class: 'text-muted-foreground', children: ['No pages in Trash'] }, h)] : []),
      ...model.trash.map(entry =>
        box({ class: 'group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent', attributes: [h.DataAttribute('trash-row', entry.id)], children: [
            pageIcon(entry.icon, h),
            box({ as: 'a', class: 'min-w-0 flex-1 truncate', attributes: [h.Href(`/p/${entry.id}`)], children: [entry.title, ...(entry.path === '' ? [] : [box({ as: 'span', class: 'ml-2 text-[12px] text-muted-foreground', children: [entry.path] }, h)])] }, h),
            button({ variant: 'ghost', size: 'icon-xs', ariaLabel: `Restore ${entry.title}`, title: 'Restore', onClick: Message.ClickedRestore({ pageId: entry.id }), children: [Icon.icon('undo-2', { class: 'size-3.5' }, h)] }, h),
            button({ variant: 'ghost', size: 'icon-xs', ariaLabel: `Delete ${entry.title} from Trash`, title: 'Delete from Trash', onClick: Message.ClickedDeleteForever({ pageId: entry.id }), children: [Icon.icon('trash-2', { class: 'size-3.5' }, h)] }, h),
          ] }, h),
      ),
    ] }, h)

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: `${model.view === 'trash' ? 'Trash' : model.page === null ? 'hypernotes' : titleOf(model.page)} · hypernotes`,
  body: pageRoot({ isDark: model.me.isDark, theme: model.me.theme, children: [
      region(h, {
        id: 'sidebar',
        deps: [model.me, model.nav, model.pageId, model.view],
        render: () => sidebar({
          me: model.me,
          activeId: model.pageId,
          active: model.view === 'trash' ? '/?trash=1' : '',
          nav: model.nav,
          actions: {
            onToggle: (pageId, isOpen) => Message.ClickedToggle({ pageId, isOpen }),
            onAdd: (parentId, section) => Message.ClickedAdd({ parentId, section }),
            onMenu: (pageId, anchor) => Message.ClickedMenu({ pageId, anchor }),
            onSearch: Message.ClickedSearch(),
          },
          isDark: model.me.isDark,
          onToggleTheme: Message.ClickedToggleTheme(),
        }, h),
      }),
      box({ as: 'main', class: 'flex min-w-0 flex-1 flex-col', children: [
          region(h, { id: 'topbar', deps: [model.crumbs, model.isFavorite, model.page?.updatedAt ?? null, model.now], render: () => topBar(model, h) }),
          ...(model.page !== null && model.isInTrash ? [trashBanner(model.page, h)] : []),
          box({ class: 'min-h-0 flex-1 overflow-y-auto', attributes: [h.DataAttribute('keep-scroll', 'page')], children: [
              model.view === 'trash'
                ? region(h, { id: 'trash', deps: [model.trash], render: () => trashView(model, h) })
                : model.page === null
                  ? box({ as: 'p', class: 'p-16 text-center text-muted-foreground', attributes: [h.Id('empty')], children: [model.view === 'empty' ? 'No pages yet. Create one with + in the sidebar.' : 'This page does not exist or was deleted.'] }, h)
                  : region(h, { id: 'page-body', deps: [model.page, model.titleDraft, model.pages, model.crumbs, model.isInTrash], render: () => pageBody(model, model.page as Page, h) }),
            ] }, h),
        ] }, h),
      ...(model.picker === null ? [] : [pickerView({
        picker: model.picker,
        items: pickerItems(model),
        itemIcon: item => {
          const entry = model.pages.find(page => page.id === item.value || `page:${page.id}` === item.value)
          return entry === undefined ? undefined : pageIcon(entry.icon, h)
        },
        onQuery: query => Message.ChangedPickerQuery({ query }),
        onKey: key => Message.PressedPickerKey({ key }),
        onChoose: value => Message.ChosePicker({ value }),
        onClose: Message.ClosedPicker(),
        ...(model.picker.field === 'search' ? { title: 'Search' } : {}),
      }, h)]),
      ...(model.notice === null ? [] : [box({ class: 'fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md bg-foreground px-3 py-2 text-[13px] text-background', attributes: [h.Id('notice'), h.Role('status')], children: [model.notice, button({ variant: 'ghost', size: 'icon-xs', ariaLabel: 'Dismiss', onClick: Message.ClickedDismissNotice(), children: [Icon.icon('x', { class: 'size-3.5' }, h)] }, h)] }, h)]),
    ] }, h),
})

// PROGRAM

const firstPage = (state: WorkspaceState, memberId: string): string | null => {
  const nav = navOf(state, memberId)
  return nav.favorites[0]?.id ?? nav.workspace[0]?.id ?? nav.private[0]?.id ?? null
}

export const program: Program<Model, Message, ClientMessage, Flags, Workspace> = {
  name: 'page',
  Model,
  ClientMessage,
  flags: request =>
    Effect.gen(function* () {
      const me = yield* requireMember(request)
      const state = yield* Workspace.use(workspace => workspace.current)
      const isTrash = new URL(request.url, 'http://localhost').searchParams.get('trash') === '1'
      const pageId = isTrash ? null : (request.params['id'] ?? firstPage(state, me.id))
      const now = yield* Effect.clockWith(clock => clock.currentTimeMillis)
      const { me: _, ...slice } = sliceOf(state, pageId, me.id, now)
      return { me, view: isTrash ? 'trash' : pageId === null ? 'empty' : 'page', pageId, ...slice }
    }),
  init,
  update,
  view,
  subscriptions,
  clientCommands: {
    LoadUrl: ({ url }) => (typeof url === 'string' ? { load: url } : undefined),
  },
  snapshotDeps: model => [model.picker, model.titleDraft, model.notice],
}

export { PICKER_INPUT_ID, checkedIndex, subtreeOf }
