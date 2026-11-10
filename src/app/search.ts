import { Schema as S } from 'effect'

import { type Page, titleOf } from './domain'
import type { Block, RichText } from './editor/schema'
import { plainText } from './editor/text'
import type { WorkspaceState } from './store'
import { ancestorsOf, canSee, isTrashed } from './workspace'

/** The words around the first place a page's text matches. */
export const Snippet = S.Struct({ before: S.String, match: S.String, after: S.String })
export type Snippet = typeof Snippet.Type

export const SearchHit = S.Struct({
  pageId: S.String,
  title: S.String,
  icon: S.String,
  path: S.String,
  updatedAt: S.Number,
  isTitleMatch: S.Boolean,
  snippet: S.NullOr(Snippet),
})
export type SearchHit = typeof SearchHit.Type

export const MAX_HITS = 20
const BEFORE = 30
const AFTER = 90

export const wordsOf = (query: string): ReadonlyArray<string> =>
  query.trim().toLowerCase().split(/\s+/).filter(word => word !== '')

/** A page's text as one string, mentions read as their labels. */
export const pageText = (state: WorkspaceState, doc: ReadonlyArray<Block>): string => {
  const label = (text: RichText): string =>
    plainText(text, piece => {
      switch (piece._tag) {
        case 'PageMention': {
          const page = state.pages.find(entry => entry.id === piece.pageId)
          return page === undefined ? '' : titleOf(page)
        }
        case 'PersonMention': return state.members.find(member => member.id === piece.memberId)?.name ?? ''
        case 'DateMention': return piece.date
        case 'InlineEquation': return piece.tex
      }
    })
  return docText(doc, label)
}

/** A doc's text as one string, each piece of rich text read by `label`. */
export const docText = (doc: ReadonlyArray<Block>, label: (text: RichText) => string): string => {
  const lines: Array<string> = []
  const walk = (blocks: ReadonlyArray<Block>): void => {
    for (const entry of blocks) {
      const own = label(entry.text)
      if (own !== '') lines.push(own)
      if (entry.kind._tag === 'Table') for (const row of entry.kind.rows) lines.push(row.map(label).join(' '))
      walk(entry.children)
    }
  }
  walk(doc)
  return lines.join(' ').replace(/\s+/g, ' ').trim()
}

/** Words in text as Notion counts them: runs of letters, digits and marks between spaces. */
export const wordCount = (text: string): number => text.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length

export const snippetOf = (text: string, word: string): Snippet | null => {
  const at = text.toLowerCase().indexOf(word)
  if (at < 0 || word === '') return null
  const start = Math.max(0, at - BEFORE)
  const end = Math.min(text.length, at + word.length + AFTER)
  return {
    before: `${start > 0 ? '…' : ''}${text.slice(start, at)}`,
    match: text.slice(at, at + word.length),
    after: `${text.slice(at + word.length, end)}${end < text.length ? '…' : ''}`,
  }
}

const hitOf = (state: WorkspaceState, page: Page, isTitleMatch: boolean, snippet: Snippet | null): SearchHit => ({
  pageId: page.id,
  title: titleOf(page),
  icon: page.icon,
  path: ancestorsOf(state.pages, page).map(titleOf).join(' / '),
  updatedAt: page.updatedAt,
  isTitleMatch,
  snippet,
})

/** Pages the member can open whose title or text holds every word: title
 *  matches first, then the most recently edited. No words: recent pages. */
export const searchPages = (state: WorkspaceState, memberId: string, query: string): ReadonlyArray<SearchHit> => {
  const words = wordsOf(query)
  const pages = state.pages
    .filter(page => canSee(page, memberId) && !isTrashed(state.pages, page))
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
  if (words.length === 0) return pages.slice(0, MAX_HITS).map(page => hitOf(state, page, false, null))
  const hits: Array<SearchHit> = []
  for (const page of pages) {
    const title = titleOf(page).toLowerCase()
    const isTitleMatch = words.every(word => title.includes(word))
    const text = pageText(state, page.content)
    const all = `${title} ${text.toLowerCase()}`
    if (!isTitleMatch && !words.every(word => all.includes(word))) continue
    const first = words.find(word => text.toLowerCase().includes(word))
    hits.push(hitOf(state, page, isTitleMatch, first === undefined ? null : snippetOf(text, first)))
  }
  return hits
    .sort((a, b) => Number(b.isTitleMatch) - Number(a.isTitleMatch) || b.updatedAt - a.updatedAt)
    .slice(0, MAX_HITS)
}
