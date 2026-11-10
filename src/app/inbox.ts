import { Schema as S } from 'effect'

import { titleOf } from './domain'
import type { Block, RichText } from './editor/schema'
import { plainText } from './editor/text'
import type { WorkspaceState } from './store'
import { canSee, isTrashed } from './workspace'

/* The Inbox: pages where the person is @-mentioned, and replies others left
   in discussions the person took part in. It is derived from the workspace,
   newest first; entries newer than Member.inboxSeenAt are unread. */

export const InboxKind = S.Literals(['Mention', 'Reply'])
export type InboxKind = typeof InboxKind.Type

export const InboxEntry = S.Struct({
  id: S.String,
  kind: InboxKind,
  pageId: S.String,
  pageTitle: S.String,
  pageIcon: S.String,
  /** Who replied (null for a mention: the page does not record who wrote it). */
  actor: S.NullOr(S.String),
  /** The reply, or the line with the mention. */
  text: S.String,
  at: S.Number,
})
export type InboxEntry = typeof InboxEntry.Type

export const MAX_INBOX = 50
const MAX_TEXT = 200

const clip = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat
}

/** The lines of a doc that @-mention the member, mentions read as their names. */
export const mentionLines = (state: WorkspaceState, doc: ReadonlyArray<Block>, memberId: string): ReadonlyArray<string> => {
  const label = (text: RichText): string =>
    plainText(text, piece => {
      switch (piece._tag) {
        case 'PageMention': {
          const page = state.pages.find(entry => entry.id === piece.pageId)
          return page === undefined ? '' : titleOf(page)
        }
        case 'PersonMention': return `@${state.members.find(member => member.id === piece.memberId)?.name ?? 'Unknown'}`
        case 'DateMention': return piece.date
        case 'InlineEquation': return piece.tex
      }
    })
  const lines: Array<string> = []
  const walk = (blocks: ReadonlyArray<Block>): void => {
    for (const entry of blocks) {
      const texts = [entry.text, ...(entry.kind._tag === 'Table' ? entry.kind.rows.flat() : [])]
      for (const text of texts) if (text.some(piece => piece._tag === 'PersonMention' && piece.memberId === memberId)) lines.push(label(text))
      walk(entry.children)
    }
  }
  walk(doc)
  return lines
}

export const inboxOf = (state: WorkspaceState, memberId: string): ReadonlyArray<InboxEntry> => {
  const pages = new Map(state.pages.filter(page => canSee(page, memberId) && !isTrashed(state.pages, page)).map(page => [page.id, page]))
  const nameOf = (id: string): string | null => (id === memberId ? null : (state.members.find(member => member.id === id)?.name ?? null))
  const mentions = [...pages.values()].flatMap((page): ReadonlyArray<InboxEntry> => {
    const line = mentionLines(state, page.content, memberId)[0]
    return line === undefined
      ? []
      : [{ id: `mention:${page.id}`, kind: 'Mention', pageId: page.id, pageTitle: titleOf(page), pageIcon: page.icon, actor: null, text: clip(line), at: page.updatedAt }]
  })
  const joined = new Map<string, number>()
  for (const comment of state.comments) {
    if (comment.authorId !== memberId) continue
    joined.set(comment.threadId, Math.min(joined.get(comment.threadId) ?? Infinity, comment.createdAt))
  }
  const replies = state.comments.flatMap((comment): ReadonlyArray<InboxEntry> => {
    const since = joined.get(comment.threadId)
    const page = pages.get(comment.pageId)
    return comment.authorId === memberId || since === undefined || comment.createdAt <= since || page === undefined
      ? []
      : [{ id: `reply:${comment.id}`, kind: 'Reply', pageId: page.id, pageTitle: titleOf(page), pageIcon: page.icon, actor: nameOf(comment.authorId), text: clip(comment.text), at: comment.createdAt }]
  })
  return [...mentions, ...replies].sort((a, b) => b.at - a.at).slice(0, MAX_INBOX)
}

export const unreadCount = (entries: ReadonlyArray<InboxEntry>, seenAt: number): number => entries.filter(entry => entry.at > seenAt).length
