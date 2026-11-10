import { Schema as S } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import * as Icon from '@/lib/icon'
import { cn } from '@/lib/utils'
import { button } from '@/ui/button'
import { kbd } from '@/ui/kbd'

import { type Member, type Page, type Section, firstName, titleOf } from '../domain'
import type { WorkspaceState } from '../store'
import { canSee, childrenOf, isTrashed } from '../workspace'
import { box } from './design'
import { avatar, pageIcon } from './icons'

/* The app shell: Notion's left sidebar (Favorites, Workspace and Private
   page trees, search, settings, trash) and the frame around a page. Each
   page renders it; navigation between pages is a page load. */

/** A sidebar row: a page at a depth of its tree. */
export const NavRow = S.Struct({
  id: S.String,
  title: S.String,
  icon: S.String,
  depth: S.Number,
  hasChildren: S.Boolean,
  isOpen: S.Boolean,
})
export type NavRow = typeof NavRow.Type

export const Nav = S.Struct({
  favorites: S.Array(NavRow),
  workspace: S.Array(NavRow),
  private: S.Array(NavRow),
})
export type Nav = typeof Nav.Type

const visibleChildren = (state: WorkspaceState, parentId: string | null, section: Section | null, memberId: string): ReadonlyArray<Page> =>
  childrenOf(state.pages, parentId).filter(page => canSee(page, memberId) && (section === null || page.section === section))

const tree = (state: WorkspaceState, parentId: string | null, section: Section | null, memberId: string, open: ReadonlySet<string>, depth: number): ReadonlyArray<NavRow> =>
  visibleChildren(state, parentId, section, memberId).flatMap(page => {
    const hasChildren = visibleChildren(state, page.id, null, memberId).length > 0
    const isOpen = open.has(page.id)
    const row: NavRow = { id: page.id, title: titleOf(page), icon: page.icon, depth, hasChildren, isOpen }
    return [row, ...(isOpen ? tree(state, page.id, null, memberId, open, depth + 1) : [])]
  })

/** What someone's sidebar shows: the trees with the rows they opened. */
export const navOf = (state: WorkspaceState, memberId: string): Nav => {
  const open = new Set(state.expanded.filter(row => row.memberId === memberId).map(row => row.pageId))
  const favorites = state.favorites
    .filter(row => row.memberId === memberId)
    .sort((a, b) => a.position - b.position)
    .flatMap(row => {
      const page = state.pages.find(entry => entry.id === row.pageId)
      return page === undefined || !canSee(page, memberId) || isTrashed(state.pages, page) ? [] : [{ id: page.id, title: titleOf(page), icon: page.icon, depth: 0, hasChildren: false, isOpen: false }]
    })
  return {
    favorites,
    workspace: tree(state, null, 'workspace', memberId, open, 0),
    private: tree(state, null, 'private', memberId, open, 0),
  }
}

const sameRow = (a: NavRow, b: NavRow | undefined): boolean =>
  b !== undefined && a.id === b.id && a.title === b.title && a.icon === b.icon && a.depth === b.depth && a.hasChildren === b.hasChildren && a.isOpen === b.isOpen

const sameRows = (a: ReadonlyArray<NavRow>, b: ReadonlyArray<NavRow>): boolean => a.length === b.length && a.every((row, index) => sameRow(row, b[index]))

export const sameNav = (a: Nav, b: Nav): boolean => sameRows(a.favorites, b.favorites) && sameRows(a.workspace, b.workspace) && sameRows(a.private, b.private)

/** The CSS anchor name of a row's ••• button (its page menu opens there). */
export const rowAnchor = (where: string, pageId: string): string => `--row-${where}-${pageId.replace(/[^A-Za-z0-9_-]/g, '')}`

/** What the sidebar can do on pages that handle it; elsewhere rows are links. */
export type SidebarActions<Msg> = Readonly<{
  onToggle: (pageId: string, isOpen: boolean) => Msg
  /** A new page inside `parentId`, or at the top of a section. */
  onAdd: (parentId: string | null, section: Section) => Msg
  /** The page's ••• menu, anchored to the row. */
  onMenu: (pageId: string, anchor: string) => Msg
  onSearch: Msg
}>

export type SidebarProps<Msg> = Readonly<{
  me: Member
  /** The page shown, to highlight its rows. */
  activeId: string | null
  active: string
  nav: Nav
  actions?: SidebarActions<Msg>
  isDark: boolean
  onToggleTheme: Msg
}>

const ROW = 'group/row relative flex min-h-[30px] w-full items-center gap-1 rounded-md pr-1 text-[14px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground'

const navRow = <Msg>(h: HtmlBuilder<Msg>, row: NavRow, where: 'favorites' | Section, props: SidebarProps<Msg>): Html => {
  const isActive = row.id === props.activeId
  const anchor = rowAnchor(where, row.id)
  const { actions } = props
  return box({ class: cn(ROW, isActive && 'bg-sidebar-accent font-medium text-sidebar-foreground'), style: { paddingLeft: `${4 + row.depth * 12}px`, anchorName: anchor }, attributes: [h.DataAttribute('nav-row', row.id), h.DataAttribute('nav-section', where)], children: [
      // The icon turns into the open/close chevron on hover (Notion).
      box({ class: 'relative flex size-6 shrink-0 items-center justify-center', children: [
          box({ as: 'span', class: cn('flex items-center justify-center', actions !== undefined && where !== 'favorites' && 'group-hover/row:invisible'), children: [pageIcon(row.icon, h)] }, h),
          ...(actions === undefined || where === 'favorites'
            ? []
            : [box({ class: 'invisible absolute inset-0 flex items-center justify-center group-hover/row:visible', children: [
                  button({ variant: 'ghost', size: 'icon-xs', ariaLabel: row.isOpen ? `Close ${row.title}` : `Open ${row.title}`, title: row.isOpen ? 'Collapse' : 'Expand', id: `nav-toggle-${where}-${row.id}`, onClick: actions.onToggle(row.id, !row.isOpen), children: [Icon.icon(row.isOpen ? 'chevron-down' : 'chevron-right', { class: cn('size-3.5', !row.hasChildren && 'opacity-40') }, h)] }, h),
                ] }, h)]),
        ] }, h),
      box({ as: 'a', class: 'min-w-0 flex-1 truncate py-1', attributes: [h.Href(`/p/${row.id}`), ...(isActive ? [h.AriaCurrent('page')] : [])], children: [row.title] }, h),
      ...(actions === undefined
        ? []
        : [box({ class: cn('flex shrink-0 items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100'), children: [
              button({ variant: 'ghost', size: 'icon-xs', ariaLabel: `More actions for ${row.title}`, title: 'Delete, duplicate, and more…', id: `nav-menu-${where}-${row.id}`, onClick: actions.onMenu(row.id, anchor), children: [Icon.icon('ellipsis', { class: 'size-3.5' }, h)] }, h),
              ...(where === 'favorites' ? [] : [button({ variant: 'ghost', size: 'icon-xs', ariaLabel: `Add a page inside ${row.title}`, title: 'Add a page inside', id: `nav-add-${where}-${row.id}`, onClick: actions.onAdd(row.id, where), children: [Icon.plus({ class: 'size-3.5' }, h)] }, h)]),
            ] }, h)]),
    ] }, h)
}

const sectionHeading = <Msg>(h: HtmlBuilder<Msg>, label: string, add: Msg | undefined, id: string): Html =>
  box({ class: 'group/heading flex min-h-[30px] items-center justify-between pr-1 pl-2 pt-3 text-[12px] font-medium text-muted-foreground', attributes: [h.Id(id)], children: [
      box({ as: 'span', children: [label] }, h),
      ...(add === undefined ? [] : [box({ class: 'opacity-0 group-hover/heading:opacity-100 focus-within:opacity-100', children: [button({ variant: 'ghost', size: 'icon-xs', ariaLabel: `Add a page to ${label}`, title: 'Add a page', onClick: add, children: [Icon.plus({ class: 'size-3.5' }, h)] }, h)] }, h)]),
    ] }, h)

const linkRow = <Msg>(h: HtmlBuilder<Msg>, config: Readonly<{ href: string; label: string; icon: string; isActive: boolean; id: string }>): Html =>
  box({ as: 'a', class: cn(ROW, 'pl-2', config.isActive && 'bg-sidebar-accent text-sidebar-foreground'), attributes: [h.Href(config.href), h.Id(config.id), ...(config.isActive ? [h.AriaCurrent('page')] : [])], children: [
      box({ as: 'span', class: 'flex size-6 shrink-0 items-center justify-center text-muted-foreground', children: [Icon.icon(config.icon, { class: 'size-4' }, h)] }, h),
      box({ as: 'span', class: 'min-w-0 flex-1 truncate', children: [config.label] }, h),
    ] }, h)

export const sidebar = <Msg>(props: SidebarProps<Msg>, h: HtmlBuilder<Msg>): Html => {
  const { actions } = props
  const emptyHint = (text: string) => box({ as: 'p', class: 'px-3 py-1 text-[13px] text-muted-foreground', children: [text] }, h)
  return box({ as: 'aside', class: 'flex h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground shadow-[inset_-1px_0_0_var(--border)]', attributes: [h.Id('sidebar'), h.AriaLabel('Sidebar')], children: [
      box({ class: 'flex items-center gap-1 px-2 pt-2 pb-1', children: [
          box({ class: 'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1', children: [
              box({ as: 'span', class: 'flex size-[22px] shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background', children: ['N'] }, h),
              box({ as: 'span', class: 'min-w-0 truncate text-[14px] font-medium', children: [`${firstName(props.me.name)}'s hypernotes`] }, h),
            ] }, h),
          ...(actions === undefined
            ? []
            : [button({ variant: 'ghost', size: 'icon-sm', id: 'sidebar-new-page', ariaLabel: 'New page', title: 'Create a new page', onClick: actions.onAdd(null, 'private'), children: [Icon.icon('square-pen', { class: 'size-4' }, h)] }, h)]),
        ] }, h),
      box({ class: 'flex flex-col px-2', children: [
          ...(actions === undefined
            ? [linkRow(h, { href: '/', label: 'Search', icon: 'search', isActive: false, id: 'sidebar-search' })]
            : [box({ class: cn(ROW, 'pl-2'), children: [
                  button({ variant: 'ghost', size: 'dense', id: 'sidebar-search', ariaLabel: 'Search (Ctrl+K)', title: 'Search and quickly jump to a page  Ctrl K', onClick: actions.onSearch, leadingIcon: Icon.icon('search', { class: 'size-4' }, h), children: ['Search'] }, h),
                ] }, h)]),
          linkRow(h, { href: '/', label: 'Home', icon: 'house', isActive: props.active === '/', id: 'sidebar-home' }),
          linkRow(h, { href: '/settings', label: 'Settings', icon: 'settings', isActive: props.active === '/settings', id: 'sidebar-settings' }),
        ] }, h),
      box({ as: 'nav', class: 'flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2', attributes: [h.AriaLabel('Pages'), h.DataAttribute('keep-scroll', 'sidebar')], children: [
          ...(props.nav.favorites.length === 0
            ? []
            : [sectionHeading(h, 'Favorites', undefined, 'nav-favorites'), ...props.nav.favorites.map(row => navRow(h, row, 'favorites', props))]),
          sectionHeading(h, 'Workspace', actions?.onAdd(null, 'workspace'), 'nav-workspace'),
          ...(props.nav.workspace.length === 0 ? [emptyHint('No pages inside')] : props.nav.workspace.map(row => navRow(h, row, 'workspace', props))),
          sectionHeading(h, 'Private', actions?.onAdd(null, 'private'), 'nav-private'),
          ...(props.nav.private.length === 0 ? [emptyHint('No pages inside')] : props.nav.private.map(row => navRow(h, row, 'private', props))),
          box({ class: 'pt-3', children: [linkRow(h, { href: '/?trash=1', label: 'Trash', icon: 'trash-2', isActive: props.active === '/?trash=1', id: 'sidebar-trash' })] }, h),
        ] }, h),
      box({ class: 'flex items-center gap-1 border-t px-2 py-2', children: [
          box({ as: 'a', class: 'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-sidebar-accent', attributes: [h.Href('/settings'), h.Id('settings-link'), h.Title('Settings')], children: [
              avatar(props.me, h, 'md'),
              box({ as: 'span', class: 'min-w-0 flex-1 truncate text-[13px] font-medium', children: [props.me.name] }, h),
            ] }, h),
          button({ variant: 'ghost', size: 'icon-sm', id: 'theme-toggle', ariaLabel: props.isDark ? 'Use light theme' : 'Use dark theme', title: props.isDark ? 'Light theme  Ctrl Shift L' : 'Dark theme  Ctrl Shift L', onClick: props.onToggleTheme, children: [Icon.icon(props.isDark ? 'sun' : 'moon', { class: 'size-4' }, h)] }, h),
          box({ as: 'form', attributes: [h.Method('post'), h.Action('/logout')], children: [
              button({ variant: 'ghost', size: 'icon-sm', type: 'submit', ariaLabel: 'Sign out', title: 'Sign out', children: [Icon.icon('log-out', { class: 'size-4' }, h)] }, h),
            ] }, h),
        ] }, h),
    ] }, h)
}

/** A key hint, shown next to actions. */
export const hint = <Msg>(h: HtmlBuilder<Msg>, ...keys: ReadonlyArray<string>): Html =>
  box({ as: 'span', class: 'inline-flex gap-0.5', children: keys.map(key => kbd({ children: [key] }, h)) }, h)
