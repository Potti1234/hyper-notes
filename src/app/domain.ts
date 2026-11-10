import { Schema as S, SchemaIssue } from 'effect'

import { Database, Values } from './database'
import { Block } from './editor/schema'

/* The workspace's data: members, pages (with their block documents),
   favorites and the open rows of everyone's sidebar. Plain Schemas, so
   pages can keep them in their Models (snapshotted as JSON) and Messages can
   carry them. */

// MEMBERS

export const Member = S.Struct({
  id: S.String,
  name: S.String,
  /** What they sign in with (lower case). */
  email: S.String,
  /** A Tailwind background class from AVATAR_COLORS. */
  color: S.String,
  /** Their theme choice, applied to every page they have open. */
  isDark: S.Boolean,
  /** Their creaseui theme preset (`theme-<slug>` on the page root; '' is the app's own). */
  theme: S.String,
  /** Their sidebar's width in px, dragged at its edge (SIDEBAR_WIDTH when missing). */
  sidebarWidth: S.optionalKey(S.Number),
  /** Closed with « or Ctrl+\\ and reopened from the top bar. */
  isSidebarCollapsed: S.optionalKey(S.Boolean),
  /** When they last opened the Inbox; newer mentions and replies are unread. */
  inboxSeenAt: S.optionalKey(S.Number),
  /** Entered by the demo script (`npm run demo:seed`); `demo:clear` removes it. */
  isDemo: S.Boolean,
})
export type Member = typeof Member.Type

export const SIDEBAR_WIDTH = 240
export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 480
/** A dragged width kept inside what Notion allows; anything unreadable is the default. */
export const sidebarWidth = (width: number | undefined): number =>
  width === undefined || !Number.isFinite(width) ? SIDEBAR_WIDTH : Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)))

/** Demo addresses use a reserved example domain. */
export const EMAIL_DOMAIN = 'hypernotes.example'

/** "afinch" signs in as afinch@hypernotes.example. */
export const normalizeEmail = (input: string): string => {
  const email = input.trim().toLowerCase()
  return email === '' || email.includes('@') ? email : `${email}@${EMAIL_DOMAIN}`
}

export const AVATAR_COLORS: ReadonlyArray<string> = [
  'bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-sky-500', 'bg-violet-500', 'bg-teal-500', 'bg-orange-500',
]

export const initials = (name: string): string =>
  name.split(/\s+/).filter(part => part !== '').slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('')

export const firstName = (name: string): string => name.split(/\s+/)[0] ?? name

// PAGES

/** Workspace pages are everyone's; private pages only their owner's. A
 *  page inside another has the section of its top page. */
export const Section = S.Literals(['workspace', 'private'])
export type Section = typeof Section.Type

export const Font = S.Literals(['default', 'serif', 'mono'])
export type Font = typeof Font.Type

/** A gradient or colour from the cover gallery, or an image address. */
export const Cover = S.Union([
  S.TaggedStruct('NoCover', {}),
  S.TaggedStruct('GalleryCover', { name: S.String }),
  S.TaggedStruct('ImageCover', { url: S.String }),
])
export type Cover = typeof Cover.Type

export const Page = S.Struct({
  id: S.String,
  parentId: S.NullOr(S.String),
  section: Section,
  /** Who the page belongs to (for private pages: the only one who sees it). */
  ownerId: S.String,
  /** Order among its siblings (fractional: moving a page writes one row). */
  position: S.Number,
  title: S.String,
  /** An emoji, or '' for the default page icon. */
  icon: S.String,
  cover: Cover,
  /** Vertical position of the cover image, 0–100 (%). */
  coverPosition: S.Number,
  font: Font,
  isSmallText: S.Boolean,
  isFullWidth: S.Boolean,
  isLocked: S.Boolean,
  content: S.Array(Block),
  /** Set when the page is a database: its rows are its child pages. */
  database: S.NullOr(Database),
  /** The page's values as a row of the database it is in. */
  values: Values,
  createdBy: S.String,
  createdAt: S.Number,
  updatedBy: S.String,
  updatedAt: S.Number,
  /** In the trash since (with everything inside it); null when not. */
  trashedAt: S.NullOr(S.Number),
  trashedBy: S.NullOr(S.String),
  isDemo: S.Boolean,
})
export type Page = typeof Page.Type

export const Favorite = S.Struct({ memberId: S.String, pageId: S.String, position: S.Number })
export type Favorite = typeof Favorite.Type

/** A sidebar row someone has opened (it stays open across page loads). */
export const Expanded = S.Struct({ memberId: S.String, pageId: S.String })
export type Expanded = typeof Expanded.Type

// HISTORY

/** A version of a page's title, icon and blocks. Edits one person makes in a
 *  row (within `VERSION_WINDOW` of the version's start) update one version. */
export const PageVersion = S.Struct({
  id: S.String,
  pageId: S.String,
  authorId: S.String,
  startedAt: S.Number,
  at: S.Number,
  title: S.String,
  icon: S.String,
  content: S.Array(Block),
  isDemo: S.Boolean,
})
export type PageVersion = typeof PageVersion.Type

export const VERSION_WINDOW = 10 * 60_000
export const MAX_VERSIONS = 50

// COMMENTS

/** A comment on a page. A discussion's first comment is its thread
 *  (`threadId` is its own id) and says whether the discussion is resolved. */
export const Comment = S.Struct({
  id: S.String,
  pageId: S.String,
  threadId: S.String,
  authorId: S.String,
  text: S.String,
  createdAt: S.Number,
  editedAt: S.NullOr(S.Number),
  resolvedAt: S.NullOr(S.Number),
  resolvedBy: S.NullOr(S.String),
  /** The text a discussion was started on (marked with its id in the page), or null for the page itself. */
  quote: S.NullOr(S.String),
  isDemo: S.Boolean,
})
export type Comment = typeof Comment.Type

export const MAX_COMMENT = 4000

export const MAX_TITLE = 300
export const MAX_DOC_BYTES = 1_500_000

/** The page's title as shown: 'Untitled' when it has none. */
export const titleOf = (page: Readonly<{ title: string }>): string => (page.title.trim() === '' ? 'Untitled' : page.title)

// VALIDATION

export const MIN_PASSWORD = 8

export const PersonName = S.String.pipe(
  S.check(S.isMinLength(1, { message: 'Enter their name.' }), S.isMaxLength(60, { message: 'Keep the name under 60 characters.' })),
)
export const Email = S.String.pipe(S.check(S.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'Enter an email address.' }), S.isMaxLength(120)))
export const Password = S.String.pipe(
  S.check(
    S.isMinLength(MIN_PASSWORD, { message: `Use at least ${MIN_PASSWORD} characters.` }),
    S.isMaxLength(200, { message: 'Keep the password under 200 characters.' }),
  ),
)
export const NewMember = S.Struct({ name: PersonName, email: Email, password: Password })
export type NewMember = typeof NewMember.Type

const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1()

export const fieldErrors = (issue: SchemaIssue.Issue): Readonly<Record<string, string>> => {
  const errors: Record<string, string> = {}
  for (const { path, message } of formatIssue(issue).issues) {
    const first = path?.[0]
    const key = first === undefined ? '' : String(typeof first === 'object' ? first.key : first)
    errors[key] ??= message
  }
  return errors
}

export const validate = <A>(
  schema: S.Codec<A, unknown, never, never>,
  value: unknown,
): Readonly<{ ok: true; value: A } | { ok: false; errors: Readonly<Record<string, string>> }> => {
  const decoded = S.decodeUnknownExit(schema)(value, { errors: 'all' })
  if (decoded._tag === 'Success') return { ok: true, value: decoded.value }
  const error = decoded.cause.reasons.find(reason => reason._tag === 'Fail')?.error
  return { ok: false, errors: S.isSchemaError(error) ? fieldErrors(error.issue) : { '': 'Check the form.' } }
}

// TIME

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const formatDate = (at: number): string => {
  const date = new Date(at)
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
}

export const formatDateTime = (at: number): string => {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${formatDate(at)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

/** "Edited just now", "5m ago", "3h ago", "Yesterday", or the date. */
export const formatAgo = (at: number, now: number): string => {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  if (hours < 48) return 'Yesterday'
  return formatDate(at)
}
