import { Schema as S } from 'effect'

import * as Island from '@hyper-effect/island/contract'

import { Document } from './schema'

/* The page editor island's contract, shared by the page (which renders the
   island and stores what it sends) and the browser (which runs the editor). */

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
})
export type EditorProps = typeof EditorProps.Type

/** Editor → server: content a moment after typing stops (validated by
 *  `updatePage`), a request for a page behind a new sub-page block, or a page to open. */
export const EditorEvent = S.Union([
  S.TaggedStruct('ChangedContent', { pageId: S.String, content: Document }),
  S.TaggedStruct('CreatedSubPage', { pageId: S.String, blockId: S.String, childId: S.String }),
  S.TaggedStruct('OpenedPage', { pageId: S.String }),
])
export type EditorEvent = typeof EditorEvent.Type

export const PageEditor = Island.define({ tag: 'page-editor', Props: EditorProps, Event: EditorEvent })
