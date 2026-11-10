import { Effect, Schema as S } from 'effect'

/* The document of a page: a tree of blocks, each with its own rich text.
   Plain Schemas, so a document is one JSON value that the server stores and
   validates (decoding is the sanitizer: nothing outside these shapes gets
   in) and that the editor island keeps in its Model. */

// COLORS

export const COLOR_NAMES = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const
export type ColorName = (typeof COLOR_NAMES)[number]

/** A text colour (`blue`) or a background colour (`blue_background`). */
export const Color = S.Literals([
  ...COLOR_NAMES,
  'gray_background', 'brown_background', 'orange_background', 'yellow_background', 'green_background',
  'blue_background', 'purple_background', 'pink_background', 'red_background',
])
export type Color = typeof Color.Type

export const COLOR_LABEL: Readonly<Record<ColorName, string>> = {
  default: 'Default', gray: 'Gray', brown: 'Brown', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple', pink: 'Pink', red: 'Red',
}

export const backgroundOf = (name: ColorName): Color => (name === 'default' ? 'default' : `${name}_background`)

// INLINE

export const Marks = S.Struct({
  bold: S.Boolean,
  italic: S.Boolean,
  underline: S.Boolean,
  strike: S.Boolean,
  code: S.Boolean,
  link: S.NullOr(S.String.pipe(S.check(S.isMaxLength(2000)))),
  color: Color,
  /** The open discussion this text is commented in (comments.ts); older content has none. */
  comment: S.NullOr(S.String.pipe(S.check(S.isMaxLength(64)))).pipe(S.withDecodingDefaultKey(Effect.succeed(null))),
})
export type Marks = typeof Marks.Type

export const PLAIN: Marks = { bold: false, italic: false, underline: false, strike: false, code: false, link: null, color: 'default', comment: null }

export type ToggleMark = 'bold' | 'italic' | 'underline' | 'strike' | 'code'
export const TOGGLE_MARKS: ReadonlyArray<ToggleMark> = ['bold', 'italic', 'underline', 'strike', 'code']

export const Text = S.TaggedStruct('Text', { text: S.String, marks: Marks })
/** An inline link to another page; shows that page's icon and title. */
export const PageMention = S.TaggedStruct('PageMention', { pageId: S.String, marks: Marks })
export const PersonMention = S.TaggedStruct('PersonMention', { memberId: S.String, marks: Marks })
/** A date as YYYY-MM-DD. */
/** YYYY-MM-DD, the form a date mention keeps. */
export const isIsoDate = (text: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(text)

export const DateMention = S.TaggedStruct('DateMention', { date: S.String.pipe(S.check(S.isPattern(/^\d{4}-\d{2}-\d{2}$/))), marks: Marks })
export const InlineEquation = S.TaggedStruct('InlineEquation', { tex: S.String.pipe(S.check(S.isMaxLength(2000))), marks: Marks })

/** A piece of rich text. Everything but Text is an atom: one caret step wide. */
export const Inline = S.Union([Text, PageMention, PersonMention, DateMention, InlineEquation])
export type Inline = typeof Inline.Type
export type RichText = ReadonlyArray<Inline>

// BLOCK KINDS

export const Paragraph = S.TaggedStruct('Paragraph', {})
export const Heading = S.TaggedStruct('Heading', { level: S.Literals([1, 2, 3]), isToggleable: S.Boolean, isOpen: S.Boolean })
export const Bulleted = S.TaggedStruct('Bulleted', {})
export const Numbered = S.TaggedStruct('Numbered', {})
export const Todo = S.TaggedStruct('Todo', { isChecked: S.Boolean })
export const Toggle = S.TaggedStruct('Toggle', { isOpen: S.Boolean })
export const Quote = S.TaggedStruct('Quote', {})
export const Callout = S.TaggedStruct('Callout', { icon: S.String.pipe(S.check(S.isMaxLength(16))) })
export const Code = S.TaggedStruct('Code', { language: S.String.pipe(S.check(S.isMaxLength(40))), isWrapped: S.Boolean })
export const Divider = S.TaggedStruct('Divider', {})
export const Image = S.TaggedStruct('Image', { url: S.String.pipe(S.check(S.isMaxLength(2000))), width: S.NullOr(S.Number) })
export const Bookmark = S.TaggedStruct('Bookmark', { url: S.String.pipe(S.check(S.isMaxLength(2000))) })
export const Embed = S.TaggedStruct('Embed', { url: S.String.pipe(S.check(S.isMaxLength(2000))) })
/** A page inside this one (the page's own row lives in the workspace). */
export const SubPage = S.TaggedStruct('SubPage', { pageId: S.String })
export const LinkToPage = S.TaggedStruct('LinkToPage', { pageId: S.String })
/** A database page shown inside this one (its child page). */
export const InlineDatabase = S.TaggedStruct('InlineDatabase', { pageId: S.String })
export const TableOfContents = S.TaggedStruct('TableOfContents', {})
export const Breadcrumb = S.TaggedStruct('Breadcrumb', {})
export const Equation = S.TaggedStruct('Equation', { tex: S.String.pipe(S.check(S.isMaxLength(5000))) })
/** Side by side: its children are Column blocks. */
export const ColumnList = S.TaggedStruct('ColumnList', {})
export const Column = S.TaggedStruct('Column', { ratio: S.Number })
/** A simple table: rows of cells of rich text. */
export const Table = S.TaggedStruct('Table', { hasHeaderRow: S.Boolean, hasHeaderColumn: S.Boolean, rows: S.Array(S.Array(S.Array(Inline))) })

export const Kind = S.Union([
  Paragraph, Heading, Bulleted, Numbered, Todo, Toggle, Quote, Callout, Code, Divider, Image, Bookmark, Embed,
  SubPage, LinkToPage, TableOfContents, Breadcrumb, Equation, ColumnList, Column, Table, InlineDatabase,
])
export type Kind = typeof Kind.Type
export type KindTag = Kind['_tag']

// BLOCK

export interface Block {
  readonly id: string
  readonly kind: Kind
  readonly text: RichText
  readonly color: Color
  readonly children: ReadonlyArray<Block>
}

/** A block as stored: marks saved before a mark existed may lack it. */
export interface BlockEncoded {
  readonly id: string
  readonly kind: typeof Kind.Encoded
  readonly text: ReadonlyArray<typeof Inline.Encoded>
  readonly color: Color
  readonly children: ReadonlyArray<BlockEncoded>
}

export const Block = S.Struct({
  id: S.String.pipe(S.check(S.isMaxLength(64))),
  kind: Kind,
  text: S.Array(Inline),
  color: Color,
  children: S.Array(S.suspend((): S.Codec<Block, BlockEncoded> => Block)),
})

export const Document = S.Array(Block)
export type Document = ReadonlyArray<Block>

/** Kinds whose rich text is edited in place. */
export const hasText = (kind: Kind): boolean =>
  kind._tag !== 'Divider' && kind._tag !== 'Image' && kind._tag !== 'Bookmark' && kind._tag !== 'Embed' && kind._tag !== 'SubPage' &&
  kind._tag !== 'LinkToPage' && kind._tag !== 'TableOfContents' && kind._tag !== 'Breadcrumb' && kind._tag !== 'Equation' &&
  kind._tag !== 'ColumnList' && kind._tag !== 'Column' && kind._tag !== 'Table' && kind._tag !== 'InlineDatabase'

/** Kinds that show their children (nested under them, indented). */
export const showsChildren = (kind: Kind): boolean =>
  kind._tag === 'Toggle' ? kind.isOpen : kind._tag === 'Heading' ? !kind.isToggleable || kind.isOpen : kind._tag !== 'SubPage' && kind._tag !== 'Table' && kind._tag !== 'InlineDatabase'

/** List-like kinds keep their kind when Enter splits them. */
export const isListLike = (kind: Kind): boolean => kind._tag === 'Bulleted' || kind._tag === 'Numbered' || kind._tag === 'Todo' || kind._tag === 'Toggle'
