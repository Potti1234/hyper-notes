import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import * as B from '@/app/editor/blocks'
import { SLASH_ITEMS } from '@/app/editor/menus'
import { blocksMarkdown } from '@/app/markdown'
import * as PagePage from '@/app/page/page'
import { DEMO_MEMBERS, demoData } from '@/app/seed'
import { type WorkspaceData, createInlineDatabase } from '@/app/workspace'

/* Inline databases: a block naming a child page that is a table database,
   framed in its parent at /p/<id>?embed=1. */

const NOW = Date.UTC(2026, 10, 10, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!
let seq = 0
const context = { at: NOW, id: (prefix: string) => `${prefix}-i${++seq}` }
const run = <A>(op: (data: WorkspaceData, ctx: typeof context) => Effect.Effect<readonly [A, WorkspaceData], unknown>, data: WorkspaceData) => Effect.runSync(op(data, context))
const modelOf = (data: WorkspaceData, pageId: string, view: 'page' | 'embed' = 'page') => {
  const slice = PagePage.sliceOf({ version: 0, ...data }, pageId, 'avery', NOW)
  return PagePage.init({ ...slice, me: avery, view, pageId }).model
}

describe('inline databases', () => {
  it('makes a table database as a child page of the page holding the block', () => {
    const [page, data] = run(createInlineDatabase({ id: 'pinline', parentId: 'demo-wiki', section: 'workspace' }, 'avery'), demoData(NOW))
    assert.strictEqual(page.id, 'pinline')
    assert.strictEqual(page.parentId, 'demo-wiki')
    assert.strictEqual(page.database?.views[0]?.layout, 'table')
    assert.isTrue(data.pages.some(entry => entry.id === 'pinline' && entry.database !== null))
  })

  it('the editor reports a new inline database and update creates it', () => {
    const model = modelOf(demoData(NOW), 'demo-wiki')
    const event = (childId: string) => PagePage.Message.GotEditorEvent({ event: { _tag: 'CreatedInlineDatabase', pageId: 'demo-wiki', blockId: 'b1', childId } })
    assert.deepStrictEqual((PagePage.update(model, event('pabc')).commands ?? []).map(command => [command.name, command.args]), [
      ['CreateInlineDatabase', { parentId: 'demo-wiki', childId: 'pabc', section: 'workspace', actorId: 'avery' }],
    ])
    assert.deepStrictEqual(PagePage.update(model, event('../x')).commands ?? [], [])
    const locked = { ...model, page: { ...model.page!, isLocked: true } }
    assert.deepStrictEqual(PagePage.update(locked, event('pabc')).commands ?? [], [])
  })

  it('a framed database opens rows as pages instead of peeks', () => {
    const model = modelOf(demoData(NOW), 'demo-tasks', 'embed')
    const row = model.rows[0]!
    assert.isNull(PagePage.update(model, PagePage.Message.ClickedPeek({ rowId: row.id })).model.db.peek)
    assert.strictEqual(PagePage.update(modelOf(demoData(NOW), 'demo-tasks'), PagePage.Message.ClickedPeek({ rowId: row.id })).model.db.peek, row.id)
  })

  it('/database turns a block into an empty inline database; Markdown links to it', () => {
    const item = SLASH_ITEMS.find(entry => entry.id === 'database')
    assert.strictEqual(item?.tag, 'InlineDatabase')
    assert.deepStrictEqual(B.kindOf('InlineDatabase'), { _tag: 'InlineDatabase', pageId: '' })
    const block = { ...B.paragraph('b1', ''), kind: { _tag: 'InlineDatabase' as const, pageId: 'demo-tasks' } }
    assert.include(blocksMarkdown([block], { page: () => 'Tasks', person: () => '' }), '[Tasks](/p/demo-tasks)')
  })
})
