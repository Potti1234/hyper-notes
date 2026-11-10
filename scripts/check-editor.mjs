import { chromium } from 'playwright'

/* Editor check: drives the page editor in Chromium the way a person types.
   It creates a page, then checks Markdown shortcuts, Enter/Backspace rules,
   the slash menu, inline marks and the toolbar, block selection, undo/redo,
   and that the content survives a reload.

   Usage: node scripts/check-editor.mjs   (URL=… for another server; needs
   the demo accounts, as npm run check:fresh provides) */

const base = process.env.URL ?? 'http://localhost:4300'
const TIMEOUT = Number(process.env.CHECK_TIMEOUT ?? 6000)
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}
const ROOT = '[data-editor-root]'

const browser = await chromium.launch()
const errors = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`${base}/`)
  await page.getByLabel('Email').fill('afinch@hypernotes.example')
  await page.getByLabel('Password').fill('Avery')
  const stream = page.waitForRequest(request => request.url().includes('/stream'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await stream
  await page.waitForTimeout(300)

  // A fresh page to type into.
  await page.locator('#sidebar-new-page').first().click()
  await page.waitForURL(/\/p\//, { timeout: TIMEOUT })
  await page.waitForSelector(ROOT, { timeout: TIMEOUT })
  const url = page.url()

  const blocks = () => page.evaluate(root => [...document.querySelectorAll(`${root} [data-block-id]`)].map(block => ({
    kind: block.getAttribute('data-kind'),
    text: block.querySelector('[data-text-of]')?.textContent ?? '',
  })), ROOT)
  const kinds = async () => (await blocks()).map(block => block.kind).join(',')
  const settle = () => page.waitForTimeout(120)
  const where = () => page.evaluate(() => {
    const selection = document.getSelection()
    const at = node => `${node?.parentElement?.closest('[data-block-id]')?.getAttribute('data-kind') ?? '-'}:${node?.textContent?.slice(0, 12)}`
    return selection === null ? 'none' : `${at(selection.anchorNode)}@${selection.anchorOffset} → ${at(selection.focusNode)}@${selection.focusOffset}`
  })

  await page.locator(`${ROOT} [data-text-of]`).first().click()
  await page.keyboard.type('# Title')
  await settle()
  let list = await blocks()
  check('"# " turns the block into a heading', list[0]?.kind === 'Heading' && list[0]?.text === 'Title', JSON.stringify(list[0]))

  await page.keyboard.press('Enter')
  await page.keyboard.type('- one')
  await page.keyboard.press('Enter')
  await page.keyboard.type('two')
  await settle()
  check('Enter after a heading starts a paragraph; "- " makes a list that continues', (await kinds()) === 'Heading,Bulleted,Bulleted', await kinds())

  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await settle()
  check('Enter in an empty list item ends the list', (await kinds()) === 'Heading,Bulleted,Bulleted,Paragraph', await kinds())

  await page.keyboard.type('[] task')
  await settle()
  check('"[] " makes a to-do', (await kinds()).endsWith('Todo'), await kinds())
  await page.keyboard.press('Control+Enter')
  await settle()
  check('Ctrl+Enter checks the to-do', await page.locator(`${ROOT} .nb-checked`).count() === 1)

  await page.keyboard.press('Enter')
  await page.keyboard.press('Backspace')
  await settle()
  check('Backspace at the start of an empty to-do turns it into a paragraph', (await kinds()).endsWith('Todo,Paragraph'), await kinds())

  await page.keyboard.type('/quo')
  await page.waitForSelector('[data-overlay="nb-slash-menu"]', { timeout: TIMEOUT })
  check('"/" opens the slash menu filtered by the query', (await page.locator('[data-overlay="nb-slash-menu"] [data-menu-item]').count()) >= 1)
  await page.keyboard.press('Enter')
  await settle()
  check('Enter in the slash menu turns the block into the chosen kind', (await kinds()).endsWith('Quote') && (await page.locator('[data-overlay="nb-slash-menu"]').count()) === 0, await kinds())

  await page.keyboard.type('bold words')
  await page.keyboard.down('Shift')
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
  await page.keyboard.up('Shift')
  await settle()
  check('a text selection shows the inline toolbar', await page.locator('[data-overlay="nb-toolbar"]').count() === 1, await where())
  await page.keyboard.press('Control+b')
  await settle()
  check('Ctrl+B makes the selection bold', (await page.locator(`${ROOT} .nb-b`).allTextContents()).join('') === 'words', `${await where()} ${JSON.stringify((await blocks()).at(-1))}`)

  await page.keyboard.press('Escape')
  await settle()
  check('Esc selects the block', await page.locator(`${ROOT} .nb-selected`).count() === 1)
  await page.keyboard.press('Control+d')
  await settle()
  check('Ctrl+D duplicates the selected block', (await kinds()).endsWith('Quote,Quote'), await kinds())
  await page.keyboard.press('Backspace')
  await settle()
  check('Backspace deletes the selected block', (await kinds()) === 'Heading,Bulleted,Bulleted,Todo,Quote', await kinds())
  await page.keyboard.press('Control+z')
  await settle()
  check('Ctrl+Z brings it back', (await kinds()).endsWith('Quote,Quote'), await kinds())
  await page.keyboard.press('Control+Shift+z')
  await settle()
  check('Ctrl+Shift+Z deletes it again', (await kinds()) === 'Heading,Bulleted,Bulleted,Todo,Quote', await kinds())

  // Saved: the content survives a reload.
  const before = await blocks()
  await page.waitForTimeout(1200)
  await page.goto(url)
  await page.waitForSelector(ROOT, { timeout: TIMEOUT })
  const after = await blocks()
  check('the content is saved and survives a reload', JSON.stringify(after) === JSON.stringify(before), `${before.length} → ${after.length} blocks`)
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await context.close()
} finally {
  await browser.close()
}

const failed = results.filter(result => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
