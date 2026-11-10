import { assert, describe, it } from '@effect/vitest'

import type { Block, Inline, Kind } from '@/app/editor/schema'
import { PLAIN } from '@/app/editor/schema'
import { exportFileName, pageMarkdown } from '@/app/markdown'
import { demoData } from '@/app/seed'
import type { WorkspaceState } from '@/app/store'

/* ••• → Export: a page as Markdown. */

const NOW = Date.UTC(2026, 10, 10, 9)
const data = demoData(NOW)
const state: WorkspaceState = { version: 0, members: data.members, pages: data.pages, favorites: data.favorites, expanded: data.expanded, comments: data.comments, versions: data.versions }
const page = state.pages.find(entry => entry.id === 'demo-wiki')!

const text = (value: string, marks: Partial<typeof PLAIN> = {}): Inline => ({ _tag: 'Text', text: value, marks: { ...PLAIN, ...marks } })
let next = 0
const block = (kind: Kind, pieces: ReadonlyArray<Inline> = [], children: ReadonlyArray<Block> = []): Block => ({ id: `b${next++}`, kind, text: pieces, color: 'default', children })
const exported = (content: ReadonlyArray<Block>, memberId = 'avery') => pageMarkdown(state, { ...page, icon: '', title: 'Notes', content }, memberId)

describe('export as Markdown', () => {
  it('starts with the title and keeps the marks Markdown has', () => {
    assert.strictEqual(
      exported([block({ _tag: 'Paragraph' }, [text('A '), text('bold', { bold: true }), text(' and '), text('code', { code: true }), text(' '), text('site', { link: 'https://example.com' }), text(' '), text('gone', { strike: true, underline: true })])]),
      '# Notes\n\nA **bold** and `code` [site](https://example.com) ~~gone~~\n',
    )
    assert.strictEqual(exported([]), '# Notes\n')
  })

  it('writes headings, lists, to-dos and quotes, numbering each run of a numbered list', () => {
    const doc = [
      block({ _tag: 'Heading', level: 2, isToggleable: false, isOpen: true }, [text('Plan')]),
      block({ _tag: 'Numbered' }, [text('one')]),
      block({ _tag: 'Numbered' }, [text('two')], [block({ _tag: 'Bulleted' }, [text('inner')])]),
      block({ _tag: 'Todo', isChecked: true }, [text('done')]),
      block({ _tag: 'Todo', isChecked: false }, [text('open')]),
      block({ _tag: 'Quote' }, [text('said')]),
      block({ _tag: 'Numbered' }, [text('again')]),
    ]
    assert.strictEqual(exported(doc), '# Notes\n\n## Plan\n\n1. one\n2. two\n    - inner\n- [x] done\n- [ ] open\n\n> said\n\n1. again\n')
  })

  it('writes code, dividers, equations, images and tables', () => {
    const doc = [
      block({ _tag: 'Code', language: 'typescript', isWrapped: false }, [text('const a = 1\nconst b = 2')]),
      block({ _tag: 'Divider' }),
      block({ _tag: 'Equation', tex: 'e = mc^2' }),
      block({ _tag: 'Image', url: 'https://example.com/a.png', width: null }),
      block({ _tag: 'Table', hasHeaderRow: true, hasHeaderColumn: false, rows: [[[text('Name')], [text('Role')]], [[text('Avery')], [text('a|b')]]] }),
      block({ _tag: 'TableOfContents' }),
    ]
    assert.strictEqual(
      exported(doc),
      '# Notes\n\n```typescript\nconst a = 1\nconst b = 2\n```\n\n---\n\n$$\ne = mc^2\n$$\n\n![](https://example.com/a.png)\n\n| Name | Role |\n| --- | --- |\n| Avery | a\\|b |\n',
    )
  })

  it('names mentioned people and pages, but not pages the reader can\'t see', () => {
    const doc = [block({ _tag: 'Paragraph' }, [{ _tag: 'PersonMention', memberId: 'morgan', marks: PLAIN }, text(' see '), { _tag: 'PageMention', pageId: 'demo-journal', marks: PLAIN }])]
    const journal = state.pages.find(entry => entry.id === 'demo-journal')!
    assert.include(exported(doc, journal.ownerId), `[${journal.title}](/p/demo-journal)`)
    assert.include(exported(doc, 'riley'), '[Untitled](/p/demo-journal)')
    assert.include(exported(doc), '@Morgan Vale')
  })

  it('makes a file name from the title', () => {
    assert.strictEqual(exportFileName({ ...page, title: 'Q3: plan/review?' }), 'Q3 planreview.md')
    assert.strictEqual(exportFileName({ ...page, title: '  ' }), 'Untitled.md')
  })
})
