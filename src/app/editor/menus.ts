import type { Color, KindTag } from './schema'
import { COLOR_NAMES } from './schema'

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
