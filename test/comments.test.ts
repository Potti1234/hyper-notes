import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import * as PagePage from '@/app/page/page'
import { DEMO_HOME, DEMO_MEMBERS, demoData } from '@/app/seed'
import { Workspace } from '@/app/store'
import { workspaceLayer } from './support'

/* Page discussions: start one, reply, edit and delete your own, resolve and
   reopen; the store refuses what the page would not offer. */

const run = <A, E>(effect: Effect.Effect<A, E, Workspace>) => Effect.provide(effect, workspaceLayer())
const NOW = Date.UTC(2026, 10, 10, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!

describe('workspace: comments', () => {
  it.effect('starts a discussion, replies, edits and resolves it', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const thread = yield* workspace.addComment({ pageId: DEMO_HOME, threadId: null }, '  First thought  ', 'avery')
      assert.strictEqual(thread.threadId, thread.id)
      assert.strictEqual(thread.text, 'First thought')
      const reply = yield* workspace.addComment({ pageId: DEMO_HOME, threadId: thread.id }, 'Agreed', 'morgan')
      assert.strictEqual(reply.threadId, thread.id)
      const edited = yield* workspace.editComment(thread.id, 'Second thought', 'avery')
      assert.isNotNull(edited.editedAt)
      assert.strictEqual((yield* Effect.flip(workspace.editComment(thread.id, 'Mine now', 'morgan'))).reason, 'Only its author can edit a comment.')
      assert.strictEqual((yield* Effect.flip(workspace.addComment({ pageId: DEMO_HOME, threadId: null }, '   ', 'avery')))._tag, 'InvalidChange')
      assert.strictEqual((yield* Effect.flip(workspace.resolveThread(reply.id, true, 'avery'))).reason, 'Only a discussion can be resolved.')
      const resolved = yield* workspace.resolveThread(thread.id, true, 'morgan')
      assert.strictEqual(resolved.resolvedBy, 'morgan')
      assert.strictEqual((yield* Effect.flip(workspace.addComment({ pageId: DEMO_HOME, threadId: thread.id }, 'More', 'riley'))).reason, 'Reopen the discussion to reply.')
      const reopened = yield* workspace.resolveThread(thread.id, false, 'riley')
      assert.isNull(reopened.resolvedAt)
    })))

  it.effect('deleting a discussion takes its replies; deleting a page takes its comments', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const page = yield* workspace.createPage({ parentId: null, section: 'workspace', title: 'Talk' }, 'avery')
      const thread = yield* workspace.addComment({ pageId: page.id, threadId: null }, 'One', 'avery')
      const reply = yield* workspace.addComment({ pageId: page.id, threadId: thread.id }, 'Two', 'morgan')
      assert.strictEqual((yield* Effect.flip(workspace.deleteComment(reply.id, 'avery'))).reason, 'Only its author can delete a comment.')
      assert.strictEqual(yield* workspace.deleteComment(thread.id, 'avery'), 2)
      yield* workspace.addComment({ pageId: page.id, threadId: null }, 'Three', 'avery')
      yield* workspace.trashPage(page.id, 'avery')
      assert.strictEqual((yield* Effect.flip(workspace.addComment({ pageId: page.id, threadId: null }, 'Four', 'avery'))).reason, 'Restore the page to comment on it.')
      yield* workspace.deletePage(page.id, 'avery')
      assert.isFalse((yield* workspace.current).comments.some(comment => comment.pageId === page.id))
    })))

  it.effect('private pages take comments only from their owner', () =>
    run(Effect.gen(function* () {
      const workspace = yield* Workspace
      const page = yield* workspace.createPage({ parentId: null, section: 'private', title: 'Mine' }, 'avery')
      assert.strictEqual((yield* Effect.flip(workspace.addComment({ pageId: page.id, threadId: null }, 'Hi', 'morgan'))).reason, 'That page does not exist.')
    })))
})

describe('page: comments', () => {
  const model = (pageId = DEMO_HOME): PagePage.Model => {
    const data = demoData(NOW)
    const slice = PagePage.sliceOf({ version: 0, members: data.members, pages: data.pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }, pageId, 'avery', NOW)
    return PagePage.init({ ...slice, me: avery, view: 'page', pageId }).model
  }
  const tags = (result: ReturnType<typeof PagePage.update>) => (result.commands ?? []).map(command => command.name)

  it('shows the page discussions with their authors', () => {
    const threads = PagePage.threadsOf(model().comments)
    assert.strictEqual(threads.length, 1)
    assert.strictEqual(threads[0]?.root.author?.name, DEMO_MEMBERS.find(member => member.id === 'morgan')?.name)
    assert.strictEqual(threads[0]?.replies.length, 1)
  })

  it('opens a focused comment box, sends it once there is text, and closes it', () => {
    const opened = PagePage.update(model(), PagePage.Message.ClickedAddComment())
    assert.deepStrictEqual(opened.model.composer, { _tag: 'NewDiscussion', text: '' })
    assert.deepStrictEqual(tags(opened), ['FocusElement'])
    assert.deepStrictEqual(tags(PagePage.update(opened.model, PagePage.Message.SubmittedComment())), [])
    const typed = PagePage.update(opened.model, PagePage.Message.ChangedComment({ text: 'Hello' })).model
    const sent = PagePage.update(typed, PagePage.Message.SubmittedComment())
    assert.isNull(sent.model.composer)
    assert.deepStrictEqual(tags(sent), ['AddComment'])
    assert.isNull(PagePage.update(typed, PagePage.Message.ClickedCancelComment()).model.composer)
  })

  it('replies in open discussions, edits and deletes only your own comments', () => {
    const base = model()
    assert.deepStrictEqual(PagePage.update(base, PagePage.Message.ClickedReply({ threadId: 'demo-comment-1' })).model.composer, { _tag: 'Reply', threadId: 'demo-comment-1', text: '' })
    assert.isNull(PagePage.update(base, PagePage.Message.ClickedReply({ threadId: 'demo-comment-2' })).model.composer)
    assert.isNull(PagePage.update(base, PagePage.Message.ClickedEditComment({ commentId: 'demo-comment-1' })).model.composer)
    assert.deepStrictEqual(tags(PagePage.update(base, PagePage.Message.ClickedDeleteComment({ commentId: 'demo-comment-1' }))), [])
    const own = { ...base, comments: base.comments.map(comment => (comment.id === 'demo-comment-2' ? { ...comment, authorId: 'avery' } : comment)) }
    assert.deepStrictEqual(PagePage.update(own, PagePage.Message.ClickedEditComment({ commentId: 'demo-comment-2' })).model.composer, { _tag: 'Edit', commentId: 'demo-comment-2', text: own.comments[1]!.text })
    assert.deepStrictEqual(tags(PagePage.update(own, PagePage.Message.ClickedDeleteComment({ commentId: 'demo-comment-2' }))), ['DeleteComment'])
  })

  it('resolving closes its reply box; a box whose comment is gone closes on the next slice', () => {
    const replying = PagePage.update(model(), PagePage.Message.ClickedReply({ threadId: 'demo-comment-1' })).model
    const resolved = PagePage.update(replying, PagePage.Message.ClickedResolve({ threadId: 'demo-comment-1', isResolved: true }))
    assert.isNull(resolved.model.composer)
    assert.deepStrictEqual(tags(resolved), ['ResolveThread'])
    const { _tag: _, ...gone } = PagePage.Message.GotPage({ ...replying, comments: [] })
    assert.isNull(PagePage.update(replying, PagePage.Message.GotPage(gone)).model.composer)
  })

  it('has no comment box in Trash', () => {
    assert.isNull(PagePage.update({ ...model(), isInTrash: true }, PagePage.Message.ClickedAddComment()).model.composer)
  })
})
