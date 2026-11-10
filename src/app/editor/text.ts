import { type Inline, type Marks, PLAIN, type RichText, type ToggleMark } from './schema'

/* Rich text as a list of inline pieces, addressed by caret offsets: a Text
   piece is as wide as its characters (UTF-16 units, like the DOM), every
   other piece (mentions, equations) is one step. All functions are pure and
   return normalized text: no empty Text pieces, neighbours with the same
   marks merged. */

export const widthOf = (piece: Inline): number => (piece._tag === 'Text' ? piece.text.length : 1)

export const lengthOf = (text: RichText): number => text.reduce((sum, piece) => sum + widthOf(piece), 0)

/** The text as the caret sees it: one object-replacement character per atom,
 *  so string offsets are caret offsets (word movement, markdown). */
export const caretText = (text: RichText): string => text.map(piece => (piece._tag === 'Text' ? piece.text : '\uFFFC')).join('')

/** The text as a reader sees it (search, word counts, titles). */
export const plainText = (text: RichText, label: (piece: Exclude<Inline, { _tag: 'Text' }>) => string = piece => (piece._tag === 'InlineEquation' ? piece.tex : piece._tag === 'DateMention' ? piece.date : '')): string =>
  text.map(piece => (piece._tag === 'Text' ? piece.text : label(piece))).join('')

export const sameMarks = (a: Marks, b: Marks): boolean =>
  a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike && a.code === b.code && a.link === b.link && a.color === b.color

export const plain = (text: string, marks: Marks = PLAIN): RichText => (text === '' ? [] : [{ _tag: 'Text', text, marks }])

export const normalize = (text: RichText): RichText => {
  const out: Array<Inline> = []
  for (const piece of text) {
    if (piece._tag === 'Text' && piece.text === '') continue
    const last = out.at(-1)
    if (piece._tag === 'Text' && last?._tag === 'Text' && sameMarks(last.marks, piece.marks)) out[out.length - 1] = { ...last, text: last.text + piece.text }
    else out.push(piece)
  }
  return out
}

const clamp = (text: RichText, offset: number) => Math.max(0, Math.min(lengthOf(text), offset))

/** The pieces between two offsets (atoms are kept whole). */
export const slice = (text: RichText, from: number, to: number = lengthOf(text)): RichText => {
  const start = clamp(text, Math.min(from, to)), end = clamp(text, Math.max(from, to))
  const out: Array<Inline> = []
  let at = 0
  for (const piece of text) {
    const width = widthOf(piece), pieceEnd = at + width
    if (pieceEnd > start && at < end) {
      if (piece._tag === 'Text') out.push({ ...piece, text: piece.text.slice(Math.max(0, start - at), Math.min(width, end - at)) })
      else out.push(piece)
    }
    at = pieceEnd
  }
  return normalize(out)
}

export const concat = (...texts: ReadonlyArray<RichText>): RichText => normalize(texts.flat())

export const splitAt = (text: RichText, offset: number): readonly [RichText, RichText] => [slice(text, 0, offset), slice(text, offset)]

export const remove = (text: RichText, from: number, to: number): RichText => concat(slice(text, 0, Math.min(from, to)), slice(text, Math.max(from, to)))

export const insert = (text: RichText, offset: number, pieces: RichText): RichText => {
  const [before, after] = splitAt(text, offset)
  return concat(before, pieces, after)
}

export const insertText = (text: RichText, offset: number, value: string, marks: Marks): RichText => insert(text, offset, plain(value, marks))

/** The piece the caret at `offset` belongs to when typing: the one before it. */
export const marksAt = (text: RichText, offset: number): Marks => {
  let at = 0
  let found: Marks = PLAIN
  for (const piece of text) {
    const width = widthOf(piece)
    if (offset > at && offset <= at + width) found = piece.marks
    if (offset === 0 && at === 0) found = piece.marks
    at += width
  }
  return found
}

/** Marks for text typed at a caret: those before it, but a link or inline
 *  code does not grow past its end (as in Notion). */
export const typingMarksAt = (text: RichText, offset: number): Marks => {
  const before = marksAt(text, offset)
  if (offset === 0) return { ...before, link: null, code: false }
  const after = offset < lengthOf(text) ? marksAt(text, offset + 1) : null
  return {
    ...before,
    link: after !== null && after.link === before.link ? before.link : null,
    code: before.code && after !== null && after.code,
  }
}

const mapRange = (text: RichText, from: number, to: number, change: (marks: Marks) => Marks): RichText => {
  const start = Math.min(from, to), end = Math.max(from, to)
  if (start === end) return text
  const middle = slice(text, start, end).map(piece => ({ ...piece, marks: change(piece.marks) }))
  return concat(slice(text, 0, start), middle, slice(text, end))
}

/** Is the mark on every piece of the range (or at the caret)? */
export const hasMark = (text: RichText, from: number, to: number, mark: ToggleMark): boolean => {
  if (from === to) return marksAt(text, from)[mark]
  const pieces = slice(text, from, to)
  return pieces.length > 0 && pieces.every(piece => piece.marks[mark])
}

/** Bold/italic/…: on for the whole range if any part lacks it, else off. */
export const toggleMark = (text: RichText, from: number, to: number, mark: ToggleMark): RichText => {
  const value = !hasMark(text, from, to, mark)
  return mapRange(text, from, to, marks => ({ ...marks, [mark]: value }))
}

export const setLink = (text: RichText, from: number, to: number, link: string | null): RichText => mapRange(text, from, to, marks => ({ ...marks, link }))

export const setColor = (text: RichText, from: number, to: number, color: Marks['color']): RichText => mapRange(text, from, to, marks => ({ ...marks, color }))

/** The link under the caret or the range, if one link covers it. */
export const linkAt = (text: RichText, from: number, to: number): string | null => {
  if (from === to) return marksAt(text, from).link
  const pieces = slice(text, from, to)
  const first = pieces[0]?.marks.link ?? null
  return pieces.every(piece => piece.marks.link === first) ? first : null
}

/** The start and end of the link around `offset` (for editing a whole link). */
export const linkRange = (text: RichText, offset: number): readonly [number, number] | null => {
  let at = 0
  const spans: Array<readonly [number, number, string | null]> = []
  for (const piece of text) {
    spans.push([at, at + widthOf(piece), piece.marks.link])
    at += widthOf(piece)
  }
  const index = spans.findIndex(([start, end]) => offset >= start && offset <= end && end > start)
  const hit = spans[index]
  if (hit === undefined || hit[2] === null) return null
  let start = hit[0], end = hit[1]
  for (let i = index - 1; i >= 0 && spans[i]?.[2] === hit[2]; i--) start = spans[i]?.[0] ?? start
  for (let i = index + 1; i < spans.length && spans[i]?.[2] === hit[2]; i++) end = spans[i]?.[1] ?? end
  return [start, end]
}

const WORD = /[\p{L}\p{N}_]/u

/** Where Ctrl/Alt+Backspace stops: the start of the word before the caret. */
export const wordStartBefore = (value: string, offset: number): number => {
  let at = offset
  while (at > 0 && !WORD.test(value.charAt(at - 1))) at--
  while (at > 0 && WORD.test(value.charAt(at - 1))) at--
  return at
}

export const wordEndAfter = (value: string, offset: number): number => {
  let at = offset
  while (at < value.length && !WORD.test(value.charAt(at))) at++
  while (at < value.length && WORD.test(value.charAt(at))) at++
  return at
}

/** One caret step back/forward, keeping surrogate pairs (emoji) whole. */
export const charBefore = (value: string, offset: number): number => {
  if (offset <= 0) return 0
  const code = value.charCodeAt(offset - 1)
  return code >= 0xdc00 && code <= 0xdfff && offset >= 2 ? offset - 2 : offset - 1
}

export const charAfter = (value: string, offset: number): number => {
  if (offset >= value.length) return value.length
  const code = value.charCodeAt(offset)
  return code >= 0xd800 && code <= 0xdbff && offset + 2 <= value.length ? offset + 2 : offset + 1
}

export const wordCount = (value: string): number => value.split(/\s+/).filter(word => word !== '').length
