import { plainText } from '../editor/text'
import { Effect, Match as M, Option, Schema as S, Stream } from 'effect'
import { Command, Subscription, type Update } from 'foldkit'
import type { Attribute, Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import * as Navigation from 'foldkit/navigation'

import { type Program, keyBindings, region, sampleLatest } from '@hyper-effect/core'
import * as Island from '@hyper-effect/island'

import * as Icon from '@/lib/icon'
import { cn } from '@/lib/utils'
import { button } from '@/ui/button'
import { input } from '@/ui/input'
import { textarea } from '@/ui/textarea'

import { requireMember } from '../auth'
import { EMOJI, isEmoji, pickEmoji } from '../emoji'
import { Comment, MAX_COMMENT, Member, Page, Section, formatAgo, sidebarWidth, titleOf } from '../domain'
import * as B from '../editor/blocks'
import { EditorEvent, MemberRef, PageEditor } from '../editor/island'
import { context, renderDocument } from '../editor/render'
import { Document as BlockDocument } from '../editor/schema'
import * as D from '../database'
import { MAX_FORMULA, parse as parseFormula } from '../formula'
import { Viewers, Workspace, type WorkspaceState } from '../store'
import { box, optionRow, pageRoot } from '../view/design'
import { COVERS, COVER_ANCHOR, ICON_ANCHOR, OPTIONS_ANCHOR, PageChange, type HeaderActions, coverPosition, coverView, fontClass, iconAndControls, isCoverName, isCoverUrl, patchOf, pickCover } from './header'
import { avatar, pageIcon } from '../view/icons'
import { ADD_PROPERTY_ANCHOR, LAYOUT_ICON, ADD_VIEW_ANCHOR, PEEK_SCOPE, FILTER_ANCHOR, SORT_ANCHOR, filterAnchor, CELL_INPUT_ID, DB_SEARCH_ID, DatabaseUi, type DatabaseMessages, PROPERTY_NAME_ID, FORMULA_INPUT_ID, ParentDatabase, RelatedDatabase, LinkedPage, RowEntry, activeView, cellAnchor, cellTarget, databaseView, draftOf, emptyUi, headerAnchor, calcAnchor, isComputed, isDay, isMonth, isTyped, parseTarget, propertiesView, viewAnchor } from './database-view'
import { PICKER_INPUT_ID, Picker, type PickerItem, checkedIndex, keyAction, open as openPicker, pickerView } from '../view/picker'
import { Nav, NavDrag, NavDrop, navOf, sameNav, sidebar } from '../view/shell'
import { SearchHit, docText, searchPages, wordCount } from '../search'
import { ancestorsOf, canSee, isTrashed, subtreeOf } from '../workspace'

/* A page of the workspace: the sidebar, the page's top bar (breadcrumbs,
   favorite, •••), its header and its document. `/` shows the first page,
   `/?trash=1` the trash. The sidebar's page menus, "Move to" and search are
   one picker in the Model. */

// MODEL

export const Crumb = S.Struct({ id: S.String, title: S.String, icon: S.String })
export type Crumb = typeof Crumb.Type

export const TrashEntry = S.Struct({ id: S.String, title: S.String, icon: S.String, trashedAt: S.Number, trashedBy: S.NullOr(S.String), path: S.String })
export type TrashEntry = typeof TrashEntry.Type

/** A page someone can see, for search and "Move to". */
export const PageEntry = S.Struct({ id: S.String, title: S.String, icon: S.String, path: S.String, section: Section })
export type PageEntry = typeof PageEntry.Type

export const View = S.Literals(['page', 'trash', 'empty'])
export type View = typeof View.Type

/** Focus to move after the next morph; a new `seq` asks again. */
export const FocusRequest = S.Struct({ selector: S.String, seq: S.Number })

/** A comment as the page shows it, with its author. */
export const CommentEntry = S.Struct({ ...Comment.fields, author: S.NullOr(Member) })
export type CommentEntry = typeof CommentEntry.Type

/** A version in the page history list (its blocks load when it is picked). */
export const VersionEntry = S.Struct({ id: S.String, authorId: S.String, author: S.NullOr(Member), startedAt: S.Number, at: S.Number, title: S.String })
export type VersionEntry = typeof VersionEntry.Type

export const VersionPreview = S.Struct({ versionId: S.String, title: S.String, icon: S.String, content: BlockDocument })
export type VersionPreview = typeof VersionPreview.Type

/** The open history: the picked version, and its blocks once loaded. */
export const History = S.Struct({ selectedId: S.NullOr(S.String), preview: S.NullOr(VersionPreview) })
export type History = typeof History.Type

/** The open comment box: a new discussion, a reply in one, or an edit. */
export const Composer = S.Union([
  S.TaggedStruct('NewDiscussion', { text: S.String }),
  S.TaggedStruct('Reply', { threadId: S.String, text: S.String }),
  S.TaggedStruct('Edit', { commentId: S.String, text: S.String }),
])
export type Composer = typeof Composer.Type

export const Model = S.Struct({
  me: Member,
  view: View,
  pageId: S.NullOr(S.String),
  /** Whether the live connection is open; only then is this person listed as viewing. */
  isConnected: S.Boolean,
  /** Everyone with this page open, this person included. */
  viewers: S.Array(Member),
  /** Null once it is gone (deleted for good, or made private by someone else). */
  page: S.NullOr(Page),
  crumbs: S.Array(Crumb),
  /** Pages that mention or link this one. */
  backlinks: S.Array(Crumb),
  isBacklinksOpen: S.Boolean,
  comments: S.Array(CommentEntry),
  composer: S.NullOr(Composer),
  isShowingResolved: S.Boolean,
  versions: S.Array(VersionEntry),
  history: S.NullOr(History),
  /** Search results for `query`; shown only while the search box still says it. */
  search: S.NullOr(S.Struct({ query: S.String, hits: S.Array(SearchHit) })),
  /** The search palette's "Only titles" filter. */
  isSearchTitlesOnly: S.Boolean,
  /** Filters the Trash list by title and location. */
  trashQuery: S.String,
  /** The page "Delete from Trash" asks about before deleting it for good. */
  confirmDelete: S.NullOr(S.String),
  isFavorite: S.Boolean,
  isInTrash: S.Boolean,
  nav: Nav,
  /** A sidebar row being dragged, and where it would land. */
  navDrag: S.NullOr(NavDrag),
  pages: S.Array(PageEntry),
  /** Who `@` can mention. */
  people: S.Array(MemberRef),
  trash: S.Array(TrashEntry),
  now: S.Number,
  rows: S.Array(RowEntry),
  parentDatabase: S.NullOr(ParentDatabase),
  /** Databases the open one's relations point to, with their rows. */
  related: S.Array(RelatedDatabase),
  /** Every database a relation can point to. */
  databases: S.Array(LinkedPage),
  db: DatabaseUi,
  /** Where an image cover is being dragged to, before "Save position". */
  coverDraft: S.NullOr(S.Number),
  picker: S.NullOr(Picker),
  titleDraft: S.NullOr(S.String),
  notice: S.NullOr(S.String),
  focus: S.NullOr(FocusRequest),
  seq: S.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const PAGE_ACTIONS = ['favorite', 'duplicate', 'move', 'trash', 'open'] as const

export const Message = defineMessageUnion({
  ClickedToggle: { pageId: S.String, isOpen: S.Boolean },
  StartedNavDrag: { pageId: S.String },
  EnteredNavDrop: { drop: NavDrop },
  DroppedNav: {},
  EndedNavDrag: {},
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
  /** Header: "Add icon" picks one at random, like Notion; the icon opens the picker. */
  ClickedAddIcon: {},
  ClickedIcon: {},
  ClickedAddCover: {},
  ClickedCover: {},
  ClickedRemoveCover: {},
  CopiedLink: {},
  ClickedReposition: {},
  MovedCover: { position: S.Number },
  ClickedSaveCover: {},
  ClickedCancelCover: {},
  ClickedPageOptions: {},
  ClickedUnlock: {},
  ClickedRestore: { pageId: S.String },
  ClickedDeleteForever: { pageId: S.String },
  ConfirmedDelete: { pageId: S.String },
  CanceledDelete: {},
  ChangedTrashQuery: { query: S.String },
  ClickedToggleTheme: {},
  ToggledSidebar: { isCollapsed: S.Boolean },
  ResizedSidebar: { width: S.Number },
  ClickedDismissNotice: {},
  ClickedBacklinks: {},
  ClickedAddComment: {},
  ClickedReply: { threadId: S.String },
  ClickedEditComment: { commentId: S.String },
  ChangedComment: { text: S.String },
  SubmittedComment: {},
  ClickedCancelComment: {},
  ClickedResolve: { threadId: S.String, isResolved: S.Boolean },
  ClickedDeleteComment: { commentId: S.String },
  ClickedShowResolved: {},
  ClickedHistory: {},
  ClickedCloseHistory: {},
  ClickedVersion: { versionId: S.String },
  ClickedRestoreVersion: { versionId: S.String },
  GotVersion: { preview: VersionPreview },
  MissedVersion: { versionId: S.String },
  GotSearch: { query: S.String, isTitlesOnly: S.Boolean, hits: S.Array(SearchHit) },
  ToggledSearchTitlesOnly: {},
  GotPage: {
    me: Member,
    page: S.NullOr(Page),
    crumbs: S.Array(Crumb),
    backlinks: S.Array(Crumb),
    comments: S.Array(CommentEntry),
    versions: S.Array(VersionEntry),
    isFavorite: S.Boolean,
    isInTrash: S.Boolean,
    nav: Nav,
    pages: S.Array(PageEntry),
    people: S.Array(MemberRef),
    trash: S.Array(TrashEntry),
    rows: S.Array(RowEntry),
    parentDatabase: S.NullOr(ParentDatabase),
    related: S.Array(RelatedDatabase),
    databases: S.Array(LinkedPage),
    now: S.Number,
  },
  ClickedMakeDatabase: { layout: D.Layout },
  ClickedDbView: { viewId: S.String },
  ClickedViewMenu: { viewId: S.String },
  ClickedAddView: {},
  ClickedHeader: { propertyId: S.String },
  ClickedAddProperty: {},
  ChangedPropertyName: { name: S.String },
  SubmittedPropertyName: {},
  ClickedCalc: { propertyId: S.String },
  ChangedFormula: { expression: S.String },
  SubmittedFormula: {},
  CancelledFormula: {},
  ClickedCell: { rowId: S.String, propertyId: S.String },
  ChangedCell: { text: S.String },
  SubmittedCell: {},
  CanceledCell: {},
  ToggledCell: { rowId: S.String, propertyId: S.String, isChecked: S.Boolean },
  ClickedDateCell: { rowId: S.String, propertyId: S.String },
  ChangedDateMonth: { month: S.String },
  PickedDate: { day: S.String },
  ClearedDate: {},
  ClosedDate: {},
  ClickedNewRow: {},
  ClickedDbSearch: {},
  ChangedDbQuery: { query: S.String },
  ClickedNewInGroup: { key: S.String },
  ClickedNewOnDay: { day: S.String },
  StartedCardDrag: { rowId: S.String },
  EndedCardDrag: {},
  EnteredDropTarget: { key: S.String },
  DroppedCard: { key: S.String },
  ChangedCalendarMonth: { month: S.String },
  ClickedAddFilter: {},
  ClickedFilter: { filterId: S.String },
  ClickedSorts: {},
  ClickedPeek: { rowId: S.String },
  ClosedPeek: {},
  ResizedColumn: { propertyId: S.String, width: S.Number },
  ToggledGroup: { key: S.String, isHidden: S.Boolean },
  SucceededDbChange: { addedId: S.NullOr(S.String), change: D.DatabaseChange },
  SucceededAddRow: { rowId: S.String },
  SucceededCreate: { id: S.String },
  SucceededTrash: { pageId: S.String },
  FailedChange: { reason: S.String },
  CompletedChange: {},
  ChangedConnection: { isConnected: S.Boolean },
  ChangedViewers: { viewers: S.Array(Member) },
  CompletedBrowserAction: {},
})
export type Message = typeof Message.Type

/** What a browser may post (each re-checked in update and by the store). */
export const ClientMessage = S.Union([
  Message.ClickedToggle,
  Message.StartedNavDrag,
  Message.EnteredNavDrop,
  Message.DroppedNav,
  Message.EndedNavDrag,
  Message.ClickedAdd,
  Message.ClickedMenu,
  Message.ClickedSearch,
  Message.PressedPickerKey,
  Message.ChosePicker,
  Message.ClosedPicker,
  Message.SubmittedTitle,
  Message.GotEditorEvent,
  Message.ClickedFavorite,
  Message.ClickedAddIcon,
  Message.ClickedIcon,
  Message.ClickedAddCover,
  Message.ClickedCover,
  Message.ClickedRemoveCover,
  Message.CopiedLink,
  Message.ToggledSearchTitlesOnly,
  Message.ClickedReposition,
  Message.MovedCover,
  Message.ClickedSaveCover,
  Message.ClickedCancelCover,
  Message.ClickedPageOptions,
  Message.ClickedUnlock,
  Message.ClickedRestore,
  Message.ClickedDeleteForever,
  Message.ConfirmedDelete,
  Message.CanceledDelete,
  Message.ClickedToggleTheme,
  Message.ToggledSidebar,
  Message.ResizedSidebar,
  Message.ClickedDismissNotice,
  Message.ClickedBacklinks,
  Message.ClickedAddComment,
  Message.ClickedReply,
  Message.ClickedEditComment,
  Message.SubmittedComment,
  Message.ClickedCancelComment,
  Message.ClickedResolve,
  Message.ClickedDeleteComment,
  Message.ClickedShowResolved,
  Message.ClickedHistory,
  Message.ClickedCloseHistory,
  Message.ClickedVersion,
  Message.ClickedRestoreVersion,
  Message.ClickedMakeDatabase,
  Message.ClickedDbView,
  Message.ClickedViewMenu,
  Message.ClickedAddView,
  Message.ClickedHeader,
  Message.ClickedAddProperty,
  Message.SubmittedPropertyName,
  Message.SubmittedFormula,
  Message.ClickedCalc,
  Message.CancelledFormula,
  Message.ClickedCell,
  Message.SubmittedCell,
  Message.CanceledCell,
  Message.ToggledCell,
  Message.ClickedDateCell,
  Message.ChangedDateMonth,
  Message.PickedDate,
  Message.ClearedDate,
  Message.ClosedDate,
  Message.ClickedNewRow,
  Message.ClickedDbSearch,
  Message.ClickedNewInGroup,
  Message.ClickedNewOnDay,
  Message.StartedCardDrag,
  Message.EndedCardDrag,
  Message.EnteredDropTarget,
  Message.DroppedCard,
  Message.ChangedCalendarMonth,
  Message.ClickedAddFilter,
  Message.ClickedFilter,
  Message.ClickedSorts,
  Message.ClickedPeek,
  Message.ClosedPeek,
  Message.ResizedColumn,
  Message.ToggledGroup,
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

/** Moves focus after the next morph: forwarded as a focus action (see
 *  `clientCommands`). The page asks for focus by setting `model.focus`. */
export const FocusElement = Command.define('FocusElement', {
  args: { selector: S.String },
  messages: [Message.CompletedBrowserAction],
  execute: () => Effect.succeed(Message.CompletedBrowserAction()),
})

export const SaveTitle = Command.define('SaveTitle', {
  args: { pageId: S.String, title: S.String, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ pageId, title, actorId }) =>
    Workspace.use(workspace => workspace.updatePage(pageId, { title }, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const ChangePage = Command.define('ChangePage', {
  args: { pageId: S.String, change: PageChange, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ pageId, change, actorId }) =>
    Workspace.use(workspace => workspace.updatePage(pageId, patchOf(change), actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const MakeDatabase = Command.define('MakeDatabase', {
  args: { pageId: S.String, layout: D.Layout, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ pageId, layout, actorId }) =>
    Workspace.use(workspace => workspace.makeDatabase(pageId, layout, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const ChangeDatabase = Command.define('ChangeDatabase', {
  args: { pageId: S.String, change: D.DatabaseChange, actorId: S.String },
  messages: [Message.SucceededDbChange, Message.FailedChange],
  execute: ({ pageId, change, actorId }) =>
    Workspace.use(workspace => workspace.changeDatabase(pageId, change, actorId)).pipe(
      Effect.map(addedId => Message.SucceededDbChange({ addedId, change })),
      Effect.catchTag('InvalidChange', ({ reason }) => failed(reason)),
    ),
})

export const SetValue = Command.define('SetValue', {
  args: { rowId: S.String, propertyId: S.String, value: S.NullOr(D.Value), actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ rowId, propertyId, value, actorId }) =>
    Workspace.use(workspace => workspace.setValue(rowId, propertyId, value, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

/** "Create …" in a select cell: adds the option, then picks it (keeping `keep` on a multi-select). */
export const CreateOption = Command.define('CreateOption', {
  args: { databaseId: S.String, rowId: S.String, propertyId: S.String, name: S.String, keep: S.NullOr(S.Array(S.String)), actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ databaseId, rowId, propertyId, name, keep, actorId }) =>
    Workspace.use(workspace =>
      Effect.flatMap(workspace.changeDatabase(databaseId, { _tag: 'AddOption', propertyId, name }, actorId), optionId =>
        optionId === null ? Effect.void : workspace.setValue(rowId, propertyId, keep === null ? { _tag: 'OptionValue', optionId } : { _tag: 'OptionsValue', optionIds: [...keep, optionId] }, actorId)),
    ).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const AddRow = Command.define('AddRow', {
  args: { databaseId: S.String, values: D.Values, actorId: S.String },
  messages: [Message.SucceededAddRow, Message.FailedChange],
  execute: ({ databaseId, values, actorId }) =>
    Workspace.use(workspace => workspace.addRow(databaseId, { title: '', values, beforeId: null }, actorId)).pipe(
      Effect.map(row => Message.SucceededAddRow({ rowId: row.id })),
      Effect.catchTag('InvalidChange', ({ reason }) => failed(reason)),
    ),
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

export const AddComment = Command.define('AddComment', {
  args: { pageId: S.String, threadId: S.NullOr(S.String), text: S.String, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ pageId, threadId, text, actorId }) =>
    Workspace.use(workspace => workspace.addComment({ pageId, threadId }, text, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const EditComment = Command.define('EditComment', {
  args: { commentId: S.String, text: S.String, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ commentId, text, actorId }) =>
    Workspace.use(workspace => workspace.editComment(commentId, text, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const DeleteComment = Command.define('DeleteComment', {
  args: { commentId: S.String, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ commentId, actorId }) =>
    Workspace.use(workspace => workspace.deleteComment(commentId, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const ResolveThread = Command.define('ResolveThread', {
  args: { threadId: S.String, isResolved: S.Boolean, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ threadId, isResolved, actorId }) =>
    Workspace.use(workspace => workspace.resolveThread(threadId, isResolved, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
})

export const LoadVersion = Command.define('LoadVersion', {
  args: { versionId: S.String, actorId: S.String },
  messages: [Message.GotVersion, Message.MissedVersion],
  execute: ({ versionId, actorId }) =>
    Workspace.use(workspace => workspace.version(versionId, actorId)).pipe(Effect.map(version =>
      version === null
        ? Message.MissedVersion({ versionId })
        : Message.GotVersion({ preview: { versionId, title: version.title, icon: version.icon, content: version.content } }))),
})

export const SearchPages = Command.define('SearchPages', {
  args: { query: S.String, isTitlesOnly: S.Boolean, actorId: S.String },
  messages: [Message.GotSearch],
  execute: ({ query, isTitlesOnly, actorId }) =>
    Workspace.use(workspace => workspace.current).pipe(Effect.map(state => Message.GotSearch({ query, isTitlesOnly, hits: searchPages(state, actorId, query, isTitlesOnly) }))),
})

export const RestoreVersion = Command.define('RestoreVersion', {
  args: { versionId: S.String, actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ versionId, actorId }) =>
    Workspace.use(workspace => workspace.restoreVersion(versionId, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
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
  args: { pageId: S.String, parentId: S.NullOr(S.String), section: Section, beforeId: S.optionalKey(S.NullOr(S.String)), actorId: S.String },
  messages: [Message.CompletedChange, Message.FailedChange],
  execute: ({ pageId, parentId, section, beforeId, actorId }) =>
    Workspace.use(workspace => workspace.movePage(pageId, { parentId, section, beforeId: beforeId ?? null }, actorId)).pipe(done, Effect.catchTag('InvalidChange', ({ reason }) => failed(reason))),
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

export const SetSidebar = Command.define('SetSidebar', {
  args: { memberId: S.String, width: S.optionalKey(S.Number), isCollapsed: S.optionalKey(S.Boolean) },
  messages: [Message.CompletedChange],
  execute: ({ memberId, ...change }) => Workspace.use(workspace => workspace.setSidebar(memberId, change)).pipe(done),
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

const PREVIEW_LENGTH = 400

/** `titles` names the pages its relations link to. */
export const rowEntryOf = (page: Page, titles: ReadonlyMap<string, string> = new Map()): RowEntry => ({
  id: page.id, title: page.title, icon: page.icon, values: page.values, isLocked: page.isLocked,
  createdAt: page.createdAt, createdBy: page.createdBy, updatedAt: page.updatedAt, updatedBy: page.updatedBy,
  preview: page.content.map(entry => plainText(entry.text).trim()).filter(text => text !== '').join('\n').slice(0, PREVIEW_LENGTH),
  links: Object.fromEntries(Object.values(page.values).flatMap(value => (value._tag === 'RelationValue' ? value.pageIds : [])).flatMap(id => {
    const title = titles.get(id)
    return title === undefined ? [] : [[id, title] as const]
  })),
})

const computedRow = (model: Model, parent: ParentDatabase, row: RowEntry): RowEntry =>
  D.withComputed(parent.database, parent.id, [row], model.related, model.people)[0] ?? row

const titlesOf = (model: Model): ReadonlyMap<string, string> => new Map(model.pages.map(entry => [entry.id, entry.title]))

const pathOf = (state: WorkspaceState, page: Page): string => ancestorsOf(state.pages, page).map(titleOf).join(' / ')

const parentDatabaseOf = (state: WorkspaceState, page: Page | null): ParentDatabase | null => {
  const parent = page?.parentId == null ? undefined : state.pages.find(entry => entry.id === page.parentId)
  return parent?.database == null ? null : { id: parent.id, title: titleOf(parent), database: parent.database }
}

const relatedOf = (state: WorkspaceState, visible: ReadonlyArray<Page>, source: Readonly<{ id: string; database: D.Database }> | null): ReadonlyArray<RelatedDatabase> => {
  if (source === null) return []
  const ids = [...new Set(source.database.properties.flatMap(property => (property.type._tag === 'Relation' ? [property.type.databaseId === '' ? source.id : property.type.databaseId] : [])))]
  return ids.flatMap(id => {
    const target = visible.find(entry => entry.id === id)
    return target?.database == null || isTrashed(state.pages, target) ? [] : [{
      id,
      title: titleOf(target),
      database: target.database,
      rows: visible.filter(entry => entry.parentId === id && entry.trashedAt === null).sort((a, b) => a.position - b.position).map(entry => ({
        id: entry.id, title: entry.title, icon: entry.icon, values: entry.values,
        createdAt: entry.createdAt, createdBy: entry.createdBy, updatedAt: entry.updatedAt, updatedBy: entry.updatedBy,
      })),
    }]
  })
}

export const sliceOf = (state: WorkspaceState, pageId: string | null, memberId: string, now: number): Slice => {
  const found = pageId === null ? undefined : state.pages.find(page => page.id === pageId)
  const page = found !== undefined && canSee(found, memberId) ? found : null
  const visible = state.pages.filter(entry => canSee(entry, memberId))
  const titles = new Map(visible.map(entry => [entry.id, titleOf(entry)]))
  const parentDatabase = parentDatabaseOf(state, page)
  return {
    me: state.members.find(member => member.id === memberId) ?? null,
    page,
    crumbs: page === null ? [] : [...ancestorsOf(state.pages, page), page].map(entry => ({ id: entry.id, title: titleOf(entry), icon: entry.icon })),
    backlinks: page === null ? [] : visible.filter(entry => entry.id !== page.id && !isTrashed(state.pages, entry) && B.mentionsPage(entry.content, page.id)).map(entry => ({ id: entry.id, title: titleOf(entry), icon: entry.icon })),
    comments: page === null ? [] : state.comments.filter(comment => comment.pageId === page.id).map(comment => ({ ...comment, author: state.members.find(member => member.id === comment.authorId) ?? null })),
    versions: page === null ? [] : state.versions.filter(version => version.pageId === page.id).map(({ id, authorId, startedAt, at, title }) => ({ id, authorId, author: state.members.find(member => member.id === authorId) ?? null, startedAt, at, title })),
    isFavorite: page !== null && state.favorites.some(row => row.memberId === memberId && row.pageId === page.id),
    isInTrash: page !== null && isTrashed(state.pages, page),
    nav: navOf(state, memberId),
    pages: visible.filter(entry => !isTrashed(state.pages, entry)).map(entry => ({ id: entry.id, title: titleOf(entry), icon: entry.icon, path: pathOf(state, entry), section: entry.section })),
    people: state.members.map(member => ({ id: member.id, name: member.name })),
    rows: page?.database == null ? [] : visible.filter(entry => entry.parentId === page.id && entry.trashedAt === null).sort((a, b) => a.position - b.position).map(entry => rowEntryOf(entry, titles)),
    parentDatabase,
    related: relatedOf(state, visible, page?.database == null ? parentDatabase : { id: page.id, database: page.database }),
    databases: visible.filter(entry => entry.database !== null && !isTrashed(state.pages, entry)).map(entry => ({ id: entry.id, title: titleOf(entry), icon: entry.icon })),
    trash: visible.filter(entry => entry.trashedAt !== null).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0)).map(entry => ({ id: entry.id, title: titleOf(entry), icon: entry.icon, trashedAt: entry.trashedAt ?? 0, trashedBy: state.members.find(member => member.id === entry.trashedBy)?.name ?? null, path: pathOf(state, entry) })),
    now,
  }
}

const sameSlice = (a: Slice, b: Slice): boolean =>
  a.me === b.me && a.page === b.page && a.isFavorite === b.isFavorite && a.isInTrash === b.isInTrash && sameNav(a.nav, b.nav) &&
  JSON.stringify([a.crumbs, a.backlinks, a.comments, a.versions, a.pages, a.people, a.trash, a.rows, a.parentDatabase, a.related, a.databases]) === JSON.stringify([b.crumbs, b.backlinks, b.comments, b.versions, b.pages, b.people, b.trash, b.rows, b.parentDatabase, b.related, b.databases])

// INIT

export type Flags = Readonly<{ me: Member; view: View; pageId: string | null } & Omit<Slice, 'me'>>

export const init = (flags: Flags): Update.Return<Model, Message, Workspace> => ({
  model: { ...flags, isBacklinksOpen: false, composer: null, isShowingResolved: false, history: null, search: null, trashQuery: '', confirmDelete: null, navDrag: null, coverDraft: null, isConnected: false, viewers: [], isSearchTitlesOnly: false, db: emptyUi, picker: null, titleDraft: null, notice: null, focus: null, seq: 0 },
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
        { value: 'copylink', label: 'Copy link' },
        { value: 'duplicate', label: 'Duplicate', shortcut: 'Ctrl D' },
        { value: 'rename', label: 'Rename' },
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
      return model.search !== null && model.search.query === picker.query
        ? model.search.hits.map(hit => ({
            value: hit.pageId,
            label: hit.title,
            group: picker.query.trim() === '' ? 'Recent' : 'Pages',
            keywords: `${hit.path} ${picker.query}`,
            ...(hit.path === '' ? {} : { hint: hit.path }),
            ...(hit.snippet === null || hit.isTitleMatch ? {} : { detail: hit.snippet }),
          }))
        : model.pages.map(entry => (entry.path === '' ? { value: entry.id, label: entry.title } : { value: entry.id, label: entry.title, keywords: entry.path, hint: entry.path }))
    case 'icon':
      return [
        { value: 'random', label: 'Random', group: 'Actions' },
        ...(model.page?.icon === '' ? [] : [{ value: 'remove', label: 'Remove', group: 'Actions' }]),
        ...EMOJI.map(entry => ({ value: `emoji:${entry.char}`, label: entry.name.split(' ')[0] ?? entry.name, group: entry.group, keywords: entry.name })),
      ]
    case 'cover': {
      const link = picker.query.trim()
      return [
        ...(isCoverUrl(link) ? [{ value: `url:${link}`, label: 'Use this image link', group: 'Link', keywords: link }] : []),
        ...(model.page?.cover._tag === 'NoCover' ? [] : [{ value: 'remove', label: 'Remove cover', group: 'Actions' }]),
        ...COVERS.map(cover => ({ value: `gallery:${cover.name}`, label: cover.label, group: cover.group, isChecked: model.page?.cover._tag === 'GalleryCover' && model.page.cover.name === cover.name })),
      ]
    }
    case 'property':
      return propertyItems(model, picker.pageId)
    case 'propertyType': {
      const current = editableDatabase(model)?.database.properties.find(entry => entry.id === picker.pageId)?.type._tag
      return D.PROPERTY_TAGS.map(tag => ({ value: tag, label: D.TYPE_LABEL[tag], isChecked: tag === current }))
    }
    case 'rollupRelation':
    case 'rollupProperty':
    case 'rollupFn':
      return rollupItems(model, picker.field, picker.pageId)
    case 'rename': {
      const title = picker.query.trim()
      return title === '' ? [] : [{ value: 'rename', label: `Rename to “${title}”`, keywords: title, hint: 'Enter' }]
    }
    case 'idPrefix': {
      const property = editableDatabase(model)?.database.properties.find(entry => entry.id === picker.pageId)
      if (property?.type._tag !== 'Id') return []
      const prefix = picker.query.trim()
      return [
        ...(prefix !== '' && D.isIdPrefix(prefix) ? [{ value: 'set', label: `Use ${D.idText(prefix, 1)}`, hint: 'Prefix' }] : []),
        ...(property.type.prefix === '' ? [] : [{ value: 'clear', label: 'No prefix', hint: D.idText('', 1) }]),
      ]
    }
    case 'calculate': {
      const page = editableDatabase(model)
      const view = page === null ? null : activeView(page.database, model.db)
      if (page === null || view === null) return []
      const property = picker.pageId === D.TITLE ? null : D.propertyOf(page.database, picker.pageId)
      const current = D.calcOf(view, picker.pageId)
      return D.calcFnsFor(property).map(fn => ({ value: fn, label: D.CALC_LABEL[fn], isChecked: fn === current }))
    }
    case 'relation': {
      const page = editableDatabase(model)
      const property = page?.database.properties.find(entry => entry.id === picker.pageId)
      const current = property?.type._tag === 'Relation' ? property.type.databaseId : null
      return [
        { value: 'self', label: 'This database', isChecked: current === '' || current === page?.id },
        ...model.databases.filter(entry => entry.id !== page?.id).map(entry => ({ value: `db:${entry.id}`, label: entry.title, isChecked: current === entry.id })),
      ]
    }
    case 'addProperty':
      return D.PROPERTY_TAGS.map(tag => ({ value: tag, label: D.TYPE_LABEL[tag], group: 'Type' }))
    case 'cell':
    case 'cells':
      return cellItems(model, picker.pageId, picker.query)
    case 'view':
      return [
        ...(picker.query.trim() === '' ? [] : [{ value: 'rename', label: `Rename to "${picker.query.trim()}"`, keywords: picker.query }]),
        ...D.LAYOUTS.map(layout => ({ value: `layout:${layout}`, label: D.LAYOUT_LABEL[layout], group: 'Layout', isChecked: viewById(model, picker.pageId)?.layout === layout })),
        ...(viewById(model, picker.pageId)?.layout === 'calendar'
          ? (model.page?.database?.properties ?? []).filter(property => ['Date', 'CreatedTime', 'LastEditedTime'].includes(property.type._tag)).map(property => ({ value: `date:${property.id}`, label: property.name, group: 'Calendar by', isChecked: viewById(model, picker.pageId)?.dateBy === property.id }))
          : [
              { value: 'group:', label: 'None', group: 'Group by', isChecked: viewById(model, picker.pageId)?.groupBy === null },
              ...(model.page?.database?.properties ?? []).filter(D.canGroupBy).map(property => ({ value: `group:${property.id}`, label: property.name, group: 'Group by', isChecked: viewById(model, picker.pageId)?.groupBy === property.id })),
            ]),
        ...(viewById(model, picker.pageId)?.layout === 'gallery' ? D.CARD_SIZES.map(size => ({ value: `size:${size}`, label: D.CARD_SIZE_LABEL[size], group: 'Card size', isChecked: (viewById(model, picker.pageId)?.cardSize ?? 'medium') === size })) : []),
        ...D.OPEN_INS.map(openIn => { const target = viewById(model, picker.pageId); return { value: `open:${openIn}`, label: D.OPEN_IN_LABEL[openIn], group: 'Open pages in', isChecked: target !== undefined && target !== null && D.openInOf(target) === openIn } }),
        { value: 'duplicate', label: 'Duplicate view' },
        ...((model.page?.database?.views.length ?? 0) > 1 ? [{ value: 'delete', label: 'Delete view' }] : []),
      ]
    case 'addFilter': {
      const properties = editableDatabase(model)?.database.properties ?? []
      return [{ value: D.TITLE, label: 'Name', group: 'Filter by' }, ...properties.map(property => ({ value: property.id, label: property.name, group: 'Filter by' }))]
    }
    case 'filter':
      return filterItems(model, picker.pageId, picker.query)
    case 'sorts':
      return sortItems(model)
    case 'addView':
      return D.LAYOUTS.map(layout => ({ value: `layout:${layout}`, label: D.LAYOUT_LABEL[layout], group: 'Layout' }))
    case 'options': {
      const page = model.page
      if (page === null) return []
      return [
        { value: 'font:default', label: 'Default', group: 'Style', isChecked: page.font === 'default' },
        { value: 'font:serif', label: 'Serif', group: 'Style', isChecked: page.font === 'serif' },
        { value: 'font:mono', label: 'Mono', group: 'Style', isChecked: page.font === 'mono' },
        { value: 'small', label: 'Small text', group: 'Page', isChecked: page.isSmallText },
        { value: 'full', label: 'Full width', group: 'Page', isChecked: page.isFullWidth },
        { value: 'lock', label: 'Lock page', group: 'Page', isChecked: page.isLocked },
        { value: 'history', label: 'Page history', group: 'Page' },
        { value: 'favorite', label: model.isFavorite ? 'Remove from Favorites' : 'Add to Favorites', group: 'Page' },
        { value: 'copylink', label: 'Copy link', group: 'Page', shortcut: 'Ctrl L' },
        { value: 'duplicate', label: 'Duplicate', group: 'Page', shortcut: 'Ctrl D' },
        { value: 'move', label: 'Move to', group: 'Page', shortcut: 'Ctrl Shift P' },
        { value: 'trash', label: 'Move to Trash', group: 'Page' },
      ]
    }
  }
}

/** The page whose look may change: open, not in Trash, and (for the look) not locked. */
const changeable = (model: Model, isLockAllowed = false): Page | null =>
  model.page === null || model.isInTrash || (model.page.isLocked && !isLockAllowed) ? null : model.page

const change = (model: Model, page: Page, pageChange: PageChange): UpdateReturn => ({ model: { ...model, picker: null }, commands: [ChangePage({ pageId: page.id, change: pageChange, actorId: model.me.id })] })

const FONTS: ReadonlyArray<Page['font']> = ['default', 'serif', 'mono']

/** A choice in the icon, cover or ••• picker; each value is checked again here. */
const chooseLook = (model: Model, picker: Picker, value: string): UpdateReturn => {
  const closed = { ...model, picker: null }
  const page = changeable(model, picker.field === 'options')
  if (page === null || page.id !== picker.pageId) return { model: closed }
  switch (picker.field) {
    case 'icon': {
      const char = value.startsWith('emoji:') ? value.slice(6) : ''
      return value === 'random' ? change(model, page, { _tag: 'SetIcon', icon: pickEmoji(`${page.id}:${page.updatedAt}:${page.icon}`) })
        : value === 'remove' ? change(model, page, { _tag: 'SetIcon', icon: '' })
        : isEmoji(char) ? change(model, page, { _tag: 'SetIcon', icon: char })
        : { model: closed }
    }
    case 'cover': {
      if (value === 'remove') return change(model, page, { _tag: 'SetCover', cover: { _tag: 'NoCover' } })
      if (value.startsWith('gallery:') && isCoverName(value.slice(8))) return change(model, page, { _tag: 'SetCover', cover: { _tag: 'GalleryCover', name: value.slice(8) } })
      if (value.startsWith('url:') && isCoverUrl(value.slice(4))) return change(model, page, { _tag: 'SetCover', cover: { _tag: 'ImageCover', url: value.slice(4) } })
      return { model: closed }
    }
    default: {
      if (value === 'history') return openHistory(model)
      const font = FONTS.find(entry => `font:${entry}` === value)
      if (page.isLocked && value !== 'lock') return value === 'favorite' || value === 'duplicate' || value === 'move' || value === 'copylink' ? choose(model, { ...picker, field: 'page' }, value) : { model: closed }
      if (font !== undefined) return change(model, page, { _tag: 'SetFont', font })
      switch (value) {
        case 'small': return change(model, page, { _tag: 'SetSmallText', isOn: !page.isSmallText })
        case 'full': return change(model, page, { _tag: 'SetFullWidth', isOn: !page.isFullWidth })
        case 'lock': return change(model, page, { _tag: 'SetLocked', isOn: !page.isLocked })
        default: return choose(model, { ...picker, field: 'page' }, value)
      }
    }
  }
}

/** A sidebar row and the rows open under it, in either section ('' rows when it is not there). */
const visibleSubtree = (nav: Nav, pageId: string): ReadonlySet<string> => {
  for (const rows of [nav.workspace, nav.private]) {
    const at = rows.findIndex(row => row.id === pageId)
    if (at < 0) continue
    const depth = rows[at]?.depth ?? 0
    const end = rows.findIndex((row, index) => index > at && row.depth <= depth)
    return new Set(rows.slice(at, end < 0 ? undefined : end).map(row => row.id))
  }
  return new Set()
}

/** A sidebar drop: above a row makes the page its sibling there, onto a row
 *  its last child (and opens it), the end of a section its last page. Never
 *  onto the page itself or into its own subtree (the workspace checks too). */
const dropNav = (model: Model, drag: NavDrag | null): UpdateReturn => {
  if (drag === null || drag.target === null) return { model }
  const { pageId, target } = drag
  const actorId = model.me.id
  if (visibleSubtree(model.nav, pageId).size === 0) return { model }
  if (target.place === 'end') return { model, commands: [MovePage({ pageId, parentId: null, section: target.section, beforeId: null, actorId })] }
  const row = model.nav[target.section].find(entry => entry.id === target.rowId)
  if (row === undefined || visibleSubtree(model.nav, pageId).has(row.id)) return { model }
  return target.place === 'before'
    ? { model, commands: [MovePage({ pageId, parentId: row.parentId, section: target.section, beforeId: row.id, actorId })] }
    : { model, commands: [MovePage({ pageId, parentId: row.id, section: target.section, beforeId: null, actorId }), ...(row.isOpen ? [] : [SetExpanded({ pageId: row.id, isOpen: true, actorId })])] }
}

const focusOn = (model: Model, selector: string): Model => ({ ...model, seq: model.seq + 1, focus: { selector, seq: model.seq + 1 } })

/** Opens the picker with its query focused, so typing and Esc go to it. */
const withPicker = (model: Model, picker: Picker): Model => focusOn({ ...model, picker }, `#${PICKER_INPUT_ID}`)

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
        case 'move': return { model: withPicker(model, openPicker('move', picker.pageId, picker.anchor)) }
        case 'trash': return { model: closed, commands: [TrashPage({ pageId: picker.pageId, actorId })] }
        // public/copy-link.js writes the address while the click is still a user gesture.
        case 'copylink': return { model: { ...closed, notice: 'Copied link to clipboard' } }
        case 'rename': {
          const title = model.pages.find(entry => entry.id === picker.pageId)?.title ?? ''
          return { model: withPicker(model, { ...openPicker('rename', picker.pageId, picker.anchor), query: title }) }
        }
        case 'open': return { model: closed, commands: [LoadUrl({ url: `/p/${picker.pageId}` })] }
        default: return { model: closed }
      }
    case 'rename': {
      const title = picker.query.trim()
      return value !== 'rename' || title === '' || !isKnown(model, picker.pageId)
        ? { model: closed }
        : { model: closed, commands: [SaveTitle({ pageId: picker.pageId, title, actorId })] }
    }
    case 'icon':
    case 'cover':
    case 'options':
      return chooseLook(model, picker, value)
    case 'cell':
    case 'cells':
      return chooseCell(model, picker, value)
    case 'property':
    case 'propertyType':
    case 'relation':
    case 'rollupRelation':
    case 'rollupProperty':
    case 'rollupFn':
    case 'calculate':
    case 'idPrefix':
    case 'addProperty':
    case 'view':
    case 'addView':
    case 'addFilter':
    case 'filter':
    case 'sorts':
      return chooseDatabase(model, picker, value)
    case 'move': {
      if (value === 'section:workspace' || value === 'section:private') return { model: closed, commands: [MovePage({ pageId: picker.pageId, parentId: null, section: value === 'section:private' ? 'private' : 'workspace', actorId })] }
      const parentId = value.startsWith('page:') ? value.slice(5) : ''
      const parent = model.pages.find(entry => entry.id === parentId)
      return parent === undefined ? { model: closed } : { model: closed, commands: [MovePage({ pageId: picker.pageId, parentId, section: parent.section, actorId })] }
    }
  }
}

// DATABASES

/** The open database page, when its schema and rows may change. */
const editableDatabase = (model: Model): (Page & { database: D.Database }) | null =>
  model.page !== null && model.page.database !== null && !model.isInTrash && !model.page.isLocked ? (model.page as Page & { database: D.Database }) : null

type CellTarget = Readonly<{ databaseId: string; database: D.Database; row: RowEntry; property: D.Property | null; isEditable: boolean }>

/** A cell of the open database, or a property of the open row page. */
const cellOf = (model: Model, rowId: string, propertyId: string): CellTarget | null => {
  const page = model.page
  if (page === null) return null
  const source = page.database !== null
    ? { databaseId: page.id, database: page.database, row: model.rows.find(row => row.id === rowId), isLocked: page.isLocked }
    : model.parentDatabase !== null && rowId === page.id ? { databaseId: model.parentDatabase.id, database: model.parentDatabase.database, row: rowEntryOf(page, titlesOf(model)), isLocked: false } : null
  if (source === null || source.row === undefined) return null
  const property = propertyId === D.TITLE ? null : source.database.properties.find(entry => entry.id === propertyId)
  if (property === undefined) return null
  return { databaseId: source.databaseId, database: source.database, row: source.row, property, isEditable: !model.isInTrash && !source.isLocked && !source.row.isLocked && (property === null || !isComputed(property)) }
}

const withDb = (model: Model, db: Partial<DatabaseUi>): Model => ({ ...model, db: { ...model.db, ...db } })

const changeDb = (model: Model, page: Page, change: D.DatabaseChange): UpdateReturn => ({ model: { ...model, picker: null }, commands: [ChangeDatabase({ pageId: page.id, change, actorId: model.me.id })] })

const setValue = (model: Model, cell: CellTarget, value: D.Value | null): UpdateReturn => {
  if (cell.property === null) return { model }
  const checked = value === null ? null : D.checkValue(cell.property, value, model.people)
  return typeof checked === 'string'
    ? { model: { ...model, notice: checked } }
    : { model, commands: [SetValue({ rowId: cell.row.id, propertyId: cell.property.id, value: checked, actorId: model.me.id })] }
}

const selectedIds = (cell: CellTarget): ReadonlyArray<string> => {
  const value = cell.property === null ? undefined : D.valueOf(cell.property, cell.row)
  return value?._tag === 'OptionValue' ? [value.optionId] : value?._tag === 'OptionsValue' ? value.optionIds : value?._tag === 'PeopleValue' ? value.memberIds : value?._tag === 'RelationValue' ? value.pageIds : []
}

/** Opens a cell: typed cells get an input, option and person cells a picker. */
/** Cells of the peeked row are the peek's; the table's copy stays put. */
const scopeOf = (model: Model, rowId: string): string => (model.db.peek === rowId ? PEEK_SCOPE : '')

const openCell = (model: Model, rowId: string, propertyId: string): UpdateReturn => {
  const cell = cellOf(model, rowId, propertyId)
  if (cell === null || !cell.isEditable) return { model }
  const { property } = cell
  if (isTyped(property)) return { model: focusOn(withDb({ ...model, picker: null }, { editing: { rowId, propertyId, draft: draftOf(property, cell.row) }, datePick: null }), `#${CELL_INPUT_ID}`) }
  if (property === null) return { model }
  switch (property.type._tag) {
    case 'Select': case 'Status':
      return { model: withPicker(model, openPicker('cell', cellTarget(rowId, propertyId), cellAnchor(rowId, propertyId, scopeOf(model, rowId)))) }
    case 'MultiSelect': case 'Person': case 'Relation':
      return { model: withPicker(model, openPicker('cells', cellTarget(rowId, propertyId), cellAnchor(rowId, propertyId, scopeOf(model, rowId)))) }
    case 'Checkbox':
    {
      const value = D.valueOf(property, cell.row)
      return setValue(model, cell, { _tag: 'CheckboxValue', isChecked: !(value?._tag === 'CheckboxValue' && value.isChecked) })
    }
    case 'Date': {
      const value = D.valueOf(property, cell.row)
      return { model: withDb({ ...model, picker: null }, { datePick: { rowId, propertyId, month: (value?._tag === 'DateValue' ? value.start : todayOf(model)).slice(0, 7) }, editing: null }) }
    }
    default:
      return { model }
  }
}

const viewById = (model: Model, viewId: string): D.DatabaseView | null =>
  model.page?.database?.views.find(view => view.id === viewId) ?? null

/** Whether `key` names a group of `property` (an option, a person, checked or not, or none). */
const isGroupKey = (property: D.Property, key: string, people: ReadonlyArray<D.Person>): boolean =>
  key === D.NO_GROUP
    ? property.type._tag !== 'Checkbox'
    : property.type._tag === 'Checkbox' ? key === 'checked' || key === 'unchecked'
      : property.type._tag === 'Person' ? people.some(member => member.id === key)
        : D.optionsOf(property).some(option => option.id === key)

/** A card dropped on a board column takes that group's value; one dropped on a
 *  calendar day moves its date there, keeping the length of a range. */
const dropCard = (model: Model, rowId: string | null, key: string): UpdateReturn => {
  const page = editableDatabase(model)
  const view = page === null ? null : activeView(page.database, model.db)
  if (page === null || view === null || rowId === null) return { model }
  if (view.layout === 'board') {
    const cell = view.groupBy === null ? null : cellOf(model, rowId, view.groupBy)
    if (cell === null || cell.property === null || !cell.isEditable || !isGroupKey(cell.property, key, model.people)) return { model }
    const current = D.valueOf(cell.property, cell.row)
    const next = cell.property.type._tag === 'MultiSelect' && current?._tag === 'OptionsValue' && key !== D.NO_GROUP
      ? { _tag: 'OptionsValue' as const, optionIds: [...current.optionIds.filter(id => !D.groupRows(cell.property!, [cell.row], model.people).some(group => group.key === id && group.rows.length > 0)), key] }
      : cell.property.type._tag === 'Person' && key !== D.NO_GROUP ? { _tag: 'PeopleValue' as const, memberIds: [key] } : D.valueForGroup(cell.property, key, current)
    return setValue(model, cell, next)
  }
  if (view.layout === 'calendar') {
    const cell = view.dateBy === null ? null : cellOf(model, rowId, view.dateBy)
    if (cell === null || cell.property?.type._tag !== 'Date' || !cell.isEditable || !isDay(key)) return { model }
    const current = D.valueOf(cell.property, cell.row)
    const end = current?._tag === 'DateValue' && current.end !== null
      ? new Date(Date.parse(`${key}T00:00:00Z`) + (Date.parse(`${current.end.slice(0, 10)}T00:00:00Z`) - Date.parse(`${current.start.slice(0, 10)}T00:00:00Z`))).toISOString().slice(0, 10)
      : null
    return setValue(model, cell, { _tag: 'DateValue', start: key, end })
  }
  return { model }
}

const todayOf = (model: Model): string => new Date(model.now).toISOString().slice(0, 10)

/** Enter or leaving the input saves a typed cell; an unparsable number is refused. */
const submitCell = (model: Model): UpdateReturn => {
  const editing = model.db.editing
  if (editing === null) return { model }
  const closed = withDb(model, { editing: null })
  const cell = cellOf(model, editing.rowId, editing.propertyId)
  if (cell === null || !cell.isEditable || editing.draft === draftOf(cell.property, cell.row)) return { model: closed }
  if (cell.property === null) return { model: closed, commands: [SaveTitle({ pageId: cell.row.id, title: editing.draft, actorId: model.me.id })] }
  if (cell.property.type._tag === 'Number') {
    const value = D.parseNumber(editing.draft, cell.property.type.format)
    return value === 'invalid' ? { model: { ...closed, notice: 'Enter a number.' } } : setValue(closed, cell, value === null ? null : { _tag: 'NumberValue', value })
  }
  return setValue(closed, cell, editing.draft.trim() === '' ? null : { _tag: 'TextValue', text: editing.draft.trim() })
}

const pickDate = (model: Model, day: string | null): UpdateReturn => {
  const pick = model.db.datePick
  if (pick === null) return { model }
  const closed = withDb(model, { datePick: null })
  const cell = cellOf(model, pick.rowId, pick.propertyId)
  return cell === null || !cell.isEditable || (day !== null && !D.DATE_PATTERN.test(day)) ? { model: closed } : setValue(closed, cell, day === null ? null : { _tag: 'DateValue', start: day, end: null })
}

const relationName = (model: Model, databaseId: string): string =>
  databaseId === '' ? 'This database' : model.databases.find(entry => entry.id === databaseId)?.title ?? 'Untitled'

type RollupType = Extract<D.PropertyType, { _tag: 'Rollup' }>
type EditableDatabase = Readonly<{ id: string; database: D.Database }>

/** The database a rollup's relation points to. */
const rollupTarget = (model: Model, page: EditableDatabase, relationId: string): RelatedDatabase | undefined => {
  const relation = D.propertyOf(page.database, relationId)
  if (relation?.type._tag !== 'Relation') return undefined
  const targetId = relation.type.databaseId === '' ? page.id : relation.type.databaseId
  return model.related.find(entry => entry.id === targetId)
}

const rollupMenu = (model: Model, page: EditableDatabase, type: RollupType): ReadonlyArray<PickerItem> => {
  const target = type.targetId === D.TITLE ? 'Name' : rollupTarget(model, page, type.relationId)?.database.properties.find(entry => entry.id === type.targetId)?.name
  return [
    { value: 'rollup:relation', label: 'Relation', group: 'Rollup', hint: D.propertyOf(page.database, type.relationId)?.name ?? 'None' },
    { value: 'rollup:property', label: 'Property', group: 'Rollup', hint: target ?? 'None' },
    { value: 'rollup:fn', label: 'Calculate', group: 'Rollup', hint: D.ROLLUP_LABEL[type.fn] },
  ]
}

const rollupItems = (model: Model, field: 'rollupRelation' | 'rollupProperty' | 'rollupFn', propertyId: string): ReadonlyArray<PickerItem> => {
  const page = editableDatabase(model)
  const property = page?.database.properties.find(entry => entry.id === propertyId)
  if (page === null || property?.type._tag !== 'Rollup') return []
  const type = property.type
  switch (field) {
    case 'rollupRelation':
      return page.database.properties.filter(entry => entry.type._tag === 'Relation').map(entry => ({ value: entry.id, label: entry.name, isChecked: entry.id === type.relationId }))
    case 'rollupProperty': {
      const target = rollupTarget(model, page, type.relationId)
      return target === undefined ? [] : [
        { value: D.TITLE, label: 'Name', isChecked: type.targetId === D.TITLE },
        ...target.database.properties.filter(entry => entry.type._tag !== 'Rollup').map(entry => ({ value: entry.id, label: entry.name, isChecked: entry.id === type.targetId })),
      ]
    }
    case 'rollupFn':
      return D.ROLLUP_FNS.map(fn => ({ value: fn, label: D.ROLLUP_LABEL[fn], isChecked: fn === type.fn }))
  }
}

/** Where Insert left/right puts a new property: its picker holds `insert:<side>:<property id>`. */
const besideOf = (pickerId: string): { readonly beside?: { readonly propertyId: string; readonly isBefore: boolean } } => {
  const [, side, propertyId] = /^insert:(left|right):(.+)$/.exec(pickerId) ?? []
  return side === undefined || propertyId === undefined ? {} : { beside: { propertyId, isBefore: side === 'left' } }
}

const propertyItems = (model: Model, propertyId: string): ReadonlyArray<PickerItem> => {
  const page = editableDatabase(model)
  const view = page === null ? null : activeView(page.database, model.db)
  const sort = view?.sorts.find(entry => entry.propertyId === propertyId)
  const sorts = [
    { value: 'sort:asc', label: 'Sort ascending', group: 'Sort', isChecked: sort !== undefined && !sort.isDescending },
    { value: 'sort:desc', label: 'Sort descending', group: 'Sort', isChecked: sort?.isDescending === true },
    ...(sort === undefined ? [] : [{ value: 'sort:none', label: 'Remove sort', group: 'Sort' }]),
    { value: 'filter', label: 'Filter', group: 'View' },
  ]
  const property = page?.database.properties.find(entry => entry.id === propertyId)
  const insertRight = { value: 'insert:right', label: 'Insert right', group: 'Property' }
  if (property === undefined) return [...sorts, insertRight]
  return [
    { value: 'rename', label: 'Rename', group: 'Property' },
    { value: 'type', label: 'Change type', group: 'Property', hint: D.TYPE_LABEL[property.type._tag] },
    ...(property.type._tag === 'Relation' ? [{ value: 'relate', label: 'Related to', group: 'Property', hint: relationName(model, property.type.databaseId) }] : []),
    ...(property.type._tag === 'Rollup' && page !== null ? rollupMenu(model, page, property.type) : []),
    ...(property.type._tag === 'Formula' ? [{ value: 'formula', label: 'Edit formula', group: 'Property' }] : []),
    ...(property.type._tag === 'Id' ? [{ value: 'prefix', label: 'Prefix', group: 'Property', hint: property.type.prefix === '' ? 'None' : property.type.prefix }] : []),
    ...sorts,
    { value: 'hide', label: 'Hide in view', group: 'View' },
    { value: 'insert:left', label: 'Insert left', group: 'Property' },
    insertRight,
    { value: 'duplicate', label: 'Duplicate property', group: 'Property' },
    { value: 'delete', label: 'Delete property', group: 'Property' },
  ]
}

/** The rows a relation can link to. */
const relatedRows = (model: Model, databaseId: string, property: D.Property): ReadonlyArray<LinkedPage> => {
  const targetId = property.type._tag !== 'Relation' ? null : property.type.databaseId === '' ? databaseId : property.type.databaseId
  return model.related.find(entry => entry.id === targetId)?.rows ?? []
}

const cellItems = (model: Model, target: string, query: string): ReadonlyArray<PickerItem> => {
  const ref = parseTarget(target)
  const cell = ref === null ? null : cellOf(model, ref.rowId, ref.propertyId)
  if (cell?.property == null) return []
  const chosen = selectedIds(cell)
  if (cell.property.type._tag === 'Relation') return relatedRows(model, cell.databaseId, cell.property).map(row => ({ value: `option:${row.id}`, label: row.title === '' ? 'Untitled' : row.title, isChecked: chosen.includes(row.id) }))
  if (cell.property.type._tag === 'Person') return model.people.map(person => ({ value: `option:${person.id}`, label: person.name, isChecked: chosen.includes(person.id) }))
  const options = D.optionsOf(cell.property)
  const name = query.trim()
  const canCreate = cell.property.type._tag !== 'Status' && name !== '' && !options.some(option => option.name.toLowerCase() === name.toLowerCase())
  return [
    ...options.map(option => ({ value: `option:${option.id}`, label: option.name, isChecked: chosen.includes(option.id), ...('group' in option ? { group: option.group === 'todo' ? 'To-do' : option.group === 'inProgress' ? 'In progress' : 'Complete' } : {}) })),
    ...(canCreate ? [{ value: 'create', label: `Create "${name}"`, keywords: name }] : []),
  ]
}

const chooseCell = (model: Model, picker: Picker, value: string): UpdateReturn => {
  const ref = parseTarget(picker.pageId)
  const cell = ref === null ? null : cellOf(model, ref.rowId, ref.propertyId)
  const closed = { ...model, picker: null }
  if (cell?.property == null || !cell.isEditable) return { model: closed }
  const isMulti = picker.field === 'cells'
  const next = isMulti ? { ...model, picker: { ...picker, query: '' } } : closed
  const chosen = selectedIds(cell)
  if (value === 'create') {
    const name = picker.query.trim()
    return name === '' ? { model: next } : { model: next, commands: [CreateOption({ databaseId: cell.databaseId, rowId: cell.row.id, propertyId: cell.property.id, name, keep: isMulti ? chosen : null, actorId: model.me.id })] }
  }
  const id = value.startsWith('option:') ? value.slice(7) : ''
  if (id === '') return { model: next }
  if (!isMulti) return setValue(next, cell, chosen.includes(id) ? null : { _tag: 'OptionValue', optionId: id })
  const ids = chosen.includes(id) ? chosen.filter(entry => entry !== id) : [...chosen, id]
  return setValue(next, cell, ids.length === 0 ? null : cell.property.type._tag === 'Person' ? { _tag: 'PeopleValue', memberIds: ids } : cell.property.type._tag === 'Relation' ? { _tag: 'RelationValue', pageIds: ids } : { _tag: 'OptionsValue', optionIds: ids })
}

/** The open filter of the active view, with its property (null: the title). */
const filterAt = (model: Model, filterId: string) => {
  const page = editableDatabase(model)
  const view = page === null ? null : activeView(page.database, model.db)
  const filter = view?.filters.find(entry => entry.id === filterId)
  if (page === null || view === null || filter === undefined) return null
  const property = filter.propertyId === D.TITLE ? null : D.propertyOf(page.database, filter.propertyId)
  return filter.propertyId !== D.TITLE && property === null ? null : { page, view, filter, property }
}

/** Ids a filter on `property` can pick from: its options or the people. */
const pickableOf = (model: Model, property: D.Property | null): ReadonlyArray<Readonly<{ id: string; name: string }>> | null => {
  switch (property?.type._tag) {
    case 'Select': case 'Status': case 'MultiSelect': return D.optionsOf(property)
    case 'Person': case 'CreatedBy': case 'LastEditedBy': return model.people
    case 'Relation': return model.page === null ? [] : relatedRows(model, model.page.id, property).map(row => ({ id: row.id, name: row.title === '' ? 'Untitled' : row.title }))
    default: return null
  }
}

const filterItems = (model: Model, filterId: string, query: string): ReadonlyArray<PickerItem> => {
  const at = filterAt(model, filterId)
  if (at === null) return []
  const { filter, property } = at
  const pickable = pickableOf(model, property)
  const typed = query.trim()
  return [
    ...D.operatorsFor(property).map(operator => ({ value: `op:${operator}`, label: D.OPERATOR_LABEL[operator], group: 'Condition', isChecked: filter.operator === operator })),
    ...(D.isUnary(filter.operator) ? [] : pickable !== null
      ? pickable.map(entry => ({ value: `value:${entry.id}`, label: entry.name, group: 'Value', isChecked: filter.value === entry.id }))
      : [
          ...(typed === '' ? [] : [{ value: 'set', label: `Set to "${typed}"`, group: 'Value', keywords: query }]),
          ...(filter.value === '' ? [] : [{ value: 'clear', label: `Clear "${filter.value}"`, group: 'Value' }]),
        ]),
    { value: 'remove', label: 'Delete filter', group: 'Filter' },
  ]
}

const sortItems = (model: Model): ReadonlyArray<PickerItem> => {
  const page = editableDatabase(model)
  const view = page === null ? null : activeView(page.database, model.db)
  if (page === null || view === null) return []
  const nameOf = (propertyId: string) => (propertyId === D.TITLE ? 'Name' : (D.propertyOf(page.database, propertyId)?.name ?? ''))
  return [
    ...view.sorts.flatMap((sort, index) => [
      { value: `flip:${sort.propertyId}`, label: `${nameOf(sort.propertyId)}: ${sort.isDescending ? 'Descending' : 'Ascending'}`, group: 'Sorts', hint: 'Flip' },
      ...(index === 0 ? [] : [{ value: `up:${sort.propertyId}`, label: `Move ${nameOf(sort.propertyId)} up`, group: 'Sorts' }]),
      { value: `remove:${sort.propertyId}`, label: `Remove ${nameOf(sort.propertyId)}`, group: 'Sorts' },
    ]),
    ...[D.TITLE, ...page.database.properties.map(property => property.id)].filter(id => !view.sorts.some(sort => sort.propertyId === id)).map(id => ({ value: `add:${id}`, label: nameOf(id), group: 'Add a sort' })),
    ...(view.sorts.length === 0 ? [] : [{ value: 'clear', label: 'Delete all sorts', group: 'Sorts' }]),
  ]
}

/** A view change that keeps its menu open, as filter and sort menus stay while you adjust them. */
const changeKeeping = (model: Model, picker: Picker, page: Page, changes: ReadonlyArray<D.DatabaseChange>): UpdateReturn =>
  ({ model: { ...model, picker: { ...picker, query: '' } }, commands: changes.map(change => ChangeDatabase({ pageId: page.id, change, actorId: model.me.id })) })

const chooseFilter = (model: Model, picker: Picker, page: Page, view: D.DatabaseView | null, value: string): UpdateReturn => {
  const at = filterAt(model, picker.pageId)
  if (at === null || view === null) return { model: { ...model, picker: null } }
  const { filter, property } = at
  const set = (operator: D.Operator, next: string) => changeKeeping(model, picker, page, [{ _tag: 'SetFilter', viewId: view.id, filterId: filter.id, operator, value: next }])
  const valued = D.isUnary(filter.operator) ? (D.operatorsFor(property).find(operator => !D.isUnary(operator)) ?? filter.operator) : filter.operator
  if (value.startsWith('op:')) {
    const operator = value.slice(3)
    return S.is(D.Operator)(operator) && D.operatorsFor(property).includes(operator) ? set(operator, filter.value) : { model }
  }
  if (value.startsWith('value:')) {
    const id = value.slice(6)
    return pickableOf(model, property)?.some(entry => entry.id === id) === true ? set(valued, filter.value === id ? '' : id) : { model }
  }
  switch (value) {
    case 'set': {
      const typed = picker.query.trim()
      const tag = property?.type._tag ?? 'Title'
      if (typed === '' || pickableOf(model, property) !== null) return { model }
      if (tag === 'Number' && !Number.isFinite(Number(typed))) return { model: { ...model, notice: 'Enter a number.' } }
      if ((tag === 'Date' || tag === 'CreatedTime' || tag === 'LastEditedTime') && !isDay(typed)) return { model: { ...model, notice: 'Enter a date as YYYY-MM-DD.' } }
      return set(valued, typed)
    }
    case 'clear': return set(filter.operator, '')
    case 'remove': return changeDb(model, page, { _tag: 'RemoveFilter', viewId: view.id, filterId: filter.id })
    default: return { model }
  }
}

const chooseSort = (model: Model, picker: Picker, page: Page & { database: D.Database }, view: D.DatabaseView | null, value: string): UpdateReturn => {
  if (view === null) return { model: { ...model, picker: null } }
  if (value === 'clear') return changeKeeping(model, picker, page, view.sorts.map(sort => ({ _tag: 'SetSort', viewId: view.id, propertyId: sort.propertyId, isDescending: null })))
  const split = value.indexOf(':')
  const [kind, propertyId] = [value.slice(0, split), value.slice(split + 1)]
  if (propertyId !== D.TITLE && D.propertyOf(page.database, propertyId) === null) return { model }
  const sort = view.sorts.find(entry => entry.propertyId === propertyId)
  switch (kind) {
    case 'add': return sort === undefined ? changeKeeping(model, picker, page, [{ _tag: 'SetSort', viewId: view.id, propertyId, isDescending: false }]) : { model }
    case 'flip': return sort === undefined ? { model } : changeKeeping(model, picker, page, [{ _tag: 'SetSort', viewId: view.id, propertyId, isDescending: !sort.isDescending }])
    case 'up': return sort === undefined ? { model } : changeKeeping(model, picker, page, [{ _tag: 'MoveSort', viewId: view.id, propertyId }])
    case 'remove': return sort === undefined ? { model } : changeKeeping(model, picker, page, [{ _tag: 'SetSort', viewId: view.id, propertyId, isDescending: null }])
    default: return { model }
  }
}

const chooseDatabase = (model: Model, picker: Picker, value: string): UpdateReturn => {
  const closed = { ...model, picker: null }
  const page = editableDatabase(model)
  if (page === null) return { model: closed }
  const view = activeView(page.database, model.db)
  const property = page.database.properties.find(entry => entry.id === picker.pageId)
  switch (picker.field) {
    case 'addFilter':
      return view === null ? { model: closed } : changeDb(model, page, { _tag: 'AddFilter', viewId: view.id, propertyId: value })
    case 'filter':
      return chooseFilter(model, picker, page, view, value)
    case 'sorts':
      return chooseSort(model, picker, page, view, value)
    case 'property': {
      if (value === 'filter' && view !== null) return changeDb(model, page, { _tag: 'AddFilter', viewId: view.id, propertyId: picker.pageId })
      if (value.startsWith('sort:') && view !== null) return changeDb(model, page, { _tag: 'SetSort', viewId: view.id, propertyId: picker.pageId, isDescending: value === 'sort:none' ? null : value === 'sort:desc' })
      if (value === 'insert:right' || (value === 'insert:left' && property !== undefined)) {
        return { model: withPicker(model, openPicker('addProperty', `${value}:${picker.pageId}`, picker.anchor)) }
      }
      if (property === undefined) return { model: closed }
      switch (value) {
        case 'rename': return { model: focusOn(withDb(closed, { renaming: { propertyId: property.id, name: property.name } }), `#${PROPERTY_NAME_ID}`) }
        case 'rollup:relation': return property.type._tag === 'Rollup' ? { model: withPicker(model, openPicker('rollupRelation', property.id, picker.anchor)) } : { model: closed }
        case 'rollup:property': return property.type._tag === 'Rollup' ? { model: withPicker(model, openPicker('rollupProperty', property.id, picker.anchor)) } : { model: closed }
        case 'rollup:fn': return property.type._tag === 'Rollup' ? { model: withPicker(model, openPicker('rollupFn', property.id, picker.anchor)) } : { model: closed }
        case 'formula': return property.type._tag === 'Formula' ? { model: focusOn(withDb(closed, { formula: { propertyId: property.id, expression: property.type.expression } }), `#${FORMULA_INPUT_ID}`) } : { model: closed }
        case 'prefix': return property.type._tag === 'Id' ? { model: withPicker(model, openPicker('idPrefix', property.id, picker.anchor)) } : { model: closed }
        case 'relate': return property.type._tag === 'Relation' ? { model: withPicker(model, openPicker('relation', property.id, picker.anchor)) } : { model: closed }
        case 'type': return { model: withPicker(model, openPicker('propertyType', property.id, picker.anchor, Math.max(0, D.PROPERTY_TAGS.indexOf(property.type._tag)))) }
        case 'hide': return view === null ? { model: closed } : changeDb(model, page, { _tag: 'SetHidden', viewId: view.id, propertyId: property.id, isHidden: true })
        case 'duplicate': return changeDb(model, page, { _tag: 'DuplicateProperty', propertyId: property.id })
        case 'delete': return changeDb(model, page, { _tag: 'DeleteProperty', propertyId: property.id })
        default: return { model: closed }
      }
    }
    case 'idPrefix': {
      const prefix = value === 'clear' ? '' : picker.query.trim()
      if (property?.type._tag !== 'Id' || (value !== 'set' && value !== 'clear') || !D.isIdPrefix(prefix)) return { model: closed }
      return changeDb(model, page, { _tag: 'SetIdPrefix', propertyId: property.id, prefix })
    }
    case 'calculate': {
      const fn = D.CALC_FNS.find(entry => entry === value)
      const target = picker.pageId === D.TITLE ? null : property
      if (view === null || fn === undefined || target === undefined || !D.calcFnsFor(target).includes(fn)) return { model: closed }
      return changeDb(model, page, { _tag: 'SetCalculation', viewId: view.id, propertyId: picker.pageId, fn })
    }
    case 'rollupRelation':
    case 'rollupProperty':
    case 'rollupFn': {
      if (property?.type._tag !== 'Rollup' || !rollupItems(model, picker.field, property.id).some(item => item.value === value)) return { model: closed }
      const { relationId, targetId, fn } = property.type
      const next = picker.field === 'rollupRelation'
        ? { relationId: value, targetId: value === relationId ? targetId : D.TITLE, fn }
        : picker.field === 'rollupProperty' ? { relationId, targetId: value, fn } : { relationId, targetId, fn: D.ROLLUP_FNS.find(entry => entry === value) ?? fn }
      return changeDb(model, page, { _tag: 'SetRollup', propertyId: property.id, ...next })
    }
    case 'relation': {
      const databaseId = value === 'self' ? '' : model.databases.find(entry => `db:${entry.id}` === value)?.id
      return property?.type._tag === 'Relation' && databaseId !== undefined ? changeDb(model, page, { _tag: 'SetRelation', propertyId: property.id, databaseId }) : { model: closed }
    }
    case 'propertyType':
      return property !== undefined && D.isPropertyTag(value) ? changeDb(model, page, { _tag: 'SetPropertyType', propertyId: property.id, tag: value }) : { model: closed }
    case 'addProperty':
      return D.isPropertyTag(value) ? changeDb(model, page, { _tag: 'AddProperty', tag: value, name: '', ...besideOf(picker.pageId) }) : { model: closed }
    case 'view': {
      const target = page.database.views.find(entry => entry.id === picker.pageId)
      if (target === undefined) return { model: closed }
      switch (value) {
        case 'rename': return picker.query.trim() === '' ? { model } : changeDb(model, page, { _tag: 'RenameView', viewId: target.id, name: picker.query })
        case 'duplicate': return changeDb(model, page, { _tag: 'DuplicateView', viewId: target.id })
        case 'delete': return changeDb(model, page, { _tag: 'DeleteView', viewId: target.id })
        default: {
          const [kind, rest = ''] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)]
          if (kind === 'layout') return S.is(D.Layout)(rest) ? changeDb(model, page, { _tag: 'SetLayout', viewId: target.id, layout: rest }) : { model: closed }
          if (kind === 'group') return changeDb(model, page, { _tag: 'SetGroupBy', viewId: target.id, propertyId: rest === '' ? null : rest })
          if (kind === 'size') return S.is(D.CardSize)(rest) ? changeDb(model, page, { _tag: 'SetCardSize', viewId: target.id, size: rest }) : { model: closed }
          if (kind === 'open') return S.is(D.OpenIn)(rest) ? changeDb(model, page, { _tag: 'SetOpenIn', viewId: target.id, openIn: rest }) : { model: closed }
          if (kind === 'date') return changeDb(model, page, { _tag: 'SetDateBy', viewId: target.id, propertyId: rest })
          return { model: closed }
        }
      }
    }
    case 'addView': {
      const layout = value.startsWith('layout:') ? value.slice(7) : ''
      return S.is(D.Layout)(layout) ? changeDb(model, page, { _tag: 'AddView', layout }) : { model: closed }
    }
    default:
      return { model: closed }
  }
}

/** A database message; every id and value is checked against the open database. */
const updateDatabase = (model: Model, message: Message): UpdateReturn | null => {
  const actorId = model.me.id
  switch (message._tag) {
    case 'ClickedMakeDatabase': {
      const page = changeable(model)
      return page === null || page.database !== null || model.parentDatabase !== null || !isBlankPage(page) ? { model } : { model, commands: [MakeDatabase({ pageId: page.id, layout: message.layout, actorId })] }
    }
    case 'ClickedDbView':
      return model.page?.database?.views.some(view => view.id === message.viewId) === true ? { model: withDb({ ...model, picker: null }, { viewId: message.viewId, editing: null, datePick: null }) } : { model }
    case 'ClickedViewMenu':
      return editableDatabase(model)?.database.views.some(view => view.id === message.viewId) === true ? { model: withPicker(model, openPicker('view', message.viewId, viewAnchor(message.viewId))) } : { model }
    case 'ClickedPeek': {
      const page = model.page
      const view = page?.database == null ? null : activeView(page.database, model.db)
      if (view === null || D.openInOf(view) === 'full' || !model.rows.some(row => row.id === message.rowId)) return { model }
      return { model: focusOn(withDb({ ...model, picker: null }, { peek: message.rowId, editing: null, datePick: null }), '#peek-close') }
    }
    case 'ResizedColumn': {
      const page = editableDatabase(model)
      const view = page === null ? null : activeView(page.database, model.db)
      if (page === null || view === null || !Number.isFinite(message.width) || (message.propertyId !== D.TITLE && D.propertyOf(page.database, message.propertyId) === null)) return { model }
      return { model, commands: [ChangeDatabase({ pageId: page.id, change: { _tag: 'SetWidth', viewId: view.id, propertyId: message.propertyId, width: message.width }, actorId: model.me.id })] }
    }
    case 'ToggledGroup': {
      const page = editableDatabase(model)
      const view = page === null ? null : activeView(page.database, model.db)
      const property = page === null || view?.groupBy == null ? null : D.propertyOf(page.database, view.groupBy)
      if (page === null || view === null || property === null || !D.groupRows(property, model.rows, model.people).some(group => group.key === message.key)) return { model }
      return { model, commands: [ChangeDatabase({ pageId: page.id, change: { _tag: 'SetGroupHidden', viewId: view.id, key: message.key, isHidden: message.isHidden }, actorId: model.me.id })] }
    }
    case 'ClosedPeek':
      return { model: withDb({ ...model, picker: null }, { peek: null, editing: null, datePick: null }) }
    case 'ClickedAddFilter': {
      const page = editableDatabase(model)
      const view = page === null ? null : activeView(page.database, model.db)
      return page === null || view === null ? { model } : { model: withPicker(model, openPicker('addFilter', view.id, FILTER_ANCHOR)) }
    }
    case 'ClickedFilter': {
      const page = editableDatabase(model)
      const view = page === null ? null : activeView(page.database, model.db)
      return view?.filters.some(filter => filter.id === message.filterId) === true ? { model: withPicker(model, openPicker('filter', message.filterId, filterAnchor(message.filterId))) } : { model }
    }
    case 'ClickedSorts': {
      const page = editableDatabase(model)
      const view = page === null ? null : activeView(page.database, model.db)
      return page === null || view === null ? { model } : { model: withPicker(model, openPicker('sorts', view.id, SORT_ANCHOR)) }
    }
    case 'ClickedAddView': {
      const page = editableDatabase(model)
      return page === null ? { model } : { model: withPicker(model, openPicker('addView', page.id, ADD_VIEW_ANCHOR)) }
    }
    case 'ClickedHeader': {
      const page = editableDatabase(model)
      return page !== null && (message.propertyId === D.TITLE || page.database.properties.some(property => property.id === message.propertyId))
        ? { model: withPicker(model, openPicker('property', message.propertyId, headerAnchor(message.propertyId))) }
        : { model }
    }
    case 'ClickedCalc': {
      const page = editableDatabase(model)
      return page !== null && activeView(page.database, model.db) !== null && (message.propertyId === D.TITLE || page.database.properties.some(property => property.id === message.propertyId))
        ? { model: withPicker(model, openPicker('calculate', message.propertyId, calcAnchor(message.propertyId))) }
        : { model }
    }
    case 'ClickedAddProperty': {
      const page = editableDatabase(model)
      return page === null ? { model } : { model: withPicker(model, openPicker('addProperty', page.id, ADD_PROPERTY_ANCHOR)) }
    }
    case 'ChangedFormula':
      return model.db.formula === null ? { model } : { model: withDb(model, { formula: { ...model.db.formula, expression: message.expression.slice(0, MAX_FORMULA) } }) }
    case 'CancelledFormula':
      return { model: withDb(model, { formula: null }) }
    case 'SubmittedFormula': {
      const editing = model.db.formula
      const page = editableDatabase(model)
      const property = page?.database.properties.find(entry => entry.id === editing?.propertyId)
      if (editing === null || page === null || property?.type._tag !== 'Formula') return { model: withDb(model, { formula: null }) }
      if (editing.expression.trim() !== '' && typeof parseFormula(editing.expression) === 'string') return { model }
      const closed = withDb(model, { formula: null })
      return editing.expression === property.type.expression
        ? { model: closed }
        : { model: closed, commands: [ChangeDatabase({ pageId: page.id, change: { _tag: 'SetFormula', propertyId: property.id, expression: editing.expression }, actorId: model.me.id })] }
    }
    case 'ChangedPropertyName':
      return model.db.renaming === null ? { model } : { model: withDb(model, { renaming: { ...model.db.renaming, name: message.name.slice(0, D.MAX_NAME) } }) }
    case 'SubmittedPropertyName': {
      const renaming = model.db.renaming
      const page = editableDatabase(model)
      const property = page?.database.properties.find(entry => entry.id === renaming?.propertyId)
      const closed = withDb(model, { renaming: null })
      return page === null || renaming === null || property === undefined || renaming.name.trim() === '' || renaming.name.trim() === property.name
        ? { model: closed }
        : { model: closed, commands: [ChangeDatabase({ pageId: page.id, change: { _tag: 'RenameProperty', propertyId: property.id, name: renaming.name }, actorId })] }
    }
    case 'ClickedCell':
      return openCell(model, message.rowId, message.propertyId)
    case 'ChangedCell':
      return model.db.editing === null ? { model } : { model: withDb(model, { editing: { ...model.db.editing, draft: message.text.slice(0, D.MAX_TEXT) } }) }
    case 'SubmittedCell':
      return submitCell(model)
    case 'CanceledCell':
      return { model: withDb(model, { editing: null }) }
    case 'ToggledCell': {
      const cell = cellOf(model, message.rowId, message.propertyId)
      return cell === null || !cell.isEditable || cell.property?.type._tag !== 'Checkbox' ? { model } : setValue(model, cell, { _tag: 'CheckboxValue', isChecked: message.isChecked })
    }
    case 'ClickedDateCell': {
      const pick = model.db.datePick
      return pick?.rowId === message.rowId && pick.propertyId === message.propertyId ? { model: withDb(model, { datePick: null }) } : openCell(model, message.rowId, message.propertyId)
    }
    case 'ChangedDateMonth':
      return model.db.datePick === null || !/^\d{4}-\d{2}$/.test(message.month) ? { model } : { model: withDb(model, { datePick: { ...model.db.datePick, month: message.month } }) }
    case 'PickedDate':
      return pickDate(model, message.day)
    case 'ClearedDate':
      return pickDate(model, null)
    case 'ClosedDate':
      return { model: withDb(model, { datePick: null }) }
    case 'ClickedNewRow': {
      const page = editableDatabase(model)
      const view = page === null ? null : activeView(page.database, model.db)
      return page === null || view === null ? { model } : { model, commands: [AddRow({ databaseId: page.id, values: D.valuesForNew(page.database, view), actorId })] }
    }
    case 'ClickedNewInGroup': {
      const page = editableDatabase(model)
      const view = page === null ? null : activeView(page.database, model.db)
      const property = page === null || view?.groupBy == null ? null : D.propertyOf(page.database, view.groupBy)
      if (page === null || view === null || property === null || !isGroupKey(property, message.key, model.people)) return { model }
      const value = D.valueForGroup(property, message.key, null)
      return { model, commands: [AddRow({ databaseId: page.id, values: { ...D.valuesForNew(page.database, view), ...(value === null ? {} : { [property.id]: value }) }, actorId })] }
    }
    case 'ClickedNewOnDay': {
      const page = editableDatabase(model)
      const view = page === null ? null : activeView(page.database, model.db)
      const property = page === null || view?.dateBy == null ? null : D.propertyOf(page.database, view.dateBy)
      if (page === null || view === null || property?.type._tag !== 'Date' || !isDay(message.day)) return { model }
      return { model, commands: [AddRow({ databaseId: page.id, values: { ...D.valuesForNew(page.database, view), [property.id]: { _tag: 'DateValue', start: message.day, end: null } }, actorId })] }
    }
    case 'StartedCardDrag':
      return editableDatabase(model) !== null && model.rows.some(row => row.id === message.rowId && !row.isLocked) ? { model: withDb(model, { dragging: message.rowId, dropOn: null }) } : { model }
    case 'EndedCardDrag':
      return { model: withDb(model, { dragging: null, dropOn: null }) }
    case 'EnteredDropTarget':
      return model.db.dragging === null || message.key.length > 64 ? { model } : { model: withDb(model, { dropOn: message.key }) }
    case 'DroppedCard':
      return dropCard(withDb(model, { dragging: null, dropOn: null }), model.db.dragging, message.key)
    case 'ChangedCalendarMonth':
      return isMonth(message.month) ? { model: withDb(model, { month: message.month }) } : { model }
    case 'SucceededAddRow': {
      const editing = withDb(model, { editing: { rowId: message.rowId, propertyId: D.TITLE, draft: '' } })
      return { model: model.rows.some(row => row.id === message.rowId) ? focusOn(editing, `#${CELL_INPUT_ID}`) : editing }
    }
    case 'ClickedDbSearch':
      return model.page?.database == null ? { model } : { model: focusOn(withDb(model, { query: model.db.query ?? '' }), `#${DB_SEARCH_ID}`) }
    case 'ChangedDbQuery':
      return { model: withDb(model, { query: message.query.slice(0, 200) }) }
    case 'SucceededDbChange': {
      const { change, addedId } = message
      if (change._tag === 'AddFilter' && addedId !== null && model.picker === null) return { model: withPicker(model, openPicker('filter', addedId, filterAnchor(addedId))) }
      return change._tag === 'AddView' || change._tag === 'DuplicateView'
        ? { model: withDb(model, { viewId: addedId }) }
        : change._tag === 'DeleteView' && model.db.viewId === change.viewId ? { model: withDb(model, { viewId: null }) } : { model }
    }
    default:
      return null
  }
}

/** After a reload: drop edits of rows that went away, and focus a new row's title once it arrives. */
const keepDb = (before: Model, model: Model): Model => {
  const { editing, datePick } = model.db
  const has = (rowId: string) => model.rows.some(row => row.id === rowId) || (model.parentDatabase !== null && model.page?.id === rowId)
  const kept = withDb(model, {
    editing: editing !== null && (has(editing.rowId) || !before.rows.length || editing.draft === '') ? editing : null,
    datePick: datePick !== null && has(datePick.rowId) ? datePick : null,
  })
  return editing !== null && !before.rows.some(row => row.id === editing.rowId) && model.rows.some(row => row.id === editing.rowId) ? focusOn(kept, `#${CELL_INPUT_ID}`) : kept
}

// COMMENTS

export type Thread = Readonly<{ root: CommentEntry; replies: ReadonlyArray<CommentEntry> }>

/** Discussions in the order they started, each with its replies. */
export const threadsOf = (comments: ReadonlyArray<CommentEntry>): ReadonlyArray<Thread> =>
  comments.filter(comment => comment.id === comment.threadId).map(root => ({ root, replies: comments.filter(comment => comment.threadId === root.id && comment.id !== root.id) }))

/** Comments are allowed on locked pages too, not in Trash. */
const canComment = (model: Model): boolean => model.page !== null && !model.isInTrash

const openThread = (model: Model, threadId: string): CommentEntry | undefined =>
  model.comments.find(comment => comment.id === threadId && comment.threadId === threadId)

const ownComment = (model: Model, commentId: string): CommentEntry | undefined =>
  model.comments.find(comment => comment.id === commentId && comment.authorId === model.me.id)

export const COMMENT_INPUT_ID = 'comment-input'

const compose = (model: Model, composer: Composer): UpdateReturn =>
  canComment(model) ? { model: focusOn({ ...model, composer }, `#${COMMENT_INPUT_ID}`) } : { model }

/** Drops the delete question when its page left the Trash (restored, or deleted by someone else). */
const keepConfirm = (model: Model): Model =>
  model.confirmDelete === null || model.trash.some(entry => entry.id === model.confirmDelete) ? model : { ...model, confirmDelete: null }

/** Trash entries whose title or location has every word of the query. */
export const trashMatches = (trash: ReadonlyArray<TrashEntry>, query: string): ReadonlyArray<TrashEntry> => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  return words.length === 0 ? trash : trash.filter(entry => words.every(word => `${entry.title} ${entry.path}`.toLowerCase().includes(word)))
}

export const CONFIRM_DELETE_ID = 'confirm-delete'

/** Closes the comment box when what it answers or edits is gone. */
const keepComposer = (model: Model): Model => {
  const { composer } = model
  if (composer === null) return model
  const isValid = !canComment(model) ? false
    : composer._tag === 'NewDiscussion' ? true
    : composer._tag === 'Reply' ? openThread(model, composer.threadId)?.resolvedAt === null
    : ownComment(model, composer.commentId) !== undefined
  return isValid ? model : { ...model, composer: null }
}

const submitComment = (model: Model): UpdateReturn => {
  const { composer, page } = model
  if (composer === null || page === null || !canComment(model)) return { model }
  const text = composer.text.trim()
  if (text === '') return { model }
  const closed = { ...model, composer: null }
  const actorId = model.me.id
  switch (composer._tag) {
    case 'NewDiscussion': return { model: closed, commands: [AddComment({ pageId: page.id, threadId: null, text, actorId })] }
    case 'Reply': return { model: closed, commands: [AddComment({ pageId: page.id, threadId: composer.threadId, text, actorId })] }
    case 'Edit': return ownComment(model, composer.commentId) === undefined ? { model: closed } : { model: closed, commands: [EditComment({ commentId: composer.commentId, text, actorId })] }
  }
}

// HISTORY

export const HISTORY_ID = 'history-panel'

/** Opens the history on the latest version, which starts loading. */
const openHistory = (model: Model): UpdateReturn => {
  if (model.page === null || model.isInTrash) return { model: { ...model, picker: null } }
  const latest = model.versions.at(-1)
  const opened = focusOn({ ...model, picker: null, history: { selectedId: latest?.id ?? null, preview: null } }, `#${HISTORY_ID}`)
  return latest === undefined ? { model: opened } : { model: opened, commands: [LoadVersion({ versionId: latest.id, actorId: model.me.id })] }
}

const canRestore = (model: Model): boolean => model.page !== null && !model.isInTrash && !model.page.isLocked

/** The open history after the page changed: closed with the page, and a
 *  picked version that is gone is dropped. */
const keepHistory = (model: Model): Model => {
  const { history } = model
  if (history === null) return model
  if (model.page === null || model.isInTrash) return { ...model, history: null }
  return history.selectedId === null || model.versions.some(version => version.id === history.selectedId) ? model : { ...model, history: { selectedId: null, preview: null } }
}

/** The page's update without the focus wrapper, for Story tests. */
const DATABASE_TAGS = [
  'ClickedMakeDatabase', 'ClickedDbView', 'ClickedViewMenu', 'ClickedAddView', 'ClickedHeader', 'ClickedAddProperty', 'ChangedPropertyName', 'SubmittedPropertyName', 'ClickedCalc', 'ChangedFormula', 'SubmittedFormula', 'CancelledFormula',
  'ClickedCell', 'ChangedCell', 'SubmittedCell', 'CanceledCell', 'ToggledCell', 'ClickedDateCell', 'ChangedDateMonth', 'PickedDate', 'ClearedDate', 'ClosedDate',
  'ClickedNewRow', 'ClickedDbSearch', 'ChangedDbQuery', 'SucceededDbChange', 'SucceededAddRow',
  'ClickedNewInGroup', 'ClickedNewOnDay', 'StartedCardDrag', 'EndedCardDrag', 'EnteredDropTarget', 'DroppedCard', 'ChangedCalendarMonth',
  'ClickedAddFilter', 'ClickedFilter', 'ClickedSorts', 'ClickedPeek', 'ClosedPeek', 'ResizedColumn', 'ToggledGroup',
] as const
type PageMessage = Exclude<Message, { _tag: (typeof DATABASE_TAGS)[number] }>
const isPageMessage = (message: Message): message is PageMessage => !(DATABASE_TAGS as ReadonlyArray<string>).includes(message._tag)

export const updateModel = (model: Model, message: Message): UpdateReturn =>
  isPageMessage(message) ? updatePage(model, message) : (updateDatabase(model, message) ?? { model })

const updatePage = (model: Model, message: PageMessage): UpdateReturn =>
  M.value(message).pipe(
    M.withReturnType<UpdateReturn>(),
    M.tagsExhaustive({
      ClickedToggle: ({ pageId, isOpen }) => (isKnown(model, pageId) ? { model, commands: [SetExpanded({ pageId, isOpen, actorId: model.me.id })] } : { model }),
      StartedNavDrag: ({ pageId }) => (visibleSubtree(model.nav, pageId).size === 0 ? { model } : { model: { ...model, navDrag: { pageId, target: null } } }),
      EnteredNavDrop: ({ drop }) =>
        model.navDrag === null || (drop.place !== 'end' && model.nav[drop.section].every(row => row.id !== drop.rowId)) ? { model } : { model: { ...model, navDrag: { ...model.navDrag, target: drop } } },
      DroppedNav: () => dropNav({ ...model, navDrag: null }, model.navDrag),
      EndedNavDrag: () => ({ model: { ...model, navDrag: null } }),
      ClickedAdd: ({ parentId, section }) =>
        parentId !== null && !isKnown(model, parentId) ? { model } : { model, commands: [CreatePage({ parentId, section, actorId: model.me.id })] },
      ClickedMenu: ({ pageId, anchor }) => (isKnown(model, pageId) && /^--[A-Za-z0-9_-]+$/.test(anchor) ? { model: withPicker(model, openPicker('page', pageId, anchor)) } : { model }),
      ClickedSearch: () => ({ model: { ...withPicker(model, openPicker('search', '', null)), search: null, isSearchTitlesOnly: false }, commands: [SearchPages({ query: '', isTitlesOnly: false, actorId: model.me.id })] }),
      ToggledSearchTitlesOnly: () => {
        if (model.picker?.field !== 'search') return { model }
        const isTitlesOnly = !model.isSearchTitlesOnly
        return { model: { ...model, isSearchTitlesOnly: isTitlesOnly, search: null, picker: { ...model.picker, active: 0 } }, commands: [SearchPages({ query: model.picker.query, isTitlesOnly, actorId: model.me.id })] }
      },
      ChangedPickerQuery: ({ query }) => {
        if (model.picker === null) return { model }
        const next = { ...model, picker: { ...model.picker, query: query.slice(0, 200), active: 0 } }
        return model.picker.field === 'search' ? { model: next, commands: [SearchPages({ query: next.picker.query, isTitlesOnly: model.isSearchTitlesOnly, actorId: model.me.id })] } : { model: next }
      },
      GotSearch: ({ query, isTitlesOnly, hits }) => (model.picker?.field === 'search' && model.picker.query === query && model.isSearchTitlesOnly === isTitlesOnly ? { model: { ...model, search: { query, hits } } } : { model }),
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
      ClickedAddIcon: () => {
        const page = changeable(model)
        return page === null || page.icon !== '' ? { model } : change(model, page, { _tag: 'SetIcon', icon: pickEmoji(`${page.id}:${page.updatedAt}`) })
      },
      ClickedIcon: () => {
        const page = changeable(model)
        return page === null ? { model } : { model: withPicker(model, openPicker('icon', page.id, ICON_ANCHOR)) }
      },
      ClickedAddCover: () => {
        const page = changeable(model)
        return page === null || page.cover._tag !== 'NoCover' ? { model } : change(model, page, { _tag: 'SetCover', cover: { _tag: 'GalleryCover', name: pickCover(`${page.id}:${page.updatedAt}`) } })
      },
      ClickedCover: () => {
        const page = changeable(model)
        return page === null ? { model } : { model: withPicker(model, openPicker('cover', page.id, COVER_ANCHOR)) }
      },
      ClickedRemoveCover: () => {
        const page = changeable(model)
        return page === null || page.cover._tag === 'NoCover' ? { model } : change(model, page, { _tag: 'SetCover', cover: { _tag: 'NoCover' } })
      },
      CopiedLink: () => (model.page === null ? { model } : { model: { ...model, notice: 'Copied link to clipboard' } }),
      ClickedReposition: () => {
        const page = changeable(model)
        return page === null || page.cover._tag !== 'ImageCover' ? { model } : { model: { ...model, picker: null, coverDraft: page.coverPosition } }
      },
      MovedCover: ({ position }) =>
        model.coverDraft === null || !Number.isFinite(position) ? { model } : { model: { ...model, coverDraft: coverPosition(position) } },
      ClickedSaveCover: () => {
        const page = changeable(model)
        const done = { ...model, coverDraft: null }
        return page === null || model.coverDraft === null || page.cover._tag !== 'ImageCover' || model.coverDraft === page.coverPosition
          ? { model: done }
          : change(done, page, { _tag: 'SetCoverPosition', position: model.coverDraft })
      },
      ClickedCancelCover: () => ({ model: { ...model, coverDraft: null } }),
      ClickedPageOptions: () => {
        const page = changeable(model, true)
        return page === null ? { model } : { model: withPicker(model, openPicker('options', page.id, OPTIONS_ANCHOR)) }
      },
      ClickedUnlock: () => {
        const page = changeable(model, true)
        return page === null || !page.isLocked ? { model } : change(model, page, { _tag: 'SetLocked', isOn: false })
      },
      ClickedRestore: ({ pageId }) => (isKnown(model, pageId) ? { model, commands: [RestorePage({ pageId, actorId: model.me.id })] } : { model }),
      ClickedDeleteForever: ({ pageId }) => (model.trash.some(entry => entry.id === pageId) ? { model: focusOn({ ...model, confirmDelete: pageId }, `#${CONFIRM_DELETE_ID}`) } : { model }),
      ConfirmedDelete: ({ pageId }) =>
        model.confirmDelete === pageId && model.trash.some(entry => entry.id === pageId)
          ? { model: { ...model, confirmDelete: null }, commands: [DeletePage({ pageId, actorId: model.me.id })] }
          : { model: { ...model, confirmDelete: null } },
      CanceledDelete: () => ({ model: { ...model, confirmDelete: null } }),
      ChangedTrashQuery: ({ query }) => ({ model: { ...model, trashQuery: query.slice(0, 200) } }),
      ClickedToggleTheme: () => ({ model, commands: [SetTheme({ memberId: model.me.id, isDark: !model.me.isDark })] }),
      ToggledSidebar: ({ isCollapsed }) => ({
        model: { ...model, me: { ...model.me, isSidebarCollapsed: isCollapsed } },
        commands: [SetSidebar({ memberId: model.me.id, isCollapsed })],
      }),
      ResizedSidebar: ({ width }) => {
        if (!Number.isFinite(width)) return { model }
        const clamped = sidebarWidth(width)
        return { model: { ...model, me: { ...model.me, sidebarWidth: clamped } }, commands: [SetSidebar({ memberId: model.me.id, width: clamped })] }
      },
      ClickedDismissNotice: () => ({ model: { ...model, notice: null } }),
      ClickedBacklinks: () => ({ model: { ...model, isBacklinksOpen: !model.isBacklinksOpen } }),
      ClickedAddComment: () => compose(model, { _tag: 'NewDiscussion', text: '' }),
      ClickedReply: ({ threadId }) => (openThread(model, threadId)?.resolvedAt === null ? compose(model, { _tag: 'Reply', threadId, text: '' }) : { model }),
      ClickedEditComment: ({ commentId }) => {
        const own = ownComment(model, commentId)
        return own === undefined ? { model } : compose(model, { _tag: 'Edit', commentId, text: own.text })
      },
      ChangedComment: ({ text }) => (model.composer === null ? { model } : { model: { ...model, composer: { ...model.composer, text: text.slice(0, MAX_COMMENT) } } }),
      SubmittedComment: () => submitComment(model),
      ClickedCancelComment: () => ({ model: { ...model, composer: null } }),
      ClickedResolve: ({ threadId, isResolved }) =>
        openThread(model, threadId) === undefined || !canComment(model)
          ? { model }
          : { model: keepComposer({ ...model, composer: isResolved && model.composer?._tag === 'Reply' && model.composer.threadId === threadId ? null : model.composer }), commands: [ResolveThread({ threadId, isResolved, actorId: model.me.id })] },
      ClickedDeleteComment: ({ commentId }) =>
        ownComment(model, commentId) === undefined || !canComment(model) ? { model } : { model, commands: [DeleteComment({ commentId, actorId: model.me.id })] },
      ClickedShowResolved: () => ({ model: { ...model, isShowingResolved: !model.isShowingResolved } }),
      ClickedHistory: () => openHistory(model),
      ClickedCloseHistory: () => ({ model: { ...model, history: null } }),
      ClickedVersion: ({ versionId }) =>
        model.history === null || !model.versions.some(version => version.id === versionId)
          ? { model }
          : { model: { ...model, history: { selectedId: versionId, preview: model.history.preview } }, commands: [LoadVersion({ versionId, actorId: model.me.id })] },
      GotVersion: ({ preview }) => (model.history?.selectedId === preview.versionId ? { model: { ...model, history: { ...model.history, preview } } } : { model }),
      MissedVersion: ({ versionId }) => (model.history?.selectedId === versionId ? { model: { ...model, history: { selectedId: null, preview: null } } } : { model }),
      ClickedRestoreVersion: ({ versionId }) =>
        model.history === null || !canRestore(model) || !model.versions.some(version => version.id === versionId)
          ? { model }
          : { model: { ...model, history: null }, commands: [RestoreVersion({ versionId, actorId: model.me.id })] },
      GotPage: ({ _tag: _, ...slice }) => ({ model: keepDb(model, keepConfirm(keepHistory(keepComposer({ ...model, ...slice })))) }),
      ChangedConnection: ({ isConnected }) => ({ model: { ...model, isConnected } }),
      ChangedViewers: ({ viewers }) => ({ model: { ...model, viewers } }),
      SucceededCreate: ({ id }) => ({ model, commands: [LoadUrl({ url: `/p/${id}` })] }),
      SucceededTrash: () => ({ model }),
      FailedChange: ({ reason }) => ({ model: { ...model, notice: reason } }),
      CompletedChange: () => ({ model }),
      CompletedBrowserAction: () => ({ model }),
    }),
  )

/** Every new focus request (`focusOn`) becomes a forwarded focus. */
export const update = (model: Model, message: Message): UpdateReturn => {
  const result = updateModel(model, message)
  const focus = result.model.focus
  return focus !== null && focus.seq !== model.focus?.seq
    ? { ...result, commands: [...(result.commands ?? []), FocusElement({ selector: focus.selector })] }
    : result
}

// SUBSCRIPTION

export const subscriptions = Subscription.make<Model, Message, Workspace | Viewers>()(entry => ({
  viewers: entry(
    { pageId: S.NullOr(S.String), memberId: S.String, isConnected: S.Boolean },
    {
      modelToDependencies: model => ({ pageId: model.pageId, memberId: model.me.id, isConnected: model.isConnected }),
      dependenciesToStream: ({ pageId, memberId, isConnected }) =>
        !isConnected || pageId === null
          ? Stream.empty
          : Stream.unwrap(
              Effect.gen(function* () {
                const viewers = yield* Viewers
                const workspace = yield* Workspace
                yield* viewers.join(pageId, memberId)
                return viewers.of(pageId).pipe(
                  sampleLatest('300 millis'),
                  Stream.mapEffect(ids => Effect.map(workspace.current, state => ids.flatMap(id => state.members.filter(member => member.id === id)))),
                  Stream.map(members => Message.ChangedViewers({ viewers: members })),
                )
              }),
            ),
    },
  ),
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

/** Notion's presence: the avatars of the others who have this page open, newest last. */
const viewersView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const others = model.viewers.filter(member => member.id !== model.me.id)
  return box({ class: 'flex items-center', attributes: [h.Id('viewers'), h.AriaLive('polite'), h.AriaLabel(others.length === 0 ? 'Only you are here' : `${others.map(member => member.name).join(', ')} ${others.length === 1 ? 'is' : 'are'} viewing`)], children: others.length === 0
      ? []
      : [box({ class: 'flex -space-x-1.5 px-1', children: others.map(member => box({ as: 'span', class: 'rounded-full ring-2 ring-background', attributes: [h.Key(member.id), h.DataAttribute('viewer', member.id), h.Title(member.name)], children: [avatar(member, h, 'md')] }, h)) }, h)] }, h)
}

const topBar = (model: Model, h: HtmlBuilder<Message>): Html =>
  box({ as: 'header', class: 'flex h-11 shrink-0 items-center gap-1 px-3', attributes: [h.Id('topbar')], children: [
      ...(model.me.isSidebarCollapsed === true
        ? [button({ variant: 'ghost', size: 'icon-sm', id: 'sidebar-open', ariaLabel: 'Open sidebar', title: 'Open sidebar  Ctrl \\', onClick: Message.ToggledSidebar({ isCollapsed: false }), children: [Icon.icon('chevrons-right', { class: 'size-4' }, h)] }, h)]
        : []),
      box({ as: 'nav', class: 'flex min-w-0 flex-1 items-center gap-0.5 text-[14px]', attributes: [h.AriaLabel('Breadcrumbs')], children: model.crumbs.flatMap((crumb, index) => [
          ...(index === 0 ? [] : [box({ as: 'span', class: 'px-0.5 text-muted-foreground', children: ['/'] }, h)]),
          box({ as: 'a', class: 'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-accent', attributes: [h.Href(`/p/${crumb.id}`), h.DataAttribute('crumb', crumb.id)], children: [
              pageIcon(crumb.icon, h),
              box({ as: 'span', class: 'min-w-0 max-w-40 truncate', children: [crumb.title] }, h),
            ] }, h),
        ]) }, h),
      viewersView(model, h),
      ...(model.page === null ? [] : [
        box({ as: 'span', class: 'px-2 text-[13px] text-muted-foreground', attributes: [h.Id('edited-at')], children: [`Edited ${formatAgo(model.page.updatedAt, model.now)}`] }, h),
        ...(model.page.isLocked && !model.isInTrash ? [button({ variant: 'ghost', size: 'compact', id: 'page-locked', title: 'Unlock this page to edit it', onClick: Message.ClickedUnlock(), children: [Icon.icon('lock', { class: 'size-3.5' }, h), 'Locked'] }, h)] : []),
        button({ variant: 'ghost', size: 'icon-sm', id: 'favorite-toggle', ariaLabel: model.isFavorite ? 'Remove from Favorites' : 'Add to Favorites', title: model.isFavorite ? 'Remove from Favorites' : 'Add to Favorites', onClick: Message.ClickedFavorite(), children: [Icon.icon(model.isFavorite ? 'star' : 'star', { class: model.isFavorite ? 'size-4 fill-amber-400 text-amber-400' : 'size-4' }, h)] }, h),
        ...(model.isInTrash ? [] : [box({ class: 'flex', style: { anchorName: OPTIONS_ANCHOR }, children: [
            button({ variant: 'ghost', size: 'icon-sm', id: 'page-options', ariaLabel: 'Style, lock and more', title: 'Style, lock and more…', onClick: Message.ClickedPageOptions(), children: [Icon.icon('ellipsis', { class: 'size-4' }, h)] }, h),
          ] }, h)]),
      ]),
    ] }, h)

const trashBanner = (page: Page, h: HtmlBuilder<Message>): Html =>
  box({ class: 'flex items-center justify-center gap-3 bg-destructive px-4 py-1.5 text-[14px] text-white', attributes: [h.Id('trash-banner')], children: [
      box({ as: 'span', children: ['This page is in Trash.'] }, h),
      button({ variant: 'outline', size: 'compact', id: 'restore-page', onClick: Message.ClickedRestore({ pageId: page.id }), children: ['Restore page'] }, h),
      button({ variant: 'outline', size: 'compact', id: 'delete-page', onClick: Message.ClickedDeleteForever({ pageId: page.id }), children: ['Delete from Trash'] }, h),
    ] }, h)

const HEADER_ACTIONS: HeaderActions<Message> = {
  onAddIcon: Message.ClickedAddIcon(),
  onIcon: Message.ClickedIcon(),
  onAddCover: Message.ClickedAddCover(),
  onCover: Message.ClickedCover(),
  onRemoveCover: Message.ClickedRemoveCover(),
  onReposition: Message.ClickedReposition(),
  onMoveCover: position => Message.MovedCover({ position }),
  onSaveCover: Message.ClickedSaveCover(),
  onCancelCover: Message.ClickedCancelCover(),
  onAddComment: Message.ClickedAddComment(),
}

const DB_MESSAGES: DatabaseMessages<Message> = {
  view: viewId => Message.ClickedDbView({ viewId }),
  viewMenu: viewId => Message.ClickedViewMenu({ viewId }),
  addView: Message.ClickedAddView(),
  header: propertyId => Message.ClickedHeader({ propertyId }),
  addProperty: Message.ClickedAddProperty(),
  propertyName: name => Message.ChangedPropertyName({ name }),
  submitPropertyName: Message.SubmittedPropertyName(),
  calc: propertyId => Message.ClickedCalc({ propertyId }),
  formula: expression => Message.ChangedFormula({ expression }),
  submitFormula: Message.SubmittedFormula(),
  cancelFormula: Message.CancelledFormula(),
  cell: (rowId, propertyId) => Message.ClickedCell({ rowId, propertyId }),
  changeCell: text => Message.ChangedCell({ text }),
  submitCell: Message.SubmittedCell(),
  cancelCell: Message.CanceledCell(),
  toggle: (rowId, propertyId, isChecked) => Message.ToggledCell({ rowId, propertyId, isChecked }),
  date: (rowId, propertyId) => Message.ClickedDateCell({ rowId, propertyId }),
  dateMonth: month => Message.ChangedDateMonth({ month }),
  pickDate: day => Message.PickedDate({ day }),
  clearDate: Message.ClearedDate(),
  closeDate: Message.ClosedDate(),
  newRow: Message.ClickedNewRow(),
  search: Message.ClickedDbSearch(),
  query: query => Message.ChangedDbQuery({ query }),
  newInGroup: key => Message.ClickedNewInGroup({ key }),
  newOnDay: day => Message.ClickedNewOnDay({ day }),
  dragCard: rowId => Message.StartedCardDrag({ rowId }),
  endDrag: Message.EndedCardDrag(),
  enterDrop: key => Message.EnteredDropTarget({ key }),
  drop: key => Message.DroppedCard({ key }),
  month: month => Message.ChangedCalendarMonth({ month }),
  addFilter: Message.ClickedAddFilter(),
  filter: filterId => Message.ClickedFilter({ filterId }),
  sorts: Message.ClickedSorts(),
  peek: rowId => Message.ClickedPeek({ rowId }),
  closePeek: Message.ClosedPeek(),
  resize: (propertyId, width) => Message.ResizedColumn({ propertyId, width }),
  hideGroup: (key, isHidden) => Message.ToggledGroup({ key, isHidden }),
}

const isBlankPage = (page: Page): boolean => page.content.every(entry => entry.text.length === 0 && entry.kind._tag === 'Paragraph')

/** Under the title of an empty page: turn it into a database (Notion's "Get started with"). */
const startView = (h: HtmlBuilder<Message>): Html =>
  box({ class: 'mt-4 flex items-center gap-2 text-[14px] text-muted-foreground', attributes: [h.Id('database-start')], children: [
      box({ as: 'span', children: ['Get started with'] }, h),
      ...D.LAYOUTS.map(layout => button({
        variant: 'outline',
        size: 'compact',
        id: `make-${layout}`,
        onClick: Message.ClickedMakeDatabase({ layout }),
        children: [Icon.icon(LAYOUT_ICON[layout], { class: 'size-3.5' }, h), D.LAYOUT_LABEL[layout]],
      }, h)),
    ] }, h)

/** The database of a database page, or the row's properties and blocks of any other page. */
const contentView = (model: Model, page: Page, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const isEditable = !model.isInTrash && !page.isLocked
  const view = page.database === null ? null : activeView(page.database, model.db)
  const context = { ui: model.db, people: model.people, today: todayOf(model), msgs: DB_MESSAGES, scope: '', isPeeking: view !== null && D.openInOf(view) !== 'full' }
  if (page.database !== null) return [databaseView({ ...context, isEditable, pageId: page.id, database: page.database, rows: D.withComputed(page.database, page.id, model.rows, model.related, model.people) }, h)]
  return [
    ...(model.parentDatabase === null ? [] : [propertiesView(model.parentDatabase, computedRow(model, model.parentDatabase, rowEntryOf(page, titlesOf(model))), { ...context, isEditable: !model.isInTrash }, h)]),
    ...(isEditable && model.parentDatabase === null && isBlankPage(page) ? [startView(h)] : []),
    editorView(model, page, h),
  ]
}

/** Ctrl+L copies the page's link in the browser (public/copy-link.js), which says so with this event. */
const onCopiedLink: Attribute<Message> = { _tag: 'OnCustomEvent', name: 'hypercopylink', f: () => Option.some(Message.CopiedLink()) }

/** The ••• menu's footer, as in Notion: the page's word count and who edited it last, when. */
export const optionsFooter = (model: Model): ReadonlyArray<string> => {
  const page = model.page
  if (page === null) return []
  const label = (text: Parameters<typeof plainText>[0]): string =>
    plainText(text, piece => {
      switch (piece._tag) {
        case 'PageMention': return model.pages.find(entry => entry.id === piece.pageId)?.title ?? ''
        case 'PersonMention': return model.people.find(person => person.id === piece.memberId)?.name ?? ''
        case 'DateMention': return piece.date
        case 'InlineEquation': return piece.tex
      }
    })
  const words = wordCount(docText(page.content, label))
  const editor = page.updatedBy === model.me.id ? model.me.name : model.people.find(person => person.id === page.updatedBy)?.name
  return [
    `Word count: ${words.toLocaleString('en-US')} ${words === 1 ? 'word' : 'words'}`,
    ...(editor === undefined ? [] : [`Last edited by ${editor}`]),
    formatAgo(page.updatedAt, model.now),
  ]
}

/** Cover, icon, title and blocks, in the page's font, text size and width. */
const pageBody = (model: Model, page: Page, h: HtmlBuilder<Message>): Html => {
  const isEditable = !model.isInTrash && !page.isLocked
  const hasCover = page.cover._tag !== 'NoCover'
  return box({ class: cn('flex flex-col', page.isSmallText ? 'text-[14px]' : 'text-[16px]', fontClass(page.font)), attributes: [
      h.Id('page-body'),
      h.DataAttribute('copy-link', page.id),
      onCopiedLink,
      h.DataAttribute('font', page.font),
      ...(page.isSmallText ? [h.DataAttribute('small-text', '')] : []),
      ...(page.isFullWidth ? [h.DataAttribute('full-width', '')] : []),
    ], children: [
      ...coverView(page, isEditable, HEADER_ACTIONS, h, model.coverDraft),
      box({ as: 'article', class: cn('mx-auto w-full pb-40', page.isFullWidth ? 'max-w-none px-24' : 'max-w-[708px] px-6', hasCover ? 'pt-0' : 'pt-20'), children: [
          box({ as: 'header', class: 'group/header', children: [
              ...iconAndControls(page, isEditable, canComment(model) && model.composer?._tag !== 'NewDiscussion', HEADER_ACTIONS, h),
              box({ as: 'form', attributes: [h.Id('title-form'), h.OnSubmit(Message.SubmittedTitle()), h.OnFocusLeave(Message.SubmittedTitle())], children: [
                  input({ id: 'page-title', value: model.titleDraft ?? page.title, placeholder: 'Untitled', ariaLabel: 'Page title', autocomplete: 'off', variant: 'title', isReadOnly: !isEditable, onInput: title => Message.ChangedTitle({ title }) }, h),
                ] }, h),
            ] }, h),
          ...backlinksView(model, h),
          ...commentsView(model, h),
          ...contentView(model, page, h),
        ] }, h),
    ] }, h)
}

/** "N backlinks" under the title, opening the list of pages that point here. */
const backlinksView = (model: Model, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const count = model.backlinks.length
  return count === 0 ? [] : [box({ class: 'mb-3 flex flex-col items-start gap-0.5 border-b border-border pb-2', attributes: [h.Id('backlinks')], children: [
      button({ variant: 'ghost', size: 'compact', id: 'backlinks-toggle', title: model.isBacklinksOpen ? 'Hide backlinks' : 'Show backlinks', onClick: Message.ClickedBacklinks(), children: [Icon.icon('file-text', { class: 'size-3.5' }, h), `${count} backlink${count === 1 ? '' : 's'}`] }, h),
      ...(model.isBacklinksOpen ? model.backlinks.map(entry =>
        box({ as: 'a', class: 'flex items-center gap-1.5 rounded-md px-2 py-1 text-[14px] text-muted-foreground hover:bg-accent', attributes: [h.Href(`/p/${entry.id}`), h.DataAttribute('backlink', entry.id)], children: [pageIcon(entry.icon, h), entry.title] }, h)) : []),
    ] }, h)]
}

/** Page history: the picked version on the left, every version on the right. */
const historyView = (model: Model, history: History, h: HtmlBuilder<Message>): Html => {
  const preview = history.preview !== null && history.preview.versionId === history.selectedId ? history.preview : null
  const props = { pages: model.pages.map(({ id, title, icon }) => ({ id, title, icon })), members: model.people, crumbs: model.crumbs, isEditable: false, blockIdPrefix: 'version-block-' }
  return box({ class: 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6', attributes: [h.Id('history')], children: [
      box({ class: 'flex h-full max-h-[720px] w-full max-w-[1100px] min-w-0 overflow-hidden rounded-lg border border-border bg-background shadow-xl outline-none', attributes: [
          h.Id(HISTORY_ID), h.Tabindex(-1), h.Role('dialog'), h.AriaLabel('Page history'),
          h.OnKeyDownPreventDefault(key => (key === 'Escape' ? Option.some(Message.ClickedCloseHistory()) : Option.none())),
        ], children: [
          box({ class: 'min-w-0 flex-1 overflow-y-auto px-12 py-10', attributes: [h.Id('history-preview')], children: preview === null
            ? [box({ as: 'p', class: 'text-muted-foreground', children: [history.selectedId === null ? 'No versions yet. They appear as the page is edited.' : 'Loading…'] }, h)]
            : [
                box({ as: 'h1', class: 'mb-4 flex min-w-0 items-center gap-2 text-[32px] font-bold', children: [...(preview.icon === '' ? [] : [preview.icon]), preview.title === '' ? 'Untitled' : preview.title] }, h),
                box({ class: 'nb-editor nb-read-only', attributes: [h.DataAttribute('version-preview', preview.versionId)], children: [...renderDocument(preview.content, context(props), h)] }, h),
              ] }, h),
          box({ class: 'flex min-w-[260px] max-w-[260px] shrink-0 flex-col border-l border-border', children: [
              box({ class: 'flex items-center justify-between px-3 py-2', children: [
                  box({ as: 'span', class: 'text-[14px] font-medium', children: ['Page history'] }, h),
                  button({ variant: 'ghost', size: 'icon-xs', id: 'close-history', ariaLabel: 'Close page history', onClick: Message.ClickedCloseHistory(), children: [Icon.icon('x', { class: 'size-3.5' }, h)] }, h),
                ] }, h),
              box({ class: 'flex min-h-0 flex-1 flex-col overflow-y-auto px-1', attributes: [h.Id('history-versions')], children: [...model.versions].reverse().map(version =>
                  optionRow({ id: `version-${version.id}`, value: version.id, isActive: version.id === history.selectedId, onClick: Message.ClickedVersion({ versionId: version.id }), children: [
                      box({ class: 'flex min-w-0 flex-col items-start', attributes: [h.DataAttribute('version', version.id)], children: [
                          box({ as: 'span', class: 'text-[14px]', children: [formatAgo(version.at, model.now)] }, h),
                          box({ as: 'span', class: 'text-[12px] text-muted-foreground', children: [version.author?.name ?? 'Someone'] }, h),
                        ] }, h),
                    ] }, h)) }, h),
              box({ class: 'border-t border-border p-2', children: history.selectedId === null ? [] : [
                  button({ size: 'compact', id: 'restore-version', isDisabled: preview === null || !canRestore(model), title: canRestore(model) ? 'Put the page back as this version had it' : 'Unlock the page to restore a version', onClick: Message.ClickedRestoreVersion({ versionId: history.selectedId }), children: ['Restore version'] }, h),
                ] }, h),
            ] }, h),
        ] }, h),
    ] }, h)
}

/** The comment box: Enter sends and Shift+Enter starts a new line
 *  (public/enter-submits.js), Esc cancels. */
const composerView = (composer: Composer, h: HtmlBuilder<Message>): Html =>
  box({ as: 'form', class: 'flex flex-col gap-1.5 pt-1', attributes: [h.Id('comment-form'), h.DataAttribute('composer', composer._tag), h.DataAttribute('enter-submits', ''), h.OnSubmit(Message.SubmittedComment())], children: [
      // The key handler wraps the box: keys typed in it bubble up.
      box({ class: 'contents', attributes: [h.OnKeyDownPreventDefault(key => (key === 'Escape' ? Option.some(Message.ClickedCancelComment()) : Option.none()))], children: [textarea({
        id: COMMENT_INPUT_ID,
        value: composer.text,
        placeholder: composer._tag === 'Reply' ? 'Reply…' : 'Add a comment…',
        variant: 'note',
        rows: 1,
        ariaLabel: composer._tag === 'Edit' ? 'Edit comment' : composer._tag === 'Reply' ? 'Reply' : 'Comment',
        onInput: text => Message.ChangedComment({ text }),
      }, h)] }, h),
      box({ class: 'flex justify-end gap-1', children: [
          button({ variant: 'ghost', size: 'compact', id: 'comment-cancel', onClick: Message.ClickedCancelComment(), children: ['Cancel'] }, h),
          button({ size: 'compact', id: 'comment-submit', type: 'submit', isDisabled: composer.text.trim() === '', children: [composer._tag === 'Edit' ? 'Save' : composer._tag === 'Reply' ? 'Reply' : 'Comment'] }, h),
        ] }, h),
    ] }, h)

const commentView = (model: Model, entry: CommentEntry, isThread: boolean, h: HtmlBuilder<Message>): Html => {
  const editing = model.composer?._tag === 'Edit' && model.composer.commentId === entry.id ? model.composer : null
  const isOwn = entry.authorId === model.me.id
  const isResolved = entry.resolvedAt !== null
  const actions = !canComment(model) || editing !== null ? [] : [
    ...(isThread ? [button({ variant: 'ghost', size: 'icon-xs', id: `resolve-${entry.id}`, ariaLabel: isResolved ? 'Reopen discussion' : 'Resolve discussion', title: isResolved ? 'Reopen' : 'Resolve', onClick: Message.ClickedResolve({ threadId: entry.id, isResolved: !isResolved }), children: [Icon.icon(isResolved ? 'rotate-ccw' : 'check', { class: 'size-3.5' }, h)] }, h)] : []),
    ...(isOwn ? [
      button({ variant: 'ghost', size: 'icon-xs', id: `edit-${entry.id}`, ariaLabel: 'Edit comment', title: 'Edit', onClick: Message.ClickedEditComment({ commentId: entry.id }), children: [Icon.icon('pencil', { class: 'size-3.5' }, h)] }, h),
      button({ variant: 'ghost', size: 'icon-xs', id: `delete-${entry.id}`, ariaLabel: isThread ? 'Delete discussion' : 'Delete comment', title: 'Delete', onClick: Message.ClickedDeleteComment({ commentId: entry.id }), children: [Icon.icon('trash-2', { class: 'size-3.5' }, h)] }, h),
    ] : []),
  ]
  return box({ class: 'group/comment flex gap-2 py-1', attributes: [h.DataAttribute('comment', entry.id)], children: [
      avatar(entry.author ?? undefined, h, 'md', 'mt-0.5'),
      box({ class: 'flex min-w-0 flex-1 flex-col', children: [
          box({ class: 'flex h-6 items-center gap-2', children: [
              box({ as: 'span', class: 'text-[14px] font-medium', children: [entry.author?.name ?? 'Someone'] }, h),
              box({ as: 'span', class: 'text-[12px] text-muted-foreground', children: [formatAgo(entry.createdAt, model.now), ...(entry.editedAt === null ? [] : [' (edited)'])] }, h),
              box({ class: 'ml-auto flex gap-0.5 opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100', children: actions }, h),
            ] }, h),
          editing === null
            ? box({ as: 'p', class: 'min-w-0 whitespace-pre-wrap break-words text-[14px]', attributes: [h.DataAttribute('comment-text', entry.id)], children: [entry.text] }, h)
            : composerView(editing, h),
        ] }, h),
    ] }, h)
}

const threadView = (model: Model, thread: Thread, h: HtmlBuilder<Message>): Html => {
  const isResolved = thread.root.resolvedAt !== null
  const replying = model.composer?._tag === 'Reply' && model.composer.threadId === thread.root.id ? model.composer : null
  return box({ class: cn('flex flex-col rounded-md border border-border px-3 py-2', isResolved && 'opacity-70'), attributes: [h.DataAttribute('thread', thread.root.id), ...(isResolved ? [h.DataAttribute('resolved', '')] : [])], children: [
      commentView(model, thread.root, true, h),
      ...thread.replies.map(reply => commentView(model, reply, false, h)),
      ...(replying !== null
        ? [composerView(replying, h)]
        : isResolved || !canComment(model) ? [] : [box({ class: 'self-start pl-6', children: [button({ variant: 'ghost', size: 'compact', id: `reply-${thread.root.id}`, onClick: Message.ClickedReply({ threadId: thread.root.id }), children: [Icon.icon('corner-up-left', { class: 'size-3.5' }, h), 'Reply'] }, h)] }, h)]),
    ] }, h)
}

/** Page discussions under the title: open ones, then (on request) the resolved. */
const commentsView = (model: Model, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const threads = threadsOf(model.comments)
  const resolved = threads.filter(thread => thread.root.resolvedAt !== null)
  const composer = model.composer?._tag === 'NewDiscussion' ? model.composer : null
  if (threads.length === 0 && composer === null) return []
  return [box({ class: 'mb-4 flex flex-col gap-2', attributes: [h.Id('page-comments')], children: [
      ...threads.filter(thread => thread.root.resolvedAt === null).map(thread => threadView(model, thread, h)),
      ...(model.isShowingResolved ? resolved.map(thread => threadView(model, thread, h)) : []),
      ...(composer === null ? [] : [box({ class: 'rounded-md border border-border px-3 py-2', children: [composerView(composer, h)] }, h)]),
      ...(resolved.length === 0 ? [] : [box({ class: 'self-start', children: [button({ variant: 'ghost', size: 'compact', id: 'show-resolved', onClick: Message.ClickedShowResolved(), children: [Icon.icon('check', { class: 'size-3.5' }, h), model.isShowingResolved ? 'Hide resolved' : `${resolved.length} resolved ${resolved.length === 1 ? 'discussion' : 'discussions'}`] }, h)] }, h)]),
    ] }, h)]
}

/** The page's blocks: the editor island, or read-only when locked or in Trash. */
const editorView = (model: Model, page: Page, h: HtmlBuilder<Message>): Html => {
  const isEditable = !model.isInTrash && !page.isLocked
  const props = { pageId: page.id, content: page.content, revision: page.updatedAt, isEditable, pages: model.pages.map(({ id, title, icon }) => ({ id, title, icon })), members: model.people, crumbs: model.crumbs, today: new Date(model.now).toISOString().slice(0, 10) }
  return isEditable
    ? Island.view(PageEditor, { id: `editor-${page.id}`, props, onEvent: event => Message.GotEditorEvent({ event }) }, h)
    : box({ class: 'nb-editor nb-read-only', attributes: [h.DataAttribute('read-only', page.id)], children: [...renderDocument(page.content, context(props), h)] }, h)
}

const trashView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const shown = trashMatches(model.trash, model.trashQuery)
  return box({ as: 'section', class: 'mx-auto w-full max-w-[708px] px-6 pt-16', attributes: [h.Id('trash')], children: [
      box({ as: 'h1', class: 'mb-4 text-[32px] font-bold', children: ['Trash'] }, h),
      ...(model.trash.length === 0
        ? [box({ as: 'p', class: 'text-muted-foreground', children: ['No pages in Trash'] }, h)]
        : [
            box({ class: 'mb-2 flex items-center gap-2 rounded-md border border-border px-2', children: [
                Icon.search({ class: 'size-4 shrink-0 text-muted-foreground' }, h),
                input({ id: 'trash-search', value: model.trashQuery, placeholder: 'Search pages in Trash', ariaLabel: 'Search pages in Trash', autocomplete: 'off', variant: 'inline', onInput: query => Message.ChangedTrashQuery({ query }) }, h),
              ] }, h),
            ...(shown.length === 0 ? [box({ as: 'p', class: 'px-2 py-6 text-center text-muted-foreground', attributes: [h.Id('trash-no-match')], children: ['No matches in Trash'] }, h)] : []),
          ]),
      ...shown.map(entry =>
        box({ class: 'group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent', attributes: [h.DataAttribute('trash-row', entry.id)], children: [
            pageIcon(entry.icon, h),
            box({ as: 'a', class: 'flex min-w-0 flex-1 flex-col', attributes: [h.Href(`/p/${entry.id}`)], children: [
                box({ as: 'span', class: 'min-w-0 truncate', children: [entry.title] }, h),
                box({ as: 'span', class: 'min-w-0 truncate text-[12px] text-muted-foreground', children: [
                    [entry.path === '' ? '' : `In ${entry.path} · `, `Deleted ${formatAgo(entry.trashedAt, model.now)}`, entry.trashedBy === null ? '' : ` by ${entry.trashedBy}`].join(''),
                  ] }, h),
              ] }, h),
            button({ variant: 'ghost', size: 'icon-xs', ariaLabel: `Restore ${entry.title}`, title: 'Restore', onClick: Message.ClickedRestore({ pageId: entry.id }), children: [Icon.icon('undo-2', { class: 'size-3.5' }, h)] }, h),
            button({ variant: 'ghost', size: 'icon-xs', ariaLabel: `Delete ${entry.title} from Trash`, title: 'Delete from Trash', onClick: Message.ClickedDeleteForever({ pageId: entry.id }), children: [Icon.icon('trash-2', { class: 'size-3.5' }, h)] }, h),
          ] }, h),
      ),
    ] }, h)
}

/** "Delete from Trash" asks first, like Notion: there is no undo. */
const confirmDeleteView = (model: Model, pageId: string, h: HtmlBuilder<Message>): Html => {
  const entry = model.trash.find(item => item.id === pageId)
  return box({ class: 'contents', attributes: [h.Id('confirm-delete-layer')], children: [
      box({ class: 'fixed inset-0 z-50 bg-black/40', attributes: [h.AriaHidden(true), h.OnClick(Message.CanceledDelete())], children: [] }, h),
      box({ class: 'fixed top-[30vh] left-1/2 z-50 flex w-[min(380px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-border bg-background p-5 text-center shadow-xl', attributes: [
          h.Role('alertdialog'), h.AriaLabel('Delete page permanently'),
          h.OnKeyDownPreventDefault(key => (key === 'Escape' ? Option.some(Message.CanceledDelete()) : Option.none())),
        ], children: [
          box({ as: 'p', class: 'text-[14px]', children: [`Are you sure you want to delete ${entry === undefined ? 'this page' : `“${entry.title}”`} permanently? This cannot be undone.`] }, h),
          button({ variant: 'destructive', id: CONFIRM_DELETE_ID, onClick: Message.ConfirmedDelete({ pageId }), children: ['Yes. Delete this page'] }, h),
          button({ variant: 'ghost', id: 'cancel-delete', onClick: Message.CanceledDelete(), children: ['Cancel'] }, h),
        ] }, h),
    ] }, h)
}

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: `${model.view === 'trash' ? 'Trash' : model.page === null ? 'hypernotes' : titleOf(model.page)} · hypernotes`,
  body: pageRoot({ isDark: model.me.isDark, theme: model.me.theme, children: [
      // Ctrl+K inside the editor makes a link (the editor takes it first), so search also has Ctrl+P.
      keyBindings(h, [
        { keys: 'Mod+K', message: Message.ClickedSearch(), isEnabled: model.picker === null },
        { keys: 'Mod+P', message: Message.ClickedSearch(), isEnabled: model.picker === null, whileTyping: 'Allow' },
        // Browsers keep Ctrl+N for a new window, so a new page is Ctrl+Alt+N (Notion's web app too).
        { keys: 'Mod+Alt+N', message: Message.ClickedAdd({ parentId: null, section: 'private' }), isEnabled: model.picker === null, whileTyping: 'Allow' },
        { keys: 'Mod+\\', message: Message.ToggledSidebar({ isCollapsed: model.me.isSidebarCollapsed !== true }), whileTyping: 'Allow' },
        { keys: 'Mod+Shift+L', message: Message.ClickedToggleTheme(), whileTyping: 'Allow' },
        { keys: 'Escape', message: Message.ClickedCancelCover(), isEnabled: model.coverDraft !== null && model.picker === null },
      ]),
      region(h, {
        id: 'sidebar',
        deps: [model.me, model.nav, model.navDrag, model.pageId, model.view],
        render: () => sidebar({
          me: model.me,
          activeId: model.pageId,
          active: model.view === 'trash' ? '/?trash=1' : '',
          nav: model.nav,
          drag: model.navDrag,
          actions: {
            onToggle: (pageId, isOpen) => Message.ClickedToggle({ pageId, isOpen }),
            onAdd: (parentId, section) => Message.ClickedAdd({ parentId, section }),
            onMenu: (pageId, anchor) => Message.ClickedMenu({ pageId, anchor }),
            onSearch: Message.ClickedSearch(),
            onCollapse: Message.ToggledSidebar({ isCollapsed: true }),
            onResize: width => Message.ResizedSidebar({ width }),
            onDragStart: pageId => Message.StartedNavDrag({ pageId }),
            onDragEnter: drop => Message.EnteredNavDrop({ drop }),
            onDrop: Message.DroppedNav(),
            onDragEnd: Message.EndedNavDrag(),
          },
          isDark: model.me.isDark,
          onToggleTheme: Message.ClickedToggleTheme(),
        }, h),
      }),
      box({ as: 'main', class: 'flex min-w-0 flex-1 flex-col', children: [
          region(h, { id: 'topbar', deps: [model.viewers, model.me.id, model.me.isSidebarCollapsed === true, model.crumbs, model.isFavorite, model.page?.updatedAt ?? null, model.page?.isLocked ?? null, model.isInTrash, model.now], render: () => topBar(model, h) }),
          ...(model.page !== null && model.isInTrash ? [trashBanner(model.page, h)] : []),
          box({ class: 'min-h-0 flex-1 overflow-y-auto', attributes: [h.DataAttribute('keep-scroll', 'page')], children: [
              model.view === 'trash'
                ? region(h, { id: 'trash', deps: [model.trash, model.trashQuery, model.now], render: () => trashView(model, h) })
                : model.page === null
                  ? box({ as: 'p', class: 'p-16 text-center text-muted-foreground', attributes: [h.Id('empty')], children: [model.view === 'empty' ? 'No pages yet. Create one with + in the sidebar.' : 'This page does not exist or was deleted.'] }, h)
                  : region(h, { id: 'page-body', deps: [model.page, model.coverDraft, model.titleDraft, model.pages, model.crumbs, model.backlinks, model.isBacklinksOpen, model.comments, model.composer, model.isShowingResolved, model.me.id, model.now, model.isInTrash, model.rows, model.parentDatabase, model.db, model.people], render: () => pageBody(model, model.page as Page, h) }),
            ] }, h),
        ] }, h),
      ...(model.confirmDelete === null ? [] : [region(h, { id: 'confirm-delete-layer', deps: [model.confirmDelete, model.trash], render: () => confirmDeleteView(model, model.confirmDelete as string, h) })]),
      ...(model.history === null ? [] : [region(h, {
        id: 'history',
        deps: [model.history, model.versions, model.pages, model.people, model.crumbs, model.now, model.page?.isLocked ?? null, model.isInTrash],
        render: () => historyView(model, model.history as History, h),
      })]),
      ...(model.picker === null ? [] : [pickerView({
        picker: model.picker,
        items: pickerItems(model),
        itemIcon: item => {
          if (item.value.startsWith('emoji:')) return pageIcon(item.value.slice(6), h)
          const entry = model.pages.find(page => page.id === item.value || `page:${page.id}` === item.value)
          return entry === undefined ? undefined : pageIcon(entry.icon, h)
        },
        onQuery: query => Message.ChangedPickerQuery({ query }),
        onKey: key => Message.PressedPickerKey({ key }),
        onChoose: value => Message.ChosePicker({ value }),
        onClose: Message.ClosedPicker(),
        ...(model.picker.field === 'search' ? { title: 'Search', filters: [{ id: 'search-titles-only', label: 'Only titles', isPressed: model.isSearchTitlesOnly, onToggle: Message.ToggledSearchTitlesOnly() }] } : {}),
        ...(model.picker.field === 'options' ? { footer: optionsFooter(model) } : {}),
      }, h)]),
      ...(model.notice === null ? [] : [box({ class: 'fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md bg-foreground px-3 py-2 text-[13px] text-background', attributes: [h.Id('notice'), h.Role('status')], children: [model.notice, button({ variant: 'ghost', size: 'icon-xs', ariaLabel: 'Dismiss', onClick: Message.ClickedDismissNotice(), children: [Icon.icon('x', { class: 'size-3.5' }, h)] }, h)] }, h)]),
    ] }, h),
})

// PROGRAM

const firstPage = (state: WorkspaceState, memberId: string): string | null => {
  const nav = navOf(state, memberId)
  return nav.favorites[0]?.id ?? nav.workspace[0]?.id ?? nav.private[0]?.id ?? null
}

export const program: Program<Model, Message, ClientMessage, Flags, Workspace | Viewers> = {
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
  onConnectionChange: isConnected => Message.ChangedConnection({ isConnected }),
  clientCommands: {
    LoadUrl: ({ url }) => (typeof url === 'string' ? { load: url } : undefined),
    FocusElement: ({ selector }) => (typeof selector === 'string' ? { focus: selector } : undefined),
  },
  snapshotDeps: model => [model.picker, model.titleDraft, model.notice, model.db],
}

export { PICKER_INPUT_ID, checkedIndex, subtreeOf }
