import type { Html, HtmlBuilder } from 'foldkit/html'

import * as B from './blocks'
import type { MemberRef, PageRef } from './island'
import type { Block, Color, Document, Inline, Marks } from './schema'
import { hasText } from './schema'
import { lengthOf } from './text'

/* Renders a page document, for the editor (a contenteditable host in the
   browser) and read-only on the server. The text of every text block sits in one
   `[data-text-of]` element, whose text nodes and atoms (width 1) map 1:1 to
   the offsets of the document model (dom.client.ts). */

export type RenderContext = Readonly<{
  pages: ReadonlyMap<string, PageRef>
  members: ReadonlyMap<string, MemberRef>
  crumbs: ReadonlyArray<PageRef>
  selected: ReadonlySet<string>
  focusedId: string | null
  isEditable: boolean
  /** The block menus and the toolbar are anchored to (`--nb-anchor`). */
  anchorId: string | null
  /** Bumped after IME composition, which edits text nodes behind the back of the renderer: re-creates them. */
  epoch: number
}>

export const ANCHOR = '--nb-anchor'

export const context = (props: Readonly<{ pages: ReadonlyArray<PageRef>; members: ReadonlyArray<MemberRef>; crumbs: ReadonlyArray<PageRef>; isEditable: boolean }>, selected: ReadonlyArray<string> = [], focusedId: string | null = null, anchorId: string | null = null, epoch = 0): RenderContext => ({
  pages: new Map(props.pages.map(page => [page.id, page])),
  members: new Map(props.members.map(member => [member.id, member])),
  crumbs: props.crumbs,
  selected: new Set(selected),
  focusedId,
  isEditable: props.isEditable,
  anchorId,
  epoch,
})

const COLOR_CLASS: Readonly<Record<Color, string>> = {
  default: '', gray: 'nb-color-gray', brown: 'nb-color-brown', orange: 'nb-color-orange', yellow: 'nb-color-yellow', green: 'nb-color-green',
  blue: 'nb-color-blue', purple: 'nb-color-purple', pink: 'nb-color-pink', red: 'nb-color-red',
  gray_background: 'nb-bg-gray', brown_background: 'nb-bg-brown', orange_background: 'nb-bg-orange', yellow_background: 'nb-bg-yellow', green_background: 'nb-bg-green',
  blue_background: 'nb-bg-blue', purple_background: 'nb-bg-purple', pink_background: 'nb-bg-pink', red_background: 'nb-bg-red',
}

export const colorClass = (color: Color): string => COLOR_CLASS[color]

const KIND_CLASS: Readonly<Record<Block['kind']['_tag'], string>> = {
  Paragraph: 'nb-paragraph', Heading: 'nb-heading', Bulleted: 'nb-bulleted', Numbered: 'nb-numbered', Todo: 'nb-todo', Toggle: 'nb-toggle',
  Quote: 'nb-quote', Callout: 'nb-callout', Code: 'nb-code', Divider: 'nb-divider-block', Image: 'nb-image-block', Bookmark: 'nb-bookmark-block',
  Embed: 'nb-embed', SubPage: 'nb-subpage', LinkToPage: 'nb-linktopage', TableOfContents: 'nb-tableofcontents', Breadcrumb: 'nb-breadcrumb-block',
  Equation: 'nb-equation-block', ColumnList: 'nb-columnlist', Column: 'nb-column', Table: 'nb-table-block',
}
const HEADING_CLASS = { 1: 'nb-h1', 2: 'nb-h2', 3: 'nb-h3' } as const
const TOC_CLASS = { 1: 'nb-toc-item nb-toc-1', 2: 'nb-toc-item nb-toc-2', 3: 'nb-toc-item nb-toc-3' } as const

const markClass = (marks: Marks): string =>
  [marks.bold ? 'nb-b' : '', marks.italic ? 'nb-i' : '', marks.underline ? 'nb-u' : '', marks.strike ? 'nb-s' : '', marks.code ? 'nb-c' : '', colorClass(marks.color)].filter(name => name !== '').join(' ')

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** `2026-11-10` as Notion writes it: November 10, 2026. */
export const formatDate = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number)
  return `${MONTHS[(month ?? 1) - 1] ?? ''} ${day ?? 1}, ${year ?? 0}`
}

/** The day `days` after `date` (both YYYY-MM-DD). */
export const addDays = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10)
}

const atom = <Msg>(h: HtmlBuilder<Msg>, marks: Marks, kind: string, attributes: ReadonlyArray<ReturnType<HtmlBuilder<Msg>['Attribute']>>, label: string): Html =>
  h.span([h.Class(['nb-atom', `nb-atom-${kind}`, markClass(marks)].join(' ')), h.Attribute('contenteditable', 'false'), h.Attribute('data-atom', kind), ...attributes], [label])

const inline = <Msg>(piece: Inline, ctx: RenderContext, h: HtmlBuilder<Msg>): Html | string => {
  switch (piece._tag) {
    case 'Text': {
      const name = markClass(piece.marks)
      if (piece.marks.link !== null) return h.a([h.Class(['nb-link', name].join(' ')), h.Href(piece.marks.link), h.Attribute('data-link', piece.marks.link)], [piece.text])
      return name === '' ? piece.text : h.span([h.Class(name)], [piece.text])
    }
    case 'PageMention': {
      const page = ctx.pages.get(piece.pageId)
      return atom(h, piece.marks, 'page', [h.Attribute('data-page-id', piece.pageId)], `${page?.icon ?? ''} ${page?.title || 'Untitled'}`.trim())
    }
    case 'PersonMention': return atom(h, piece.marks, 'person', [h.Attribute('data-member-id', piece.memberId)], `@${ctx.members.get(piece.memberId)?.name ?? 'Unknown'}`)
    case 'DateMention': return atom(h, piece.marks, 'date', [h.Attribute('data-date', piece.date)], `@${formatDate(piece.date)}`)
    case 'InlineEquation': return atom(h, piece.marks, 'equation', [h.Attribute('data-tex', piece.tex)], piece.tex)
  }
}

const PLACEHOLDERS: Readonly<Partial<Record<Block['kind']['_tag'], string>>> = {
  Bulleted: 'List', Numbered: 'List', Todo: 'To-do', Toggle: 'Toggle', Quote: 'Empty quote', Callout: 'Type something…', Code: '',
}

const placeholder = (target: Block, ctx: RenderContext): string => {
  if (target.kind._tag === 'Heading') return `Heading ${target.kind.level}`
  if (target.kind._tag === 'Paragraph') return ctx.isEditable && ctx.focusedId === target.id && !B.isCell(target.id) ? "Write, press 'space' for AI, '/' for commands…".replace(", press 'space' for AI", '') : ''
  return PLACEHOLDERS[target.kind._tag] ?? ''
}

type TextTag = 'div' | 'h1' | 'h2' | 'h3' | 'blockquote' | 'code'

const text = <Msg>(target: Block, ctx: RenderContext, h: HtmlBuilder<Msg>, tag: TextTag = 'div', extra = ''): Html => {
  const plain = target.text
  const isEmpty = lengthOf(plain) === 0
  const last = plain.at(-1)
  const needsFiller = isEmpty || (last?._tag === 'Text' && last.text.endsWith('\n'))
  return h[tag](
    [
      h.Key(`${target.id}:${ctx.epoch}`),
      h.Class(['nb-text', isEmpty ? 'nb-empty' : '', extra].filter(name => name !== '').join(' ')),
      h.Attribute('data-text-of', target.id),
      h.Attribute('data-placeholder', placeholder(target, ctx)),
    ],
    [...plain.map(piece => inline(piece, ctx, h)), ...(needsFiller ? [h.br([h.Attribute('data-filler', '')])] : [])],
  )
}

const control = <Msg>(h: HtmlBuilder<Msg>, action: string, blockId: string, name: string, children: ReadonlyArray<Html | string> = [], label = ''): Html =>
  h.span([h.Class(name), h.Attribute('contenteditable', 'false'), h.Attribute('data-action', action), h.Attribute('data-block', blockId), h.Attribute('role', 'button'), h.Attribute('aria-label', label)], [...children])

const pageLink = <Msg>(pageId: string, ctx: RenderContext, h: HtmlBuilder<Msg>): Html => {
  const page = ctx.pages.get(pageId)
  return h.a([h.Class('nb-page-link'), h.Href(`/p/${pageId}`), h.Attribute('contenteditable', 'false'), h.Attribute('data-page-link', pageId)], [
    h.span([h.Class('nb-page-link-icon')], [page?.icon || '']),
    h.span([h.Class('nb-page-link-title')], [page === undefined ? 'Page not found' : page.title || 'Untitled']),
  ])
}

const body = <Msg>(target: Block, index: number, siblings: Document, doc: Document, ctx: RenderContext, h: HtmlBuilder<Msg>): ReadonlyArray<Html> => {
  const { kind } = target
  switch (kind._tag) {
    case 'Paragraph': return [text(target, ctx, h)]
    case 'Heading': return [
      ...(kind.isToggleable ? [control(h, 'toggle-open', target.id, (kind.isOpen ? 'nb-caret nb-open' : 'nb-caret'), [], kind.isOpen ? 'Close' : 'Open')] : []),
      text(target, ctx, h, kind.level === 1 ? 'h1' : kind.level === 2 ? 'h2' : 'h3'),
    ]
    case 'Bulleted': return [h.span([h.Class('nb-marker nb-bullet'), h.Attribute('contenteditable', 'false')], []), text(target, ctx, h)]
    case 'Numbered': return [h.span([h.Class('nb-marker nb-number'), h.Attribute('contenteditable', 'false')], [`${B.listNumber(siblings, index)}.`]), text(target, ctx, h)]
    case 'Todo': return [
      control(h, 'toggle-todo', target.id, (kind.isChecked ? 'nb-check nb-checked' : 'nb-check'), [], kind.isChecked ? 'Mark as not done' : 'Mark as done'),
      text(target, ctx, h, 'div', kind.isChecked ? 'nb-done' : ''),
    ]
    case 'Toggle': return [control(h, 'toggle-open', target.id, (kind.isOpen ? 'nb-caret nb-open' : 'nb-caret'), [], kind.isOpen ? 'Close' : 'Open'), text(target, ctx, h)]
    case 'Quote': return [text(target, ctx, h, 'blockquote')]
    case 'Callout': return [control(h, 'callout-icon', target.id, 'nb-callout-icon', [kind.icon], 'Change icon'), text(target, ctx, h)]
    case 'Code': return [
      h.span([h.Class('nb-code-language'), h.Attribute('contenteditable', 'false'), h.Attribute('data-action', 'code-language'), h.Attribute('data-block', target.id)], [kind.language]),
      control(h, 'code-copy', target.id, 'nb-code-copy', ['Copy'], 'Copy code'),
      h.pre([h.Class((kind.isWrapped ? 'nb-pre nb-wrap' : 'nb-pre'))], [text(target, ctx, h, 'code')]),
    ]
    case 'Divider': return [h.hr([h.Class('nb-divider'), h.Attribute('contenteditable', 'false')])]
    case 'Image': return [kind.url === ''
      ? control(h, 'media-url', target.id, 'nb-media-empty', ['Add an image'])
      : h.div([h.Class('nb-image-frame'), h.Attribute('contenteditable', 'false'), ...(kind.width === null ? [] : [h.Style({ width: `${kind.width}px` })])], [
          h.img([h.Class(kind.width === null ? 'nb-image' : 'nb-image nb-image-sized'), h.Src(kind.url), h.Alt('')]),
          ...(ctx.isEditable ? (['left', 'right'] as const).map(side => h.span([
            h.Class(side === 'left' ? 'nb-image-handle nb-image-handle-left' : 'nb-image-handle nb-image-handle-right'),
            h.Attribute('data-action', 'image-resize'), h.Attribute('data-block', target.id), h.Attribute('data-side', side),
          ], [])) : []),
        ])]
    case 'Bookmark':
    case 'Embed': return [kind.url === ''
      ? control(h, 'media-url', target.id, 'nb-media-empty', [kind._tag === 'Bookmark' ? 'Add a web bookmark' : 'Embed a link'])
      : h.a([h.Class('nb-bookmark'), h.Href(kind.url), h.Attribute('contenteditable', 'false'), h.Attribute('target', '_blank'), h.Attribute('rel', 'noopener noreferrer')], [
          h.span([h.Class('nb-bookmark-title')], [kind.url.replace(/^https?:\/\//, '').split('/')[0] ?? kind.url]),
          h.span([h.Class('nb-bookmark-url')], [kind.url]),
        ])]
    case 'SubPage':
    case 'LinkToPage': return [pageLink(kind.pageId, ctx, h)]
    case 'TableOfContents': {
      const items = B.headings(doc)
      return [h.nav([h.Class('nb-toc'), h.Attribute('contenteditable', 'false')], items.length === 0
        ? [h.span([h.Class('nb-muted')], ['Add headings to create a table of contents.'])]
        : items.map(entry => h.a([h.Class(TOC_CLASS[entry.level]), h.Href(`#block-${entry.id}`)], [entry.text.map(piece => (piece._tag === 'Text' ? piece.text : '')).join('') || 'Untitled'])))]
    }
    case 'Breadcrumb': return [h.nav([h.Class('nb-breadcrumb'), h.Attribute('contenteditable', 'false')], ctx.crumbs.flatMap((crumb, at) => [
      ...(at === 0 ? [] : [h.span([h.Class('nb-muted')], ['/'])]),
      h.a([h.Href(`/p/${crumb.id}`)], [`${crumb.icon} ${crumb.title || 'Untitled'}`.trim()]),
    ]))]
    case 'Equation': return [control(h, 'equation', target.id, 'nb-equation', [kind.tex === '' ? 'Add a TeX equation' : kind.tex])]
    case 'ColumnList': return []
    case 'Column': return []
    case 'Table': return [
      h.table([h.Class('nb-table')], [h.tbody([], kind.rows.map((row, r) =>
        h.tr([], row.map((cell, c) => {
          const isHeader = (kind.hasHeaderRow && r === 0) || (kind.hasHeaderColumn && c === 0)
          return (isHeader ? h.th : h.td)([h.Class('nb-cell')], [text(B.cellBlock(B.cellId(target.id, r, c), cell), ctx, h)])
        }))))]),
      ...(ctx.isEditable ? [
        control(h, 'table-add-column', target.id, 'nb-table-add-column', ['+'], 'Add a column'),
        control(h, 'table-add-row', target.id, 'nb-table-add-row', ['+'], 'Add a row'),
      ] : []),
    ]
  }
}

const isOpen = (target: Block): boolean =>
  target.kind._tag === 'Toggle' ? target.kind.isOpen : target.kind._tag === 'Heading' && target.kind.isToggleable ? target.kind.isOpen : true

export const renderBlock = <Msg>(target: Block, index: number, siblings: Document, doc: Document, ctx: RenderContext, h: HtmlBuilder<Msg>): Html => {
  const { kind } = target
  const isColumns = kind._tag === 'ColumnList'
  const children = target.children
  const childList = (): Html => h.div([h.Class(isColumns ? 'nb-columns' : 'nb-children')], children.map((child, at) => renderBlock(child, at, children, doc, ctx, h)))
  const emptyToggle = (kind._tag === 'Toggle' || (kind._tag === 'Heading' && kind.isToggleable)) && isOpen(target) && children.length === 0
  return h.div(
    [
      h.Id(`block-${target.id}`),
      h.Class(['nb-block', KIND_CLASS[kind._tag], kind._tag === 'Heading' ? HEADING_CLASS[kind.level] : '', ctx.selected.has(target.id) ? 'nb-selected' : '', colorClass(target.color)].filter(name => name !== '').join(' ')),
      h.Attribute('data-block-id', target.id),
      h.Attribute('data-kind', kind._tag),
      ...(kind._tag === 'Column' ? [h.Style({ flex: `${kind.ratio} 1 0` })] : ctx.anchorId === target.id ? [h.Style({ anchorName: ANCHOR })] : []),
    ],
    [
      ...(ctx.isEditable && kind._tag !== 'Column' ? [h.span([h.Class('nb-gutter'), h.Attribute('contenteditable', 'false')], [
        control(h, 'add', target.id, 'nb-add', [], 'Add a block below'),
        control(h, 'handle', target.id, 'nb-grip', [], 'Drag to move, click to open the menu'),
      ])] : []),
      kind._tag === 'Column' ? h.div([h.Class('nb-column-body')], children.map((child, at) => renderBlock(child, at, children, doc, ctx, h))) : h.div([h.Class('nb-row')], [...body(target, index, siblings, doc, ctx, h)]),
      ...(kind._tag !== 'Column' && (isColumns || (children.length > 0 && isOpen(target))) ? [childList()] : []),
      ...(emptyToggle && ctx.isEditable ? [control(h, 'add-in-toggle', target.id, 'nb-empty-toggle', ['Empty toggle. Click or drop blocks inside.'])] : []),
    ],
  )
}

export const renderDocument = <Msg>(doc: Document, ctx: RenderContext, h: HtmlBuilder<Msg>): ReadonlyArray<Html> =>
  doc.map((target, index) => renderBlock(target, index, doc, doc, ctx, h))

export { hasText }
