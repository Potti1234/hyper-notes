import { Effect } from 'effect'

import type { Member, Page } from './domain'
import { block } from './editor/blocks'
import { type Block, type Inline, type Kind, PLAIN, type RichText } from './editor/schema'
import { hashPassword } from './password'
import type { WorkspaceData } from './workspace'
import { emoji } from './editor/emoji'

/* Fictional demo people and pages, all marked for demo:clear. Times are
   relative to now. Each demo password is the first name. */

const PEOPLE: ReadonlyArray<readonly [id: string, name: string, color: string]> = [
  ['avery', 'Avery Finch', 'bg-indigo-500'],
  ['morgan', 'Morgan Vale', 'bg-emerald-500'],
  ['riley', 'Riley Quinn', 'bg-amber-500'],
]

export const DEMO_MEMBERS: ReadonlyArray<Member> = PEOPLE.map(([id, name, color]) => ({
  id,
  name,
  email: `${name.split(' ')[0]?.charAt(0).toLowerCase()}${name.split(' ')[1]?.toLowerCase()}@hypernotes.example`,
  color,
  isDark: false,
  theme: '',
  isDemo: true,
}))

export const demoPassword = (member: Member): string => member.name.split(' ')[0] ?? member.name

// CONTENT HELPERS

const t = (text: string, marks: Partial<Inline['marks']> = {}): Inline => ({ _tag: 'Text', text, marks: { ...PLAIN, ...marks } })
let serial = 0
const b = (kind: Kind, text: RichText | string = [], children: ReadonlyArray<Block> = []): Block =>
  block(`demo-b${++serial}`, kind, typeof text === 'string' ? (text === '' ? [] : [t(text)]) : text, children)
const p = (text: RichText | string = '', children: ReadonlyArray<Block> = []) => b({ _tag: 'Paragraph' }, text, children)
const h1 = (text: string) => b({ _tag: 'Heading', level: 1, isToggleable: false, isOpen: true }, text)
const h2 = (text: string) => b({ _tag: 'Heading', level: 2, isToggleable: false, isOpen: true }, text)
const h3 = (text: string) => b({ _tag: 'Heading', level: 3, isToggleable: false, isOpen: true }, text)
const li = (text: RichText | string, children: ReadonlyArray<Block> = []) => b({ _tag: 'Bulleted' }, text, children)
const ol = (text: RichText | string) => b({ _tag: 'Numbered' }, text)
const todo = (text: string, isChecked = false) => b({ _tag: 'Todo', isChecked }, text)

const page = (id: string, fields: Partial<Page> & Pick<Page, 'title'>, at: number): Page => ({
  id,
  parentId: null,
  section: 'workspace',
  ownerId: 'avery',
  position: 1,
  icon: '',
  cover: { _tag: 'NoCover' },
  coverPosition: 50,
  font: 'default',
  isSmallText: false,
  isFullWidth: false,
  isLocked: false,
  content: [],
  database: null,
  values: {},
  createdBy: 'avery',
  createdAt: at,
  updatedBy: 'avery',
  updatedAt: at,
  trashedAt: null,
  trashedBy: null,
  isDemo: true,
  ...fields,
})

export const DEMO_HOME = 'demo-getting-started'

export const demoPages = (now: number): ReadonlyArray<Page> => {
  serial = 0
  const hour = 3_600_000
  return [
    page(DEMO_HOME, {
      title: 'Getting Started',
      icon: emoji('1f44b'),
      cover: { _tag: 'GalleryCover', name: 'gradient-1' },
      position: 1,
      content: [
        p([t('Welcome to hypernotes! This page shows what the editor can do. '), t('Click anywhere', { bold: true }), t(' and start typing.')]),
        b({ _tag: 'Callout', icon: emoji('1f4a1') }, [t('Type '), t('/', { code: true }), t(' for the block menu, '), t('@', { code: true }), t(' to mention a page or a person, and select text to format it.')]),
        h2('The basics'),
        todo('Click the checkbox to tick me off', true),
        todo('Hover a block and drag ⋮⋮ to move it'),
        todo('Press Tab to nest a block, Shift+Tab to un-nest it'),
        todo('Type # and a space for a heading, - for a list, [] for a to-do'),
        b({ _tag: 'Toggle', isOpen: false }, 'Toggles hide what is inside them', [p('Like this. Click the triangle to open and close.')]),
        h2('Formatting'),
        p([t('Text can be '), t('bold', { bold: true }), t(', '), t('italic', { italic: true }), t(', '), t('underlined', { underline: true }), t(', '), t('struck', { strike: true }), t(', '), t('code', { code: true }), t(', '), t('coloured', { color: 'blue' }), t(', '), t('highlighted', { color: 'yellow_background' }), t(' or a '), t('link', { link: 'https://example.com' }), t('.')]),
        b({ _tag: 'Quote' }, 'Quotes stand out from the text around them.'),
        b({ _tag: 'Divider' }),
        h3('Lists'),
        li('Bulleted lists', [li('can nest'), li('as deep as you like')]),
        ol('Numbered lists'),
        ol('count themselves'),
        b({ _tag: 'Code', language: 'TypeScript', isWrapped: false }, "const greet = (name: string) => `Hello, ${name}!`"),
        p([t('See also '), { _tag: 'PageMention', pageId: 'demo-wiki', marks: PLAIN }, t('.')]),
      ],
      updatedAt: now - 2 * hour,
    }, now - 48 * hour),
    page('demo-wiki', {
      title: 'Engineering Wiki',
      icon: emoji('1f4da'),
      position: 2,
      content: [
        p('Everything the team knows, in one place.'),
        b({ _tag: 'TableOfContents' }),
        h2('Guides'),
        b({ _tag: 'SubPage', pageId: 'demo-onboarding' }),
        b({ _tag: 'SubPage', pageId: 'demo-style' }),
        h2('Decisions'),
        li('Pages are Foldkit programs; the editor is an island.'),
        li('Documents are block trees validated by Schema.'),
      ],
      createdBy: 'morgan',
      updatedBy: 'morgan',
    }, now - 40 * hour),
    page('demo-onboarding', { title: 'Onboarding', icon: emoji('1f680'), parentId: 'demo-wiki', position: 1, content: [h1('Your first week'), todo('Set up the development database'), todo('Read the architecture notes'), todo('Ship something small')] }, now - 30 * hour),
    page('demo-style', { title: 'Style guide', icon: emoji('1f3a8'), parentId: 'demo-wiki', position: 2, content: [p('Short sentences. Plain words.')] }, now - 30 * hour),
    page('demo-meetings', {
      title: 'Meeting Notes',
      icon: emoji('1f5d3-fe0f'),
      position: 3,
      content: [h2('Weekly sync'), li('Shipped the sidebar'), li('Next: databases'), todo('Write the release notes')],
      createdBy: 'riley',
      updatedBy: 'riley',
    }, now - 20 * hour),
    page('demo-journal', { title: 'Journal', icon: emoji('1f4d3'), section: 'private', position: 1, content: [p('Only I can see this page.')] }, now - 10 * hour),
  ]
}

export const demoData = (now: number): WorkspaceData => ({
  members: DEMO_MEMBERS,
  pages: demoPages(now),
  favorites: [{ memberId: 'avery', pageId: DEMO_HOME, position: 1 }],
  expanded: [{ memberId: 'avery', pageId: 'demo-wiki' }],
  comments: [
    { id: 'demo-comment-1', pageId: DEMO_HOME, threadId: 'demo-comment-1', authorId: 'morgan', text: 'Could we add a section on keyboard shortcuts?', createdAt: now - 3 * 3_600_000, editedAt: null, resolvedAt: null, resolvedBy: null, isDemo: true },
    { id: 'demo-comment-2', pageId: DEMO_HOME, threadId: 'demo-comment-1', authorId: 'riley', text: 'Good idea. Type / in any block to see most of them.', createdAt: now - 2 * 3_600_000, editedAt: null, resolvedAt: null, resolvedBy: null, isDemo: true },
  ],
  versions: [],
  passwords: {},
})

export const demoPasswords: Effect.Effect<Readonly<Record<string, string>>> = Effect.forEach(DEMO_MEMBERS, member =>
  Effect.map(hashPassword(demoPassword(member)), hash => [member.id, hash] as const),
).pipe(Effect.map(entries => Object.fromEntries(entries)))
