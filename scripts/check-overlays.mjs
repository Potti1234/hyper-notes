import { chromium } from 'playwright'

/* Overlay check: every popover, picker and menu must open fully on screen,
   at its full width (not squeezed against an edge).

   At each window size it opens the page menu of the sidebar rows nearest the
   top and bottom of the window, the search palette, and in the editor the
   slash, mention and emoji menus, the block menu, the color menu, the
   inline toolbar, the link prompt and the link card, on a
   block near the top and one near the bottom of the window. The panel that
   opens must lie inside the window.

   Usage: node scripts/check-overlays.mjs   (URL=… for another server; needs
   the demo content, as npm run check:fresh provides) */

const base = process.env.URL ?? 'http://localhost:4300'
const TIMEOUT = 4000
const SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 640 },
]

const failures = []
let opened = 0

/** Records whether the panel matching `selector` lies inside the window at its full width. */
const measure = async (page, selector, label) => {
  if (!(await page.waitForSelector(selector, { state: 'visible', timeout: TIMEOUT }).then(() => true, () => false))) {
    failures.push(`${label} opened nothing`)
    return
  }
  // Let anchor positioning settle (it applies after layout).
  await page.waitForTimeout(100)
  const box = await page.evaluate(selector => {
    const panel = document.querySelector(selector)
    const rect = panel.getBoundingClientRect()
    const limit = panel.style.maxWidth
    panel.style.maxWidth = 'none'
    const natural = panel.getBoundingClientRect().width
    panel.style.maxWidth = limit
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, panelWidth: rect.width, natural }
  }, selector)
  opened += 1
  const outside = [
    box.left < 0 && `${Math.round(-box.left)}px past the left edge`,
    box.top < 0 && `${Math.round(-box.top)}px past the top`,
    box.right > box.width && `${Math.round(box.right - box.width)}px past the right edge`,
    box.bottom > box.height && `${Math.round(box.bottom - box.height)}px past the bottom`,
    box.panelWidth < box.natural - 1 && `squeezed to ${Math.round(box.panelWidth)} of ${Math.round(box.natural)}px wide`,
  ].filter(Boolean)
  if (outside.length > 0) failures.push(`${label} → ${outside.join(', ')}`)
}

const closeWithEscape = async (page, selector) => {
  await page.keyboard.press('Escape')
  await page.waitForSelector(selector, { state: 'hidden', timeout: TIMEOUT }).catch(() => failures.push(`${selector}: Escape left it open`))
  await page.waitForTimeout(100)
}

const browser = await chromium.launch()
try {
  for (const size of SIZES) {
    const at = `${size.width}×${size.height}`
    const context = await browser.newContext({ viewport: size })
    const page = await context.newPage()
    await page.goto(`${base}/p/demo-getting-started`)
    await page.getByLabel('Email').fill('afinch@hypernotes.example')
    await page.getByLabel('Password').fill('Avery')
    const stream = page.waitForRequest(request => request.url().includes('/stream'))
    await page.getByRole('button', { name: 'Sign in' }).click()
    await stream
    await page.waitForSelector('[data-editor-root] [data-block-id]')
    await page.waitForTimeout(300)

    // The page menus of the sidebar rows nearest the top and the bottom.
    const menus = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('#sidebar [id^="nav-menu-"]')].filter(button => {
        const rect = button.getBoundingClientRect()
        return rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight
      })
      return [...new Set([buttons[0]?.id, buttons.at(-1)?.id].filter(Boolean))]
    })
    for (const id of menus) {
      await page.hover(`#${id}`)
      await page.locator(`#${id}`).click()
      await measure(page, '#picker', `${at} the page menu of ${id}`)
      await closeWithEscape(page, '#picker')
    }
    await page.locator('#sidebar-search').click()
    await measure(page, '#picker', `${at} search`)
    await closeWithEscape(page, '#picker')

    // The page header: the icon picker, the cover picker and the ••• options.
    await page.locator('#page-icon').click()
    await measure(page, '#picker', `${at} the icon picker`)
    await closeWithEscape(page, '#picker')
    await page.hover('#page-cover')
    await page.locator('#change-cover').click()
    await measure(page, '#picker', `${at} the cover picker`)
    await closeWithEscape(page, '#picker')
    await page.locator('#page-options').click()
    await measure(page, '#picker', `${at} the page options`)
    await closeWithEscape(page, '#picker')

    // Editor overlays, on the first block and on one near the bottom of the window.
    const blocks = await page.evaluate(() => {
      const texts = [...document.querySelectorAll('[data-editor-root] > [data-block-id] > .nb-row > [data-text-of]')].filter(text => {
        const rect = text.getBoundingClientRect()
        return rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight - 8
      })
      return [...new Set([texts[0], texts.at(-1)].filter(Boolean).map(text => text.getAttribute('data-text-of')))]
    })
    for (const id of blocks) {
      const where = `${at} block ${blocks.indexOf(id) === 0 ? 'near the top' : 'near the bottom'}`
      const text = page.locator(`[data-text-of="${id}"]`)
      await text.click()
      await page.keyboard.press('End')
      await page.keyboard.type(' /')
      await measure(page, '[data-overlay="nb-slash-menu"]', `${where}: the slash menu`)
      await closeWithEscape(page, '[data-overlay="nb-slash-menu"]')
      await page.keyboard.press('Backspace')
      await page.keyboard.type('@')
      await measure(page, '[data-overlay="nb-mention-menu"]', `${where}: the mention menu`)
      await closeWithEscape(page, '[data-overlay="nb-mention-menu"]')
      await page.keyboard.press('Backspace')
      await page.keyboard.type(':s')
      await measure(page, '[data-overlay="nb-emoji-menu"]', `${where}: the emoji menu`)
      await closeWithEscape(page, '[data-overlay="nb-emoji-menu"]')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Shift+Home')
      await measure(page, '[data-overlay="nb-toolbar"]', `${where}: the inline toolbar`)
      await page.locator('[data-overlay="nb-toolbar"] [data-tool="color"]').click()
      await measure(page, '[data-overlay="nb-color-menu"]', `${where}: the color menu`)
      await closeWithEscape(page, '[data-overlay="nb-color-menu"]')
      await page.keyboard.press('Control+k')
      await measure(page, '[data-overlay="nb-prompt"]', `${where}: the link prompt`)
      await page.keyboard.type('a.example')
      await page.keyboard.press('Enter')
      await page.keyboard.press('End')
      await page.keyboard.press('ArrowLeft')
      await measure(page, '[data-overlay="nb-link-card"]', `${where}: the link card`)
      await page.locator('[data-overlay="nb-link-card"] [data-tool="link-remove"]').click()
      await page.keyboard.press('End')
      await page.hover(`[data-block-id="${id}"]`)
      await page.locator(`[data-action="handle"][data-block="${id}"]`).click()
      await measure(page, '[data-overlay="nb-block-menu"]', `${where}: the block menu`)
      await closeWithEscape(page, '[data-overlay="nb-block-menu"]')
    }
    await context.close()
  }
} finally {
  await browser.close()
}

for (const failure of failures) console.log(`FAIL ${failure}`)
console.log(`\n${opened} overlays opened, ${failures.length} off screen or missing`)
process.exit(failures.length === 0 && opened > 0 ? 0 : 1)
