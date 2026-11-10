import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import type { Comment, Page } from '@/app/domain'
import * as B from '@/app/editor/blocks'
import { MAX_INBOX, inboxOf, unreadCount } from '@/app/inbox'
import * as PagePage from '@/app/page/page'
import { DEMO_MEMBERS, demoData } from '@/app/seed'
import type { WorkspaceState } from '@/app/store'
import { markInboxSeen } from '@/app/workspace'

/* The Inbox: @-mentions of the person in pages they can see, and replies
   others left after them in their discussions; opening it marks them read. */

const NOW = Date.UTC(2026, 10, 10, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!
const PLAIN = B.paragraph('x', 'x').text[0]!.marks

const mentioning = (id: string, memberId: string) =>
  [{ ...B.paragraph(id), text: [{ _tag: 'Text' as const, text: 'Ask ', marks: PLAIN }, { _tag: 'PersonMention' as const, memberId, marks: PLAIN }, { _tag: 'Text' as const, text: ' first', marks: PLAIN }] }]

const comment = (id: string, threadId: string, authorId: string, createdAt: number, pageId = 'demo-wiki'): Comment =>
  ({ id, pageId, threadId, authorId, text: `${id} text`, createdAt, editedAt: null, resolvedAt: null, resolvedBy: null, quote: null, isDemo: false })

const stateWith = (edit: (page: Page) => Page, comments: ReadonlyArray<Comment> = []): WorkspaceState => {
  const data = demoData(NOW)
  return { version: 0, members: data.members, pages: data.pages.map(edit), favorites: data.favorites, expanded: data.expanded, comments, versions: data.versions }
}

describe('inbox', () => {
  it('lists the pages that @-mention the person, with the line that does', () => {
    const state = stateWith(page => (page.id === 'demo-wiki' ? { ...page, content: mentioning('m', 'avery'), updatedAt: NOW } : page))
    const [entry, ...rest] = inboxOf(state, 'avery')
    assert.deepStrictEqual(entry, { id: 'mention:demo-wiki', kind: 'Mention', pageId: 'demo-wiki', pageTitle: state.pages.find(page => page.id === 'demo-wiki')!.title, pageIcon: state.pages.find(page => page.id === 'demo-wiki')!.icon, actor: null, text: 'Ask @Avery Finch first', at: NOW })
    assert.isTrue(rest.every(other => other.kind !== 'Mention' || other.pageId !== 'demo-wiki'))
    assert.deepStrictEqual(inboxOf(state, 'morgan').filter(other => other.pageId === 'demo-wiki'), [])
  })

  it('leaves out pages the person cannot see and pages in Trash', () => {
    const hidden = stateWith(page => (page.id === 'demo-wiki' ? { ...page, content: mentioning('m', 'avery'), section: 'private', ownerId: 'morgan' } : page))
    assert.deepStrictEqual(inboxOf(hidden, 'avery').filter(entry => entry.pageId === 'demo-wiki'), [])
    const trashed = stateWith(page => (page.id === 'demo-wiki' ? { ...page, content: mentioning('m', 'avery'), trashedAt: NOW, trashedBy: 'avery' } : page))
    assert.deepStrictEqual(inboxOf(trashed, 'avery').filter(entry => entry.pageId === 'demo-wiki'), [])
  })

  it('lists replies others left after the person in their discussions, newest first', () => {
    const state = stateWith(page => page, [
      comment('before', 't', 'morgan', 1),
      comment('t', 't', 'avery', 2),
      comment('own', 't', 'avery', 3),
      comment('r1', 't', 'morgan', 4),
      comment('r2', 't', 'riley', 5),
      comment('elsewhere', 'u', 'morgan', 6),
    ])
    const entries = inboxOf(state, 'avery').filter(entry => entry.kind === 'Reply')
    assert.deepStrictEqual(entries.map(entry => entry.id), ['reply:r2', 'reply:r1'])
    assert.strictEqual(entries[1]?.actor, 'Morgan Vale')
    assert.strictEqual(entries[1]?.text, 'r1 text')
  })

  it('keeps at most MAX_INBOX entries and counts the unread ones', () => {
    const comments = [comment('t', 't', 'avery', 0), ...Array.from({ length: MAX_INBOX + 5 }, (_, index) => comment(`r${index}`, 't', 'morgan', index + 1))]
    const entries = inboxOf(stateWith(page => page, comments), 'avery')
    assert.strictEqual(entries.length, MAX_INBOX)
    assert.strictEqual(unreadCount(entries, MAX_INBOX), 5)
    assert.strictEqual(unreadCount(entries, 0), MAX_INBOX)
  })

  it('opening it marks everything read, from when it was opened', () => {
    const data = demoData(NOW)
    const [, seen] = Effect.runSync(markInboxSeen('avery')(data, { at: NOW + 5, id: prefix => `${prefix}-test` }))
    assert.strictEqual(seen.members.find(member => member.id === 'avery')?.inboxSeenAt, NOW + 5)
    assert.isUndefined(seen.members.find(member => member.id === 'morgan')?.inboxSeenAt)
  })

  it('the Inbox view marks it read on load and keeps the old unread dots', () => {
    const state = stateWith(page => page, [comment('t', 't', 'avery', NOW - 10), comment('r', 't', 'morgan', NOW - 5)])
    const slice = PagePage.sliceOf(state, null, 'avery', NOW)
    const me = { ...avery, inboxSeenAt: NOW - 7 }
    const opened = PagePage.init({ ...slice, me, view: 'inbox', pageId: null })
    assert.strictEqual(opened.model.inboxSeenBefore, NOW - 7)
    assert.deepStrictEqual((opened.commands ?? []).map(command => [command.name, command.args]), [['MarkInboxSeen', { memberId: 'avery' }]])
    const onPage = PagePage.init({ ...slice, me, view: 'page', pageId: 'demo-wiki' })
    assert.deepStrictEqual(onPage.commands ?? [], [])
    const later = PagePage.update(opened.model, PagePage.Message.GotPage({ ...slice, me: { ...me, inboxSeenAt: NOW } }))
    assert.deepStrictEqual(later.commands ?? [], [])
    assert.strictEqual(later.model.inboxSeenBefore, NOW - 7)
  })
})
