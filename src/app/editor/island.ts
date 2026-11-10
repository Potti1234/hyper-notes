import { Schema as S } from 'effect'

import * as Island from '@hyper-effect/island/contract'

import { Document } from './schema'

/* The page editor island's contract, shared by the page (which renders the
   island and stores what it sends) and the browser (which runs the editor). */

/** The longest text a discussion can be started on. */
export const MAX_QUOTE = 1000

export const PageRef = S.Struct({ id: S.String, title: S.String, icon: S.String })
export type PageRef = typeof PageRef.Type

export const MemberRef = S.Struct({ id: S.String, name: S.String })
export type MemberRef = typeof MemberRef.Type

/** Server → editor. `content` saved by someone else is applied when the editor
 *  has no pending edits of its own; `revision` tells it apart from an echo. */
export const EditorProps = S.Struct({
  pageId: S.String,
  content: Document,
  revision: S.Number,
  isEditable: S.Boolean,
  pages: S.Array(PageRef),
  members: S.Array(MemberRef),
  crumbs: S.Array(PageRef),
  /** The day `@today` means, YYYY-MM-DD (the page's clock, so the editor stays pure). */
  today: S.String,
  /** Open discussions on text: their marks are highlighted; the active one stronger. */
  threads: S.Array(S.String),
  activeThread: S.NullOr(S.String),
})
export type EditorProps = typeof EditorProps.Type

/** Editor → server: content a moment after typing stops (validated by
 *  `updatePage`), a request for a page behind a new sub-page block, or a page to open. */
export const EditorEvent = S.Union([
  S.TaggedStruct('ChangedContent', { pageId: S.String, content: Document }),
  S.TaggedStruct('CreatedSubPage', { pageId: S.String, blockId: S.String, childId: S.String }),
  S.TaggedStruct('CreatedInlineDatabase', { pageId: S.String, blockId: S.String, childId: S.String }),
  S.TaggedStruct('OpenedPage', { pageId: S.String }),
  /** Comment on the selected text (`quote` is that text, checked by the store). */
  S.TaggedStruct('StartedComment', { pageId: S.String, blockId: S.String, from: S.Number, to: S.Number, quote: S.String }),
  S.TaggedStruct('OpenedComment', { pageId: S.String, threadId: S.String }),
])
export type EditorEvent = typeof EditorEvent.Type

export const PageEditor = Island.define({ tag: 'page-editor', Props: EditorProps, Event: EditorEvent })
