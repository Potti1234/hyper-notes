import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import * as B from '@/app/editor/blocks'
import * as PagePage from '@/app/page/page'
import { DEMO_MEMBERS, demoData } from '@/app/seed'
import { type WorkspaceData, addFromTemplate, addTemplate, updatePage } from '@/app/workspace'

/* Database templates: hidden rows edited as pages; a new row from one starts
   with its title, icon, values and content (fresh block ids). */

const NOW = Date.UTC(2026, 10, 10, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!
let seq = 0
const context = { at: NOW, id: (prefix: string) => `${prefix}-t${++seq}` }
const run = <A>(op: (data: WorkspaceData, ctx: typeof context) => Effect.Effect<readonly [A, WorkspaceData], unknown>, data: WorkspaceData) => Effect.runSync(op(data, context))
const modelOf = (data: WorkspaceData, pageId: string) => {
  const slice = PagePage.sliceOf({ version: 0, ...data }, pageId, 'avery', NOW)
  return PagePage.init({ ...slice, me: avery, view: 'page', pageId }).model
}

describe('database templates', () => {
  it('a template is a hidden row; a row made from it copies it', () => {
    const [template, withTemplate] = run(addTemplate('demo-tasks', 'avery'), demoData(NOW))
    assert.isTrue(template.isTemplate)
    const [, edited] = run(updatePage(template.id, { title: 'Bug report', icon: '🐞', content: [B.paragraph('b1', 'Steps to reproduce')] }, 'avery'), withTemplate)
    const tasks = modelOf(edited, 'demo-tasks')
    assert.deepStrictEqual(tasks.templates, [{ id: template.id, title: 'Bug report' }])
    assert.isFalse(tasks.rows.some(row => row.id === template.id))
    const [row, after] = run(addFromTemplate(template.id, 'avery'), edited)
    assert.notStrictEqual(row.isTemplate, true)
    assert.strictEqual(row.title, 'Bug report')
    assert.strictEqual(row.icon, '🐞')
    assert.strictEqual(row.content[0]?.text.map(piece => (piece._tag === 'Text' ? piece.text : '')).join(''), 'Steps to reproduce')
    assert.notStrictEqual(row.content[0]?.id, 'b1')
    assert.isTrue(modelOf(after, 'demo-tasks').rows.some(entry => entry.id === row.id))
    const plainRow = modelOf(after, 'demo-tasks').rows[0]!
    assert.strictEqual(Effect.runSync(Effect.flip(addFromTemplate(plainRow.id, 'avery')(after, context))).reason, 'That template is gone.')
  })

  it('the New page menu lists templates, then Empty page, edit links and New template', () => {
    const [template, data] = run(addTemplate('demo-tasks', 'avery'), demoData(NOW))
    const opened = PagePage.update(modelOf(data, 'demo-tasks'), PagePage.Message.ClickedTemplates())
    assert.strictEqual(opened.model.picker?.field, 'templates')
    assert.deepStrictEqual(PagePage.pickerItems(opened.model).map(item => item.value), [`use:${template.id}`, 'empty', `edit:${template.id}`, 'add'])
    const commandOf = (value: string) => (PagePage.update(opened.model, PagePage.Message.ChosePicker({ value })).commands ?? []).map(command => [command.name, command.args])
    assert.deepStrictEqual(commandOf(`use:${template.id}`), [['AddFromTemplate', { templateId: template.id, actorId: 'avery' }]])
    assert.deepStrictEqual(commandOf(`edit:${template.id}`), [['LoadUrl', { url: `/p/${template.id}` }]])
    assert.deepStrictEqual(commandOf('add'), [['AddTemplate', { databaseId: 'demo-tasks', actorId: 'avery' }]])
    assert.deepStrictEqual(commandOf('empty').map(([name]) => name), ['AddRow'])
    assert.deepStrictEqual(commandOf('use:demo-task-1'), [])
    const locked = { ...opened.model, page: { ...opened.model.page!, isLocked: true } }
    assert.deepStrictEqual(PagePage.update(locked, PagePage.Message.ChosePicker({ value: 'add' })).commands ?? [], [])
  })
})
