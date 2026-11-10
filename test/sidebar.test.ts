import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import type { Page } from '@/app/domain'
import { SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_WIDTH, sidebarWidth } from '@/app/domain'
import * as PagePage from '@/app/page/page'
import { DEMO_MEMBERS, demoData } from '@/app/seed'
import { setSidebar } from '@/app/workspace'

/* The sidebar: its width and whether it is closed belong to the person,
   are kept inside Notion's limits, and are saved by a Command. */

const NOW = Date.UTC(2026, 10, 10, 9)
const context = { at: NOW, id: (prefix: string) => `${prefix}-test` }
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!
type Result = ReturnType<typeof PagePage.update>
const commands = (result: Result) => (result.commands ?? []).map(command => [command.name, command.args] as const)
const argsOf = (result: Result, name: string) => commands(result).find(([entry]) => entry === name)?.[1] as Record<string, unknown> | undefined

const model = (pageId: string, edit: (page: Page) => Page = page => page) => {
  const data = demoData(NOW)
  const pages = data.pages.map(page => (page.id === pageId ? edit(page) : page))
  const slice = PagePage.sliceOf({ version: 0, members: data.members, pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }, pageId, 'avery', NOW)
  return PagePage.init({ ...slice, me: avery, view: 'page', pageId }).model
}

describe('sidebar', () => {
  it('a width stays between 200 and 480 px; anything unreadable is the default', () => {
    assert.strictEqual(sidebarWidth(undefined), SIDEBAR_WIDTH)
    assert.strictEqual(sidebarWidth(Number.NaN), SIDEBAR_WIDTH)
    assert.strictEqual(sidebarWidth(10), SIDEBAR_MIN)
    assert.strictEqual(sidebarWidth(9000), SIDEBAR_MAX)
    assert.strictEqual(sidebarWidth(301.6), 302)
  })

  it('the workspace keeps the width and the closed state per person', () => {
    const data = demoData(NOW)
    const [, wide] = Effect.runSync(setSidebar('avery', { width: 9000 })(data, context))
    const [, closed] = Effect.runSync(setSidebar('avery', { isCollapsed: true })(wide, context))
    const me = closed.members.find(member => member.id === 'avery')!
    assert.strictEqual(me.sidebarWidth, SIDEBAR_MAX)
    assert.isTrue(me.isSidebarCollapsed)
    assert.isUndefined(closed.members.find(member => member.id === 'morgan')!.isSidebarCollapsed)
  })

  it('closing and opening saves it and shows at once', () => {
    const closed = PagePage.update(model('demo-wiki'), PagePage.Message.ToggledSidebar({ isCollapsed: true }))
    assert.isTrue(closed.model.me.isSidebarCollapsed)
    assert.deepStrictEqual(argsOf(closed, 'SetSidebar'), { memberId: 'avery', isCollapsed: true })
    const opened = PagePage.update(closed.model, PagePage.Message.ToggledSidebar({ isCollapsed: false }))
    assert.isFalse(opened.model.me.isSidebarCollapsed)
  })

  it('a dragged width is clamped before it is saved; a broken one is ignored', () => {
    const resized = PagePage.update(model('demo-wiki'), PagePage.Message.ResizedSidebar({ width: 1200 }))
    assert.strictEqual(resized.model.me.sidebarWidth, SIDEBAR_MAX)
    assert.deepStrictEqual(argsOf(resized, 'SetSidebar'), { memberId: 'avery', width: SIDEBAR_MAX })
    const broken = PagePage.update(model('demo-wiki'), PagePage.Message.ResizedSidebar({ width: Number.POSITIVE_INFINITY }))
    assert.deepStrictEqual(commands(broken), [])
  })


  it('Rename opens with the title and saves the trimmed new one', () => {
    const menu = PagePage.update(model('demo-wiki'), PagePage.Message.ClickedMenu({ pageId: 'demo-onboarding', anchor: '--nav-demo-onboarding' }))
    const renaming = PagePage.update(menu.model, PagePage.Message.ChosePicker({ value: 'rename' }))
    assert.strictEqual(renaming.model.picker?.field, 'rename')
    assert.strictEqual(renaming.model.picker?.query, menu.model.pages.find(entry => entry.id === 'demo-onboarding')?.title)
    const typed = PagePage.update(renaming.model, PagePage.Message.ChangedPickerQuery({ query: '  Welcome  ' }))
    const saved = PagePage.update(typed.model, PagePage.Message.ChosePicker({ value: 'rename' }))
    assert.isNull(saved.model.picker)
    assert.deepStrictEqual(argsOf(saved, 'SaveTitle'), { pageId: 'demo-onboarding', title: 'Welcome', actorId: 'avery' })
    const blank = PagePage.update(PagePage.update(renaming.model, PagePage.Message.ChangedPickerQuery({ query: '   ' })).model, PagePage.Message.ChosePicker({ value: 'rename' }))
    assert.deepStrictEqual(commands(blank), [])
  })

  it('Copy link closes the menu and tells you (the browser writes the address)', () => {
    const menu = PagePage.update(model('demo-wiki'), PagePage.Message.ClickedMenu({ pageId: 'demo-onboarding', anchor: '--nav-demo-onboarding' }))
    const copied = PagePage.update(menu.model, PagePage.Message.ChosePicker({ value: 'copylink' }))
    assert.isNull(copied.model.picker)
    assert.strictEqual(copied.model.notice, 'Copied link to clipboard')
    assert.deepStrictEqual(commands(copied), [])
  })

  const dragTo = (pageId: string, drop: Parameters<typeof PagePage.Message.EnteredNavDrop>[0]['drop']) => {
    const started = PagePage.update(model('demo-wiki'), PagePage.Message.StartedNavDrag({ pageId }))
    const entered = PagePage.update(started.model, PagePage.Message.EnteredNavDrop({ drop }))
    return PagePage.update(entered.model, PagePage.Message.DroppedNav())
  }

  it('a row dropped above another becomes its sibling there', () => {
    const top = dragTo('demo-meetings', { place: 'before', rowId: 'demo-wiki', section: 'workspace' })
    assert.isNull(top.model.navDrag)
    assert.deepStrictEqual(argsOf(top, 'MovePage'), { pageId: 'demo-meetings', parentId: null, section: 'workspace', beforeId: 'demo-wiki', actorId: 'avery' })
    const nested = dragTo('demo-meetings', { place: 'before', rowId: 'demo-style', section: 'workspace' })
    assert.deepStrictEqual(argsOf(nested, 'MovePage'), { pageId: 'demo-meetings', parentId: 'demo-wiki', section: 'workspace', beforeId: 'demo-style', actorId: 'avery' })
  })

  it('a row dropped onto another goes inside it, last, and opens it', () => {
    const inside = dragTo('demo-meetings', { place: 'inside', rowId: 'demo-style', section: 'workspace' })
    assert.deepStrictEqual(argsOf(inside, 'MovePage'), { pageId: 'demo-meetings', parentId: 'demo-style', section: 'workspace', beforeId: null, actorId: 'avery' })
    assert.deepStrictEqual(argsOf(inside, 'SetExpanded'), { pageId: 'demo-style', isOpen: true, actorId: 'avery' })
    const open = dragTo('demo-meetings', { place: 'inside', rowId: 'demo-wiki', section: 'workspace' })
    assert.isUndefined(argsOf(open, 'SetExpanded'))
  })

  it('the end of a section moves it there, even from the other section', () => {
    const end = dragTo('demo-meetings', { place: 'end', rowId: '', section: 'private' })
    assert.deepStrictEqual(argsOf(end, 'MovePage'), { pageId: 'demo-meetings', parentId: null, section: 'private', beforeId: null, actorId: 'avery' })
  })

  it('a page never lands on itself or inside its own subtree', () => {
    assert.deepStrictEqual(commands(dragTo('demo-wiki', { place: 'inside', rowId: 'demo-wiki', section: 'workspace' })), [])
    assert.deepStrictEqual(commands(dragTo('demo-wiki', { place: 'inside', rowId: 'demo-onboarding', section: 'workspace' })), [])
    assert.deepStrictEqual(commands(dragTo('demo-wiki', { place: 'before', rowId: 'demo-style', section: 'workspace' })), [])
  })

  it('unknown rows, drops without a drag and ended drags change nothing', () => {
    const idle = PagePage.update(model('demo-wiki'), PagePage.Message.EnteredNavDrop({ drop: { place: 'inside', rowId: 'demo-wiki', section: 'workspace' } }))
    assert.isNull(idle.model.navDrag)
    assert.deepStrictEqual(commands(PagePage.update(idle.model, PagePage.Message.DroppedNav())), [])
    const unknown = PagePage.update(model('demo-wiki'), PagePage.Message.StartedNavDrag({ pageId: 'nope' }))
    assert.isNull(unknown.model.navDrag)
    const started = PagePage.update(model('demo-wiki'), PagePage.Message.StartedNavDrag({ pageId: 'demo-meetings' }))
    const elsewhere = PagePage.update(started.model, PagePage.Message.EnteredNavDrop({ drop: { place: 'inside', rowId: 'nope', section: 'workspace' } }))
    assert.isNull(elsewhere.model.navDrag?.target)
    assert.isNull(PagePage.update(started.model, PagePage.Message.EndedNavDrag()).model.navDrag)
  })

  it('the workspace switcher lists the account, settings, theme and log out', () => {
    const opened = PagePage.update(model('demo-wiki'), PagePage.Message.ClickedWorkspaceMenu())
    assert.strictEqual(opened.model.picker?.field, 'workspace')
    assert.strictEqual(opened.model.picker?.anchor, '--workspace-menu')
    const items = PagePage.pickerItems(opened.model)
    assert.deepStrictEqual(items.map(item => item.value), ['current', 'settings', 'theme', 'logout'])
    assert.strictEqual(items[0]?.group, avery.email)
    assert.strictEqual(items[0]?.label, "Avery's hypernotes")
    assert.strictEqual(items[2]?.label, avery.isDark ? 'Light theme' : 'Dark theme')
  })

  it('its choices open settings, switch the theme, or log out', () => {
    const opened = PagePage.update(model('demo-wiki'), PagePage.Message.ClickedWorkspaceMenu()).model
    const choose = (value: string) => PagePage.update(opened, PagePage.Message.ChosePicker({ value }))
    assert.deepStrictEqual(argsOf(choose('settings'), 'LoadUrl'), { url: '/settings' })
    assert.deepStrictEqual(argsOf(choose('theme'), 'SetTheme'), { memberId: 'avery', isDark: !avery.isDark })
    const out = choose('logout')
    assert.isTrue(out.model.isSigningOut)
    assert.isNull(out.model.picker)
    assert.deepStrictEqual(commands(out), [])
    const current = choose('current')
    assert.isNull(current.model.picker)
    assert.isFalse(current.model.isSigningOut)
    assert.deepStrictEqual(commands(current), [])
  })
})
