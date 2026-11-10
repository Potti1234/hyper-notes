import type { Attribute, ChildAttribute, Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

/* The owned design layer of the app (crease.lock.json: hypernotes/view): the
   domain patterns creaseui has no component for. Region roots carry h.Id
   (hyper-effect morphs by id), the windowed issue list and board need exact
   geometry, and docs render sanitized HTML. Component CSS for these roots is
   in design.css; colours come from theme tokens. */

export type BoxElement =
  | 'div' | 'span' | 'p' | 'a' | 'ul' | 'ol' | 'li' | 'header' | 'footer' | 'main' | 'aside' | 'nav'
  | 'section' | 'article' | 'form' | 'label' | 'strong' | 'em' | 'code' | 'pre' | 'h1' | 'h2' | 'h3'
  | 'button' | 'br'

type Attributes<Msg> = ReadonlyArray<Attribute<Msg> | ChildAttribute>
type Builder<Msg> = (attributes: Attributes<Msg>, children: ReadonlyArray<Html | string>) => Html

/** A plain element for layout that keeps its own utility classes. */
export const box = <Msg>(
  props: Readonly<{
    as?: BoxElement
    id?: string
    class?: string | undefined
    style?: Readonly<Record<string, string>> | undefined
    attributes?: NoInfer<Attributes<Msg>>
    children?: ReadonlyArray<Html | string>
  }>,
  h: HtmlBuilder<Msg>,
): Html =>
  (h[props.as ?? 'div'] as Builder<Msg>)(
    [
      ...(props.id === undefined ? [] : [h.Id(props.id)]),
      ...(props.attributes ?? []),
      ...(props.class === undefined || props.class === '' ? [] : [h.Class(props.class)]),
      ...(props.style === undefined ? [] : [h.Style(props.style)]),
    ],
    [...(props.children ?? [])],
  )

/** A color chip with a runtime CSS color (theme preset previews). */
export const swatch = <Msg>(props: Readonly<{ color: string }>, h: HtmlBuilder<Msg>): Html =>
  h.span([h.Class('inline-block size-6 shrink-0 rounded-md border'), h.Style({ background: props.color })], [])

/** A database option (select, multi-select, status) or person as a
 *  coloured chip; status chips lead with a dot. */
export const optionChip = <Msg>(
  props: Readonly<{ color: string; isStatus?: boolean; children: ReadonlyArray<Html | string> }>,
  h: HtmlBuilder<Msg>,
): Html =>
  box({ as: 'span', class: cn('nb-chip', props.isStatus === true && 'nb-chip-status'), attributes: [h.DataAttribute('chip', props.color)], children: [
      ...(props.isStatus === true ? [box({ as: 'span', class: 'nb-chip-dot', children: [] }, h)] : []),
      ...props.children,
    ] }, h)

/** Class names of the database grid (src/app/page/database-view.ts), styled in design.css. */
export const DB_VIEW = {
  board: 'nb-db-board',
  column: 'nb-db-column',
  card: 'nb-db-card',
  preview: 'nb-db-preview',
  dragged: 'nb-db-dragged',
  line: 'nb-db-line',
  gallery: 'nb-db-gallery',
  calendar: 'nb-db-calendar',
  day: 'nb-db-day',
  outside: 'nb-db-outside',
  dayAdd: 'nb-db-day-add',
  today: 'nb-db-today',
  event: 'nb-db-event',
  group: 'nb-db-group',
  peek: 'nb-db-peek',
  backdrop: 'nb-db-backdrop',
} as const

export const DB_GRID = {
  scroll: 'nb-db-scroll',
  table: 'nb-db-table',
  row: 'nb-db-row',
  cell: 'nb-db-cell',
  head: 'nb-db-head',
  title: 'nb-db-title',
  add: 'nb-db-add',
} as const

/** A listbox option of the pickers and menus: a roving-focus row whose
 *  active state the page moves before the server answers (data-active). */
export const optionRow = <Msg>(
  props: Readonly<{
    id: string
    value: string
    isActive: boolean
    onClick: Msg
    children: ReadonlyArray<Html | string>
  }>,
  h: HtmlBuilder<Msg>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Role('option'),
      h.Id(props.id),
      h.AriaSelected(props.isActive),
      h.DataAttribute('active', String(props.isActive)),
      h.DataAttribute('value', props.value),
      h.Tabindex(-1),
      h.Class('relative flex h-8 w-full cursor-default items-center gap-2.5 rounded-md px-2 text-left text-[13px] outline-hidden select-none hover:bg-accent data-[active=true]:bg-accent data-[active=true]:text-accent-foreground'),
      h.OnClick(props.onClick),
    ],
    [...props.children],
  )

/** The page root: light/dark and the theme preset of the member as classes. */
export const pageRoot = <Msg>(
  props: Readonly<{ isDark: boolean; theme: string; class?: string; children: ReadonlyArray<Html> }>,
  h: HtmlBuilder<Msg>,
): Html =>
  h.div(
    [h.Id('app'), h.Class(cn('app-root flex h-dvh overflow-hidden bg-background text-foreground', props.isDark && 'dark', props.theme !== '' && `theme-${props.theme}`, props.class))],
    [...props.children],
  )

/** Classes of the windowed list and board (design.css). Rows are rendered
 *  hundreds at a time, so their appearance is named once. */
export const issueRowClass = {
  row: 'issue-row',
  pick: 'issue-row-pick',
  id: 'issue-row-id',
  title: 'issue-row-title',
  category: 'issue-row-category',
  date: 'issue-row-date',
  slot: 'board-card-slot',
  card: 'board-card',
} as const

/** Doc HTML: the read-only view, tables and the editor mount (design.css). */
export const docClass = {
  content: 'doc-content',
  read: 'doc-read',
  table: 'doc-table',
  editor: 'doc-editor',
  editable: 'doc-editable',
  menu: 'doc-menu',
  menuItem: 'doc-menu-item',
  menuEmpty: 'doc-menu-empty',
  bubble: 'doc-bubble',
  bubbleLink: 'doc-bubble-link',
} as const
