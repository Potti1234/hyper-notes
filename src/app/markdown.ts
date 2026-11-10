import type { Page } from './domain'
import { titleOf } from './domain'
import { iconText } from './icon-link'
import type { Block, Inline, RichText } from './editor/schema'
import type { WorkspaceState } from './store'
import { canSee } from './workspace'

/* Export as Markdown, as Notion's ••• → Export does: the title as a level-one
   heading, then the blocks. Marks become Markdown where it has them (bold,
   italic, strikethrough, code, links); underline and colours have no Markdown
   and are dropped. Pages and people are named; a page the reader can't see
   is "Untitled". Pure: the export route (export.ts) sends the result. */

type Names = Readonly<{ page: (pageId: string) => string; person: (memberId: string) => string }>

const namesOf = (state: WorkspaceState, memberId: string): Names => ({
  page: pageId => {
    const page = state.pages.find(entry => entry.id === pageId)
    return page === undefined || !canSee(page, memberId) ? 'Untitled' : titleOf(page)
  },
  person: id => state.members.find(member => member.id === id)?.name ?? 'Someone',
})

const wrap = (text: string, mark: string): string => {
  const match = /^(\s*)(.*?)(\s*)$/s.exec(text)
  const [, before = '', body = '', after = ''] = match ?? []
  return body === '' ? text : `${before}${mark}${body}${mark}${after}`
}

const inlineMarkdown = (piece: Inline, names: Names): string => {
  const marks = piece.marks
  let text = piece._tag === 'Text' ? piece.text
    : piece._tag === 'PageMention' ? `[${names.page(piece.pageId)}](/p/${piece.pageId})`
    : piece._tag === 'PersonMention' ? `@${names.person(piece.memberId)}`
    : piece._tag === 'DateMention' ? `@${piece.date}`
    : `$${piece.tex}$`
  if (marks.code) text = `\`${text}\``
  if (marks.bold) text = wrap(text, '**')
  if (marks.italic) text = wrap(text, '_')
  if (marks.strike) text = wrap(text, '~~')
  if (marks.link !== null && piece._tag === 'Text') text = `[${text}](${marks.link})`
  return text
}

export const richMarkdown = (text: RichText, names: Names): string => text.map(piece => inlineMarkdown(piece, names)).join('')

const indent = (text: string, by: string): string => text.split('\n').map(line => (line === '' ? line : by + line)).join('\n')

const cellText = (cell: RichText, names: Names): string => richMarkdown(cell, names).replace(/\|/g, '\\|').replace(/\n/g, ' ')

const isListItem = (block: Block): boolean => block.kind._tag === 'Bulleted' || block.kind._tag === 'Numbered' || block.kind._tag === 'Todo' || block.kind._tag === 'Toggle'

const blockMarkdown = (block: Block, number: number, names: Names): string => {
  const text = richMarkdown(block.text, names)
  const children = blocksMarkdown(block.children, names)
  const nested = (head: string, by = '    '): string => (children === '' ? head : `${head}\n${indent(children, by)}`)
  const kind = block.kind
  switch (kind._tag) {
    case 'Paragraph': return nested(text)
    case 'Heading': return nested(`${'#'.repeat(kind.level)} ${text}`)
    case 'Bulleted': return nested(`- ${text}`)
    case 'Numbered': return nested(`${number}. ${text}`)
    case 'Todo': return nested(`- [${kind.isChecked ? 'x' : ' '}] ${text}`)
    case 'Toggle': return nested(`- ${text}`)
    case 'Quote': return nested(`> ${text.replace(/\n/g, '\n> ')}`)
    case 'Callout': return nested(`> ${kind.icon === '' ? '' : `${kind.icon} `}${text.replace(/\n/g, '\n> ')}`, '> ')
    case 'Code': return `\`\`\`${kind.language === 'plain text' ? '' : kind.language}\n${block.text.map(piece => (piece._tag === 'Text' ? piece.text : '')).join('')}\n\`\`\``
    case 'Divider': return '---'
    case 'Image': return `![](${kind.url})`
    case 'Bookmark':
    case 'Embed': return `<${kind.url}>`
    case 'SubPage':
    case 'LinkToPage': return `[${names.page(kind.pageId)}](/p/${kind.pageId})`
    case 'TableOfContents':
    case 'Breadcrumb': return ''
    case 'Equation': return `$$\n${kind.tex}\n$$`
    case 'ColumnList':
    case 'Column': return children
    case 'Table': {
      const width = Math.max(1, ...kind.rows.map(row => row.length))
      const line = (row: ReadonlyArray<RichText>) => `| ${Array.from({ length: width }, (_, index) => cellText(row[index] ?? [], names)).join(' | ')} |`
      const [head = [], ...rest] = kind.rows
      return [line(head), `|${' --- |'.repeat(width)}`, ...rest.map(line)].join('\n')
    }
  }
}

export const blocksMarkdown = (blocks: ReadonlyArray<Block>, names: Names): string => {
  const parts: Array<string> = []
  let number = 0
  let previous: Block | undefined
  for (const block of blocks) {
    number = block.kind._tag === 'Numbered' ? (previous?.kind._tag === 'Numbered' ? number + 1 : 1) : 0
    const text = blockMarkdown(block, number, names)
    if (text !== '' || block.kind._tag === 'Paragraph') parts.push((parts.length === 0 ? '' : previous !== undefined && isListItem(previous) && isListItem(block) ? '\n' : '\n\n') + text)
    previous = block
  }
  return parts.join('')
}

/** The page as Markdown for `memberId`: mentions of pages they can't see stay unnamed. */
export const pageMarkdown = (state: WorkspaceState, page: Page, memberId: string): string => {
  const names = namesOf(state, memberId)
  const body = blocksMarkdown(page.content, names).replace(/\n{3,}/g, '\n\n').trim()
  return `# ${iconText(page.icon) === '' ? '' : `${page.icon} `}${titleOf(page)}\n${body === '' ? '' : `\n${body}\n`}`
}

/** A file name for the download: the title without characters file systems refuse. */
export const exportFileName = (page: Page): string => `${titleOf(page).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 100) || 'Untitled'}.md`
