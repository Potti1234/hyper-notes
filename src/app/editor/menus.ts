import { EMOJI, type Emoji } from '../emoji'
import type { MemberRef, PageRef } from './island'
import { addDays, formatDate } from './render'
import type { Color, Inline, KindTag } from './schema'
import { COLOR_NAMES, isIsoDate } from './schema'
import * as B from './blocks'
import type { Document } from './schema'
import { type InlineMenu, type Selection, isCollapsed } from './state'
import * as T from './text'

/* The editor's menus as data: the `/` menu's blocks and the block menu's
   actions, with Notion's names, groups and search words. */

export type SlashItem = Readonly<{ id: string; label: string; description: string; group: 'Basic blocks' | 'Media' | 'Advanced'; keywords: ReadonlyArray<string>; tag: KindTag; level: 1 | 2 | 3; shortcut: string }>

const item = (id: string, label: string, description: string, group: SlashItem['group'], tag: KindTag, keywords: ReadonlyArray<string>, shortcut = '', level: 1 | 2 | 3 = 1): SlashItem =>
  ({ id, label, description, group, keywords, tag, level, shortcut })

export const SLASH_ITEMS: ReadonlyArray<SlashItem> = [
  item('text', 'Text', 'Just start writing with plain text.', 'Basic blocks', 'Paragraph', ['plain', 'paragraph', 'p']),
  item('page', 'Page', 'Embed a sub-page inside this page.', 'Basic blocks', 'SubPage', ['subpage', 'new page']),
  item('todo', 'To-do list', 'Track tasks with a to-do list.', 'Basic blocks', 'Todo', ['todo', 'checkbox', 'task', '[]'], '[]'),
  item('h1', 'Heading 1', 'Big section heading.', 'Basic blocks', 'Heading', ['h1', 'title', '#'], '#', 1),
  item('h2', 'Heading 2', 'Medium section heading.', 'Basic blocks', 'Heading', ['h2', 'subtitle', '##'], '##', 2),
  item('h3', 'Heading 3', 'Small section heading.', 'Basic blocks', 'Heading', ['h3', '###'], '###', 3),
  item('bullet', 'Bulleted list', 'Create a simple bulleted list.', 'Basic blocks', 'Bulleted', ['bullet', 'unordered', 'ul', '-'], '-'),
  item('number', 'Numbered list', 'Create a list with numbering.', 'Basic blocks', 'Numbered', ['numbered', 'ordered', 'ol', '1.'], '1.'),
  item('toggle', 'Toggle list', 'Toggles can hide and show content inside.', 'Basic blocks', 'Toggle', ['toggle', 'collapse', '>'], '>'),
  item('quote', 'Quote', 'Capture a quote.', 'Basic blocks', 'Quote', ['quote', 'blockquote', 'citation', '"'], '"'),
  item('divider', 'Divider', 'Visually divide blocks.', 'Basic blocks', 'Divider', ['divider', 'hr', 'line', 'separator', '---'], '---'),
  item('link', 'Link to page', 'Link to an existing page.', 'Basic blocks', 'LinkToPage', ['link', 'page link']),
  item('callout', 'Callout', 'Make writing stand out.', 'Basic blocks', 'Callout', ['callout', 'note', 'info', 'warning']),
  item('table', 'Table', 'Add a simple table.', 'Basic blocks', 'Table', ['table', 'grid', 'simple table']),
  item('image', 'Image', 'Embed with a link.', 'Media', 'Image', ['image', 'picture', 'photo', 'img']),
  item('bookmark', 'Web bookmark', 'Save a link as a visual bookmark.', 'Media', 'Bookmark', ['bookmark', 'link', 'url']),
  item('embed', 'Embed', 'For Figma, Loom, CodePen, maps and more.', 'Media', 'Embed', ['embed', 'iframe', 'video', 'figma', 'loom', 'youtube']),
  item('code', 'Code', 'Capture a code snippet.', 'Media', 'Code', ['code', 'snippet', 'pre', '```'], '```'),
  item('toc', 'Table of contents', 'Show an outline of your page.', 'Advanced', 'TableOfContents', ['toc', 'outline', 'contents']),
  item('equation', 'Block equation', 'Display a standalone math equation.', 'Advanced', 'Equation', ['equation', 'math', 'tex', 'latex', 'formula']),
  item('breadcrumb', 'Breadcrumb', 'Show where this page sits.', 'Advanced', 'Breadcrumb', ['breadcrumb', 'path', 'navigation']),
  item('columns', '2 columns', 'Create two columns of blocks.', 'Advanced', 'ColumnList', ['columns', 'layout', 'side by side']),
]

const matches = (query: string, words: ReadonlyArray<string>): boolean => {
  const needle = query.trim().toLowerCase()
  return needle === '' || words.some(word => word.toLowerCase().includes(needle))
}

/** The `/` menu's items for what was typed after `/`. */
export const slashItems = (query: string): ReadonlyArray<SlashItem> =>
  SLASH_ITEMS.filter(entry => matches(query, [entry.label, entry.id, ...entry.keywords]))

/** Block kinds "Turn into" offers (Notion's order). */
export const TURN_INTO: ReadonlyArray<SlashItem> = SLASH_ITEMS.filter(entry => ['text', 'page', 'h1', 'h2', 'h3', 'todo', 'bullet', 'number', 'toggle', 'code', 'quote', 'callout'].includes(entry.id))

export type BlockMenuItem =
  | Readonly<{ _tag: 'Delete'; label: 'Delete'; shortcut: 'Del' }>
  | Readonly<{ _tag: 'Duplicate'; label: 'Duplicate'; shortcut: 'Ctrl+D' }>
  | Readonly<{ _tag: 'CopyLink'; label: 'Copy link to block'; shortcut: 'Alt+Shift+L' }>
  | Readonly<{ _tag: 'MoveUp'; label: 'Move up'; shortcut: 'Ctrl+Shift+Up' }>
  | Readonly<{ _tag: 'MoveDown'; label: 'Move down'; shortcut: 'Ctrl+Shift+Down' }>
  | Readonly<{ _tag: 'TurnInto'; label: string; shortcut: string; item: SlashItem }>
  | Readonly<{ _tag: 'Color'; label: string; shortcut: ''; color: Color }>

const colorLabel = (color: Color): string => {
  const name = color.replace('_background', '')
  const title = name === 'default' ? 'Default' : `${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`
  return color.endsWith('_background') ? `${title} background` : `${title} text`
}

export const TEXT_COLORS: ReadonlyArray<Color> = COLOR_NAMES
export const BACKGROUND_COLORS: ReadonlyArray<Color> = COLOR_NAMES.filter(name => name !== 'default').map(name => `${name}_background` as Color)

/** The block (⋮⋮) menu, filtered by its search field. */
export const blockMenuItems = (query: string): ReadonlyArray<BlockMenuItem> => {
  const all: ReadonlyArray<BlockMenuItem> = [
    { _tag: 'Delete', label: 'Delete', shortcut: 'Del' },
    { _tag: 'Duplicate', label: 'Duplicate', shortcut: 'Ctrl+D' },
    { _tag: 'CopyLink', label: 'Copy link to block', shortcut: 'Alt+Shift+L' },
    { _tag: 'MoveUp', label: 'Move up', shortcut: 'Ctrl+Shift+Up' },
    { _tag: 'MoveDown', label: 'Move down', shortcut: 'Ctrl+Shift+Down' },
    ...TURN_INTO.map(entry => ({ _tag: 'TurnInto' as const, label: `Turn into ${entry.label}`, shortcut: entry.shortcut, item: entry })),
    ...[...TEXT_COLORS, ...BACKGROUND_COLORS].map(color => ({ _tag: 'Color' as const, label: colorLabel(color), shortcut: '' as const, color })),
  ]
  return all.filter(entry => matches(query, [entry.label]))
}

// INLINE MENUS

export type InlineSources = Readonly<{ members: ReadonlyArray<MemberRef>; pages: ReadonlyArray<PageRef>; today: string }>

export type InlineItem = Readonly<{ group: string; label: string; hint: string; piece: Inline }>

const PLAIN_MARKS = { bold: false, italic: false, underline: false, strike: false, code: false, color: 'default', link: null } as const

const DATE_WORDS: ReadonlyArray<readonly [label: string, days: number]> = [['Today', 0], ['Tomorrow', 1], ['Yesterday', -1]]

/** What `@` or `:` offers for the query: people, pages and dates (Notion's order), or emoji. */
export const inlineMenuItems = (menu: InlineMenu, sources: InlineSources): ReadonlyArray<InlineItem> => {
  const needle = menu.query.trim().toLowerCase()
  const has = (words: string) => words.toLowerCase().includes(needle)
  if (menu.trigger === ':') {
    return EMOJI.filter(entry => entry.name.split(' ').some(word => word.startsWith(needle))).slice(0, 8)
      .map(entry => ({ group: 'Emoji', label: `${entry.char} ${entry.name.split(' ')[0] ?? ''}`, hint: '', piece: { _tag: 'Text', text: entry.char, marks: PLAIN_MARKS } }))
  }
  const typed = isIsoDate(needle) && addDays(needle, 0) === needle ? [needle] : []
  return [
    ...sources.members.filter(member => has(member.name)).slice(0, 4).map(member => ({ group: 'People', label: member.name, hint: '', piece: { _tag: 'PersonMention' as const, memberId: member.id, marks: PLAIN_MARKS } })),
    ...sources.pages.filter(page => has(page.title || 'Untitled')).slice(0, 6).map(page => ({ group: 'Link to page', label: `${page.icon} ${page.title || 'Untitled'}`.trim(), hint: '', piece: { _tag: 'PageMention' as const, pageId: page.id, marks: PLAIN_MARKS } })),
    ...[...DATE_WORDS.filter(([label]) => has(label)).map(([label, days]) => [label, addDays(sources.today, days)] as const), ...typed.map(date => [formatDate(date), date] as const)]
      .map(([label, date]) => ({ group: 'Date', label, hint: formatDate(date), piece: { _tag: 'DateMention' as const, date, marks: PLAIN_MARKS } })),
  ]
}

// LINKS

/** A typed link as it is stored: web links get https:// unless they name a scheme or a path here. */
export const normalizeLink = (value: string): string => (/^(https?:|mailto:|\/)/.test(value) ? value : `https://${value}`)

export type LinkChoice = Readonly<{ group: 'Link' | 'Link to page'; label: string; url: string }>

/** What the link prompt offers for the typed text: the text as a web link, then pages whose title matches. */
export const linkChoices = (value: string, pages: ReadonlyArray<PageRef>, pageId: string): ReadonlyArray<LinkChoice> => {
  const typed = value.trim()
  if (typed === '') return []
  const needle = typed.toLowerCase()
  return [
    { group: 'Link', label: typed, url: normalizeLink(typed) },
    ...pages.filter(page => page.id !== pageId && (page.title || 'Untitled').toLowerCase().includes(needle)).slice(0, 6)
      .map(page => ({ group: 'Link to page' as const, label: `${page.icon} ${page.title || 'Untitled'}`.trim(), url: `/p/${page.id}` })),
  ]
}

export type LinkSpot = Readonly<{ blockId: string; from: number; to: number; url: string }>

/** The whole link the caret stands in (or at the end of), which the link card shows. */
export const linkUnderCaret = (doc: Document, selection: Selection): LinkSpot | null => {
  if (selection._tag !== 'TextSelection' || !isCollapsed(selection)) return null
  const block = B.find(doc, selection.focus.blockId)
  const range = block === null ? null : T.linkRange(block.text, selection.focus.offset)
  if (block === null || range === null) return null
  const url = T.linkAt(block.text, range[0], range[1])
  return url === null ? null : { blockId: block.id, from: range[0], to: range[1], url }
}

// BLOCK SETTINGS

export const CODE_LANGUAGES: ReadonlyArray<string> = [
  'plain text', 'bash', 'c', 'c#', 'c++', 'css', 'diff', 'docker', 'go', 'graphql', 'html', 'java', 'javascript', 'json',
  'kotlin', 'markdown', 'mermaid', 'php', 'python', 'ruby', 'rust', 'sql', 'swift', 'typescript', 'yaml',
]

/** The code block's language list, filtered by the typed text. */
export const languageChoices = (query: string): ReadonlyArray<string> => {
  const needle = query.trim().toLowerCase()
  return CODE_LANGUAGES.filter(language => language.includes(needle))
}

/** The callout's icon picker: emoji whose name has a word starting with the typed text. */
export const iconChoices = (query: string): ReadonlyArray<Emoji> => {
  const needle = query.trim().toLowerCase()
  return EMOJI.filter(entry => needle === '' || entry.name.split(' ').some(word => word.startsWith(needle))).slice(0, 30)
}
