import { chromium } from 'playwright'

/* Browser check: two people (Avery and Morgan) in Chromium against a running
   server with the demo content (npm run check:fresh provides both). It walks
   the workspace flows: the sidebar tree (sections, private pages, expand and
   collapse), breadcrumbs, creating a page inside another, renaming it, typing
   in the editor, live updates across the two people, favorites, the page
   menu (duplicate, move, trash), Trash (restore, delete), search, the theme
   and the settings presets. The editor's own keyboard rules are walked by
   scripts/check-editor.mjs.

   Usage: node scripts/check.mjs   (URL=… for another server) */

const base = process.env.URL ?? 'http://localhost:4300'
const TIMEOUT = Number(process.env.CHECK_TIMEOUT ?? 6000)
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}
const until = (page, predicate, arg) =>
  page.waitForFunction(predicate, arg, { timeout: TIMEOUT }).then(() => true, () => false)
const settle = page => page.waitForTimeout(250)

const browser = await chromium.launch()
const people = []
/** Demo accounts (npm run demo:seed): the password is the first name. */
const DEMO_EMAILS = { Avery: 'afinch@hypernotes.example', Morgan: 'mvale@hypernotes.example' }

const signIn = async (name, path = '/') => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(`${name}: ${error}`))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`${name}: ${message.text()}`)
  })
  await page.goto(`${base}${path}`)
  await page.getByLabel('Email').fill(DEMO_EMAILS[name])
  await page.getByLabel('Password').fill(name)
  const stream = page.waitForRequest(request => request.url().includes('/stream'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await stream
  await settle(page)
  const person = { page, errors }
  people.push(person)
  return person
}
/** Navigates and waits until the page is live (stream open). */
const visit = async (page, path) => {
  const stream = page.waitForRequest(request => request.url().includes('/stream'))
  await page.goto(`${base}${path}`)
  await stream
  await settle(page)
}
const rows = (page, section) => page.evaluate(section => [...document.querySelectorAll(`#sidebar [data-nav-section="${section}"]`)].map(row => row.getAttribute('data-nav-row')), section)
const pageIdOf = page => new URL(page.url()).pathname.replace('/p/', '')
const openMenu = async (page, section, id) => {
  await page.hover(`[data-nav-row="${id}"][data-nav-section="${section}"]`)
  await page.locator(`#nav-menu-${section}-${id}`).click()
  return until(page, () => document.querySelector('#picker[data-field="page"]') !== null)
}
const choose = async (page, label) => {
  await page.locator('#picker [role="listbox"]').getByText(label, { exact: true }).click()
}

try {
  const avery = await signIn('Avery')
  const morgan = await signIn('Morgan')

  // SIDEBAR
  check('/ opens the first page', await until(avery.page, () => document.querySelector('#page-title')?.value === 'Getting Started'))
  const workspace = (await rows(avery.page, 'workspace')).filter(id => ['demo-getting-started', 'demo-wiki', 'demo-meetings'].includes(id))
  check('the workspace section lists the top-level pages in order', workspace.join() === 'demo-getting-started,demo-wiki,demo-meetings', workspace.join())
  check('a private page shows only for its owner', (await rows(avery.page, 'private')).includes('demo-journal') && !(await rows(morgan.page, 'private')).includes('demo-journal'))
  check('closed pages hide their children', !(await rows(morgan.page, 'workspace')).includes('demo-onboarding'))
  await avery.page.hover('[data-nav-row="demo-wiki"][data-nav-section="workspace"]')
  await avery.page.locator('#nav-toggle-workspace-demo-wiki').click()
  check('opening a page in the sidebar shows its children', await until(avery.page, () => document.querySelector('#sidebar [data-nav-row="demo-onboarding"]') !== null))
  check('opening is per person', (await rows(morgan.page, 'workspace')).includes('demo-onboarding') === false)
  // The toggle carries the state it changes to: click it once the closing one is rendered.
  await until(avery.page, () => document.querySelector('#nav-toggle-workspace-demo-wiki')?.getAttribute('aria-label')?.startsWith('Close') === true)
  await avery.page.hover('[data-nav-row="demo-wiki"][data-nav-section="workspace"]')
  await avery.page.locator('#nav-toggle-workspace-demo-wiki').click()
  check('closing hides them again', await until(avery.page, () => document.querySelector('#sidebar [data-nav-row="demo-onboarding"]') === null))

  // A PAGE
  await visit(avery.page, '/p/demo-onboarding')
  check('breadcrumbs show the path', await until(avery.page, () => [...document.querySelectorAll('#topbar [data-crumb]')].map(crumb => crumb.getAttribute('data-crumb')).join() === 'demo-wiki,demo-onboarding'))
  check('the active page is marked in the sidebar', await until(avery.page, () => document.querySelector('#sidebar [aria-current="page"]')?.closest('[data-nav-row]')?.getAttribute('data-nav-row') === 'demo-onboarding'))
  check('the editor shows the blocks', await until(avery.page, () => [...document.querySelectorAll('[data-editor-root] [data-block-id]')].map(block => block.getAttribute('data-kind')).join() === 'Heading,Todo,Todo,Todo'))
  await visit(avery.page, '/p/demo-getting-started')
  check('rich blocks render (callout, toggle, quote, divider, code, page mention)', await until(avery.page, () =>
    ['Callout', 'Toggle', 'Quote', 'Divider', 'Code', 'Numbered'].every(kind => document.querySelector(`[data-editor-root] [data-kind="${kind}"]`) !== null) &&
    document.querySelector('[data-editor-root] [data-atom="page"][data-page-id="demo-wiki"]') !== null))

  // NEW PAGE, inside another
  await avery.page.hover('[data-nav-row="demo-wiki"][data-nav-section="workspace"]')
  await avery.page.locator('#nav-add-workspace-demo-wiki').click()
  check('+ on a row creates a page inside it and opens it', await avery.page.waitForURL(url => url.pathname.startsWith('/p/') && !url.pathname.includes('demo-'), { timeout: TIMEOUT }).then(() => true, () => false))
  await settle(avery.page)
  const created = pageIdOf(avery.page)
  check('the parent opens to show it', await until(avery.page, id => document.querySelector(`#sidebar [data-nav-row="${id}"]`) !== null, created))
  check('it shows as Untitled', await until(avery.page, id => document.querySelector(`#sidebar [data-nav-row="${id}"]`)?.textContent?.includes('Untitled'), created))
  await avery.page.locator('#page-title').fill('Release checklist')
  await avery.page.locator('#page-title').press('Enter')
  check('a new title shows in the sidebar', await until(avery.page, id => document.querySelector(`#sidebar [data-nav-row="${id}"]`)?.textContent?.includes('Release checklist'), created))
  check('and in the breadcrumbs', await until(avery.page, () => document.querySelector('#topbar')?.textContent?.includes('Release checklist')))
  await visit(morgan.page, `/p/${created}`)
  check('the other person can open it', await until(morgan.page, () => document.querySelector('#page-title')?.value === 'Release checklist'))
  await avery.page.locator('[data-editor-root] [data-text-of]').first().click()
  await avery.page.keyboard.type('Ship it on Friday')
  check("typed text reaches the other person's editor", await until(morgan.page, () => document.querySelector('[data-editor-root] [data-text-of]')?.textContent === 'Ship it on Friday'))
  await avery.page.locator('#page-title').fill('Release checklist v2')
  await avery.page.locator('#page-title').blur()
  check('a title saved on blur reaches the other person', await until(morgan.page, () => document.querySelector('#page-title')?.value === 'Release checklist v2'))
  await visit(avery.page, `/p/${created}`)
  check('the text is saved', await until(avery.page, () => document.querySelector('[data-editor-root] [data-text-of]')?.textContent === 'Ship it on Friday'))

  // FAVORITES
  await avery.page.locator('#favorite-toggle').click()
  check('the star adds the page to Favorites', await until(avery.page, id => document.querySelector(`#sidebar [data-nav-section="favorites"][data-nav-row="${id}"]`) !== null, created))
  check("favorites are per person", (await rows(morgan.page, 'favorites')).includes(created) === false)
  await avery.page.locator('#favorite-toggle').click()
  check('the star takes it off again', await until(avery.page, id => document.querySelector(`#sidebar [data-nav-section="favorites"][data-nav-row="${id}"]`) === null, created))

  // PAGE MENU
  check('••• on a row opens the page menu', await openMenu(avery.page, 'workspace', created))
  check('the menu sits next to its row, on screen', await avery.page.evaluate(() => {
    const rect = document.querySelector('#picker').getBoundingClientRect()
    return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
  }))
  check('the menu takes the keyboard', await until(avery.page, () => document.activeElement?.id === 'picker-input'))
  await avery.page.keyboard.press('Escape')
  check('Esc closes it', await until(avery.page, () => document.querySelector('#picker') === null))
  await openMenu(avery.page, 'workspace', created)
  await choose(avery.page, 'Duplicate')
  check('Duplicate adds a copy below it', await until(avery.page, id => {
    const ids = [...document.querySelectorAll('#sidebar [data-nav-section="workspace"]')].map(row => row.getAttribute('data-nav-row'))
    const at = ids.indexOf(id)
    return at >= 0 && ids[at + 1] !== undefined && document.querySelector(`#sidebar [data-nav-row="${ids[at + 1]}"]`)?.textContent?.includes('Release checklist v2')
  }, created))
  // Polled rather than read once: the page may still be swapping in the copy.
  const copy = await avery.page.waitForFunction(id => {
    const ids = [...document.querySelectorAll('#sidebar [data-nav-section="workspace"]')].map(row => row.getAttribute('data-nav-row'))
    return ids.indexOf(id) >= 0 && ids[ids.indexOf(id) + 1]
  }, created, { timeout: TIMEOUT }).then(handle => handle.jsonValue())
  await visit(morgan.page, `/p/${copy}`)
  check('the copy reaches the other person', await until(morgan.page, () => document.querySelector('#page-title')?.value?.includes('Release checklist v2') === true))
  await openMenu(avery.page, 'workspace', copy)
  await choose(avery.page, 'Move to')
  check('Move to opens the page list', await until(avery.page, () => document.querySelector('#picker[data-field="move"]') !== null))
  await avery.page.locator('#picker-input').fill('Meeting')
  await avery.page.keyboard.press('Enter')
  check('the first match takes the page out of its old place', await until(avery.page, id => document.querySelector(`#sidebar [data-nav-row="${id}"]`) === null, copy))
  await avery.page.hover('[data-nav-row="demo-meetings"][data-nav-section="workspace"]')
  await avery.page.locator('#nav-toggle-workspace-demo-meetings').click()
  check('and puts it under Meeting Notes', await until(avery.page, id => {
    const ids = [...document.querySelectorAll('#sidebar [data-nav-section="workspace"]')].map(entry => entry.getAttribute('data-nav-row'))
    return ids.includes(id) && ids.indexOf(id) > ids.indexOf('demo-meetings')
  }, copy))
  await visit(avery.page, `/p/${copy}`)
  check('its breadcrumbs follow the move', await until(avery.page, () => [...document.querySelectorAll('#topbar [data-crumb]')].map(crumb => crumb.getAttribute('data-crumb'))[0] === 'demo-meetings'))
  await openMenu(avery.page, 'workspace', copy)
  await choose(avery.page, 'Move to Trash')
  check('Move to Trash takes it off the sidebar', await until(avery.page, id => document.querySelector(`#sidebar [data-nav-row="${id}"]`) === null, copy))
  check('the open page says it is in Trash', await until(avery.page, () => document.querySelector('#trash-banner') !== null && document.querySelector('[data-read-only]') !== null))
  check('and for the other person', await until(morgan.page, id => document.querySelector(`#sidebar [data-nav-row="${id}"]`) === null, copy))

  // TRASH
  await visit(avery.page, '/?trash=1')
  check('Trash lists the page', await until(avery.page, id => document.querySelector(`[data-trash-row="${id}"]`) !== null, copy))
  await avery.page.getByRole('button', { name: 'Restore Release checklist v2' }).click()
  check('Restore puts it back in the sidebar', await until(avery.page, id => document.querySelector(`#sidebar [data-nav-row="${id}"]`) !== null, copy))
  await openMenu(avery.page, 'workspace', copy)
  await choose(avery.page, 'Move to Trash')
  await until(avery.page, id => document.querySelector(`[data-trash-row="${id}"]`) !== null, copy)
  await avery.page.locator('#trash-search').fill('checklist v2')
  check('searching Trash keeps the matching page and says where it was', await until(avery.page, id => document.querySelector(`[data-trash-row="${id}"]`)?.textContent?.includes('In Getting Started') === true || document.querySelector(`[data-trash-row="${id}"]`)?.textContent?.includes('Deleted') === true, copy))
  await avery.page.locator('#trash-search').fill('no such page here')
  check('and shows "No matches" when nothing fits', await until(avery.page, () => document.querySelector('#trash-no-match') !== null && document.querySelector('[data-trash-row]') === null))
  await avery.page.locator('#trash-search').fill('')
  await until(avery.page, id => document.querySelector(`[data-trash-row="${id}"]`) !== null, copy)
  await avery.page.getByRole('button', { name: 'Delete Release checklist v2 from Trash' }).click()
  check('Delete from Trash asks first, focused on the delete button', await until(avery.page, () => document.activeElement?.id === 'confirm-delete'))
  await avery.page.keyboard.press('Escape')
  check('Esc keeps the page', await until(avery.page, id => document.querySelector('#confirm-delete-layer') === null && document.querySelector(`[data-trash-row="${id}"]`) !== null, copy))
  await avery.page.getByRole('button', { name: 'Delete Release checklist v2 from Trash' }).click()
  await avery.page.locator('#confirm-delete').click()
  check('Delete from Trash removes it for good', await until(avery.page, id => document.querySelector(`[data-trash-row="${id}"]`) === null, copy))

  // PAGE HEADER AND STYLE
  await visit(avery.page, '/p/demo-style')
  await avery.page.locator('#page-icon').click()
  await until(avery.page, () => document.querySelector('#picker[data-field="icon"]') !== null)
  await choose(avery.page, 'Remove')
  check('the icon picker removes the icon', await until(avery.page, () => document.querySelector('#page-icon') === null && document.querySelector('#add-icon') !== null))
  await avery.page.hover('#page-title')
  await avery.page.locator('#add-icon').click()
  check('Add icon gives the page an emoji', await until(avery.page, () => document.querySelector('#page-icon')?.textContent?.trim() !== ''))
  await avery.page.hover('#page-title')
  await avery.page.locator('#add-cover').click()
  check('Add cover puts a gallery cover on top', await until(avery.page, () => document.querySelector('#page-cover[data-cover]') !== null))
  await avery.page.locator('#page-icon').click()
  check('the icon opens the emoji picker, focused', await until(avery.page, () => document.querySelector('#picker[data-field="icon"]') !== null && document.activeElement?.id === 'picker-input'))
  await avery.page.keyboard.type('rocket')
  await avery.page.keyboard.press('Enter')
  check('typing filters it and Enter sets the emoji', await until(avery.page, () => document.querySelector('#page-icon')?.textContent?.includes(String.fromCodePoint(0x1f680)) === true && document.querySelector('#picker') === null))
  const chooseOption = async label => {
    await avery.page.locator('#page-options').click()
    await until(avery.page, () => document.querySelector('#picker[data-field="options"]') !== null)
    await choose(avery.page, label)
    await until(avery.page, () => document.querySelector('#picker') === null)
  }
  await chooseOption('Full width')
  check('••• Full width widens the page', await until(avery.page, () => document.querySelector('#page-body[data-full-width]') !== null))
  await chooseOption('Serif')
  check('••• Serif changes the font', await until(avery.page, () => document.querySelector('#page-body[data-font="serif"]') !== null))
  await chooseOption('Small text')
  check('••• Small text makes the text smaller', await until(avery.page, () => document.querySelector('#page-body[data-small-text]') !== null))
  await visit(morgan.page, '/p/demo-style')
  check('the other person sees the new look', await until(morgan.page, () => document.querySelector('#page-cover') !== null && document.querySelector('#page-body[data-font="serif"][data-full-width]') !== null))
  await chooseOption('Lock page')
  check('Lock page makes it read-only', await until(avery.page, () => document.querySelector('#page-locked') !== null && document.querySelector('[data-read-only="demo-style"]') !== null && document.querySelector('#page-title')?.readOnly === true))
  check('a locked page hides the cover controls', await until(avery.page, () => document.querySelector('#change-cover') === null && document.querySelector('#add-icon') === null))
  await avery.page.locator('#page-locked').click()
  check('Locked unlocks it again', await until(avery.page, () => document.querySelector('#page-locked') === null && document.querySelector('[data-editor-root]') !== null))
  await avery.page.hover('#page-cover')
  await avery.page.locator('#remove-cover').click()
  check('Remove takes the cover off', await until(avery.page, () => document.querySelector('#page-cover') === null))

  // SEARCH
  await avery.page.keyboard.press('Control+k')
  check('Ctrl+K opens search', await until(avery.page, () => document.querySelector('#picker[data-field="search"]') !== null))
  await avery.page.keyboard.press('Escape')
  await until(avery.page, () => document.querySelector('#picker') === null)
  await avery.page.locator('#sidebar-search').click()
  check('Search opens a centered palette with the query focused', await until(avery.page, () => document.querySelector('#picker[data-field="search"]') !== null && document.activeElement?.id === 'picker-input'))
  await avery.page.keyboard.type('onboard')
  check('typing narrows the pages', await until(avery.page, () => {
    const items = [...document.querySelectorAll('#picker [role="listbox"] [id^="picker-item-"]')]
    return items.length === 1 && items[0].textContent.includes('Onboarding')
  }))
  await avery.page.keyboard.press('Enter')
  check('Enter opens the page', await avery.page.waitForURL('**/p/demo-onboarding', { timeout: TIMEOUT }).then(() => true, () => false))
  await avery.page.locator('#sidebar-search').click()
  check('an empty search lists recent pages', await until(avery.page, () => [...document.querySelectorAll('#picker [role="listbox"] > div')].some(node => node.textContent === 'Recent')))
  await avery.page.keyboard.type('plain words')
  check('search finds a page by its text and highlights the words, with where the page lives', await until(avery.page, () => {
    const items = [...document.querySelectorAll('#picker [role="listbox"] [id^="picker-item-"]')]
    return items.length === 1 && items[0].querySelector('[data-picker-match]')?.textContent === 'Plain' && items[0].querySelector('[data-picker-hint]')?.textContent === 'Engineering Wiki'
  }))
  await avery.page.keyboard.press('Enter')
  check('Enter opens the page it found', await avery.page.waitForURL('**/p/demo-style', { timeout: TIMEOUT }).then(() => true, () => false))

  // COMMENTS: a discussion reaches the other person live; reply, edit, resolve, delete.
  await visit(avery.page, '/p/demo-onboarding')
  await visit(morgan.page, '/p/demo-onboarding')
  const commentText = (page, text) => until(page, wanted => [...document.querySelectorAll('[data-comment-text]')].some(node => node.textContent === wanted), text)
  await avery.page.hover('#page-title')
  await avery.page.locator('#add-comment').click()
  check('Add comment opens a focused comment box', await until(avery.page, () => document.activeElement?.id === 'comment-input'))
  await avery.page.keyboard.type('Can we add a reading list?')
  await settle(avery.page)
  await avery.page.keyboard.press('Enter')
  check('Enter posts it as a discussion and closes the box', await commentText(avery.page, 'Can we add a reading list?') && await until(avery.page, () => document.querySelector('#comment-form') === null))
  check('the discussion reaches the other person', await commentText(morgan.page, 'Can we add a reading list?'))
  const threadId = await morgan.page.evaluate(() => document.querySelector('#page-comments [data-thread]')?.getAttribute('data-thread'))
  await morgan.page.locator(`#reply-${threadId}`).click()
  await until(morgan.page, () => document.activeElement?.id === 'comment-input')
  await morgan.page.keyboard.type('Sure, line one')
  await morgan.page.keyboard.press('Shift+Enter')
  await morgan.page.keyboard.type('line two')
  await settle(morgan.page)
  await morgan.page.keyboard.press('Enter')
  check('a reply keeps its Shift+Enter line break and joins the discussion', await until(avery.page, id =>
    [...(document.querySelector(`[data-thread="${id}"]`)?.querySelectorAll('[data-comment-text]') ?? [])].map(node => node.textContent).join('|') === 'Can we add a reading list?|Sure, line one\nline two', threadId))
  check('only the author may edit or delete', await until(morgan.page, id => document.querySelector(`#edit-${id}`) === null && document.querySelector(`#resolve-${id}`) !== null, threadId))
  await avery.page.hover(`[data-comment="${threadId}"]`)
  await avery.page.locator(`#edit-${threadId}`).click()
  check('Edit puts the text in a focused box', await until(avery.page, () => document.activeElement?.id === 'comment-input' && document.activeElement.value === 'Can we add a reading list?'))
  await avery.page.keyboard.press('Escape')
  check('Esc cancels the edit', await until(avery.page, () => document.querySelector('#comment-form') === null))
  await avery.page.hover(`[data-comment="${threadId}"]`)
  await avery.page.locator(`#edit-${threadId}`).click()
  await until(avery.page, () => document.activeElement?.id === 'comment-input')
  await avery.page.keyboard.press('Control+a')
  await avery.page.keyboard.type('Can we add a reading list soon?')
  await settle(avery.page)
  await avery.page.keyboard.press('Enter')
  check('a saved edit shows (edited) to everyone', await commentText(morgan.page, 'Can we add a reading list soon?') && await until(morgan.page, id => document.querySelector(`[data-comment="${id}"]`)?.textContent.includes('(edited)'), threadId))
  await morgan.page.hover(`[data-comment="${threadId}"]`)
  await morgan.page.locator(`#resolve-${threadId}`).click()
  check('Resolve tucks the discussion behind "1 resolved discussion"', await until(avery.page, id => document.querySelector(`[data-thread="${id}"]`) === null && document.querySelector('#show-resolved')?.textContent.includes('1 resolved discussion'), threadId))
  await avery.page.locator('#show-resolved').click()
  check('resolved discussions show on request, without a reply button', await until(avery.page, id => document.querySelector(`[data-thread="${id}"][data-resolved]`) !== null && document.querySelector(`#reply-${id}`) === null, threadId))
  await avery.page.hover(`[data-comment="${threadId}"]`)
  await avery.page.locator(`#resolve-${threadId}`).click()
  check('Reopen brings it back', await until(morgan.page, id => document.querySelector(`[data-thread="${id}"]:not([data-resolved])`) !== null && document.querySelector('#show-resolved') === null, threadId))
  await avery.page.hover(`[data-comment="${threadId}"]`)
  await avery.page.locator(`#delete-${threadId}`).click()
  check('deleting the first comment removes the discussion for everyone', await until(morgan.page, () => document.querySelector('#page-comments') === null))

  // DATABASES: a table page with typed, picked, toggled and dated cells, shared live.
  const before = avery.page.url()
  await visit(avery.page, '/p/demo-wiki')
  await avery.page.hover('[data-nav-row="demo-wiki"][data-nav-section="workspace"]')
  await avery.page.locator('#nav-add-workspace-demo-wiki').click()
  await avery.page.waitForURL(url => url.href !== before && url.pathname.startsWith('/p/') && !url.pathname.includes('demo-'), { timeout: TIMEOUT })
  await settle(avery.page)
  const dbId = pageIdOf(avery.page)
  await avery.page.locator('#page-title').fill('Projects')
  await avery.page.locator('#page-title').press('Enter')
  await avery.page.locator('#make-table').click()
  check('an empty page becomes a table database', await until(avery.page, () => document.querySelector('#database-table [role="table"]') !== null && document.querySelector('[data-editor-root]') === null))
  const headers = page => page.evaluate(() => [...document.querySelectorAll('#database-table [role="columnheader"] button')].map(button => button.textContent))
  check('it starts with Name and Tags', (await headers(avery.page)).join() === 'Name,Tags', (await headers(avery.page)).join())
  await visit(morgan.page, `/p/${dbId}`)
  await avery.page.locator('#new-row').click()
  check('+ New page adds a row and focuses its name', await until(avery.page, () => document.activeElement?.id === 'cell-input'))
  await avery.page.keyboard.type('Launch site')
  await avery.page.keyboard.press('Enter')
  const titles = page => page.evaluate(() => [...document.querySelectorAll('#database-table [data-row]')].map(row => row.querySelector('[role="cell"] button')?.textContent ?? ''))
  check("the row's name reaches the other person", await until(morgan.page, () => [...document.querySelectorAll('#database-table [data-row]')].some(row => row.textContent?.includes('Launch site'))))
  check('the footer counts the rows', await until(avery.page, () => document.querySelector('#row-count')?.textContent === 'Count 1'))
  const rowId = await avery.page.evaluate(() => document.querySelector('#database-table [data-row]')?.getAttribute('data-row'))
  const propertyId = async (page, name) => (await page.evaluate(name => [...document.querySelectorAll('#database-table [role="columnheader"] button')].find(button => button.textContent === name)?.id, name))?.replace('header-', '')
  const tags = await propertyId(avery.page, 'Tags')
  await avery.page.locator(`#cell-${rowId}-${tags}`).click()
  check('a multi-select cell opens its option menu', await until(avery.page, () => document.querySelector('#picker[data-field="cells"]') !== null && document.activeElement?.id === 'picker-input'))
  await avery.page.keyboard.type('Urgent')
  check('typing a new name offers to create it', await until(avery.page, () => document.querySelector('#picker [role="listbox"]')?.textContent?.includes('Create "Urgent"')))
  await avery.page.keyboard.press('Enter')
  check('the created option is picked, for everyone', await until(morgan.page, () => document.querySelector('#database-table [data-chip]')?.textContent === 'Urgent'))
  check('the menu stays open to pick more', await until(avery.page, () => document.querySelector('#picker[data-field="cells"]') !== null))
  await avery.page.keyboard.press('Escape')
  await until(avery.page, () => document.querySelector('#picker') === null)
  await avery.page.locator('#add-property').click()
  await choose(avery.page, 'Checkbox')
  check('+ adds a property of the chosen type', await until(avery.page, () => [...document.querySelectorAll('#database-table [role="columnheader"]')].some(head => head.textContent === 'Checkbox')))
  const done = await propertyId(avery.page, 'Checkbox')
  await avery.page.locator(`#cell-${rowId}-${done}`).click()
  check('a checkbox cell toggles for everyone', await until(morgan.page, ([row, prop]) => document.querySelector(`#cell-${row}-${prop}`)?.hasAttribute('data-checked'), [rowId, done]))
  await avery.page.locator('#add-property').click()
  await choose(avery.page, 'Number')
  await until(avery.page, () => [...document.querySelectorAll('#database-table [role="columnheader"]')].some(head => head.textContent === 'Number'))
  const points = await propertyId(avery.page, 'Number')
  await avery.page.locator(`#cell-${rowId}-${points}`).click()
  await until(avery.page, () => document.activeElement?.id === 'cell-input')
  await avery.page.keyboard.type('abc')
  await avery.page.keyboard.press('Enter')
  check('a number cell refuses text', await until(avery.page, () => document.querySelector('#notice')?.textContent?.includes('Enter a number')))
  await avery.page.locator(`#cell-${rowId}-${points}`).click()
  await until(avery.page, () => document.activeElement?.id === 'cell-input')
  await avery.page.keyboard.type('42')
  await avery.page.keyboard.press('Enter')
  check('and keeps a number', await until(morgan.page, ([row, prop]) => document.querySelector(`#cell-${row}-${prop}`)?.textContent === '42', [rowId, points]))
  await avery.page.locator(`#cell-${rowId}-${points}`).click()
  await until(avery.page, () => document.activeElement?.id === 'cell-input')
  await avery.page.keyboard.type('7')
  await avery.page.keyboard.press('Escape')
  check('Esc leaves a cell unchanged', await until(avery.page, ([row, prop]) => document.querySelector(`#cell-${row}-${prop}`)?.textContent === '42', [rowId, points]))
  await avery.page.locator(`#header-${tags}`).click()
  await choose(avery.page, 'Rename')
  await until(avery.page, () => document.activeElement?.id === 'property-name')
  await avery.page.locator('#property-name').fill('Labels')
  await avery.page.locator('#property-name').press('Enter')
  check('a property is renamed from its header menu', await until(morgan.page, () => [...document.querySelectorAll('#database-table [role="columnheader"]')].some(head => head.textContent === 'Labels')))
  await avery.page.locator('#new-row').click()
  await until(avery.page, () => document.activeElement?.id === 'cell-input')
  await avery.page.keyboard.type('Alpha')
  await avery.page.keyboard.press('Enter')
  await until(avery.page, () => document.querySelector('#row-count')?.textContent === 'Count 2')
  await avery.page.locator('#header-title').click()
  await choose(avery.page, 'Sort ascending')
  check('sorting by name orders the rows', await until(avery.page, () => [...document.querySelectorAll('#database-table [data-row]')].map(row => row.textContent).join('|').indexOf('Alpha') < [...document.querySelectorAll('#database-table [data-row]')].map(row => row.textContent).join('|').indexOf('Launch site')))
  await avery.page.locator('#database-search-toggle').click()
  await until(avery.page, () => document.activeElement?.id === 'database-search')
  await avery.page.keyboard.type('laun')
  check('the database search filters the rows', await until(avery.page, () => document.querySelectorAll('#database-table [data-row]').length === 1 && document.querySelector('#row-count')?.textContent === 'Count 1'))
  await avery.page.hover(`[data-nav-row="${dbId}"][data-nav-section="workspace"]`)
  await avery.page.locator(`#nav-toggle-workspace-${dbId}`).click()
  await settle(avery.page)
  check("rows don't clutter the sidebar", await until(avery.page, id => document.querySelector(`#sidebar [data-nav-row="${id}"]`) === null, rowId))
  await visit(avery.page, `/p/${rowId}`)
  check("a row's page lists its properties under the title", await until(avery.page, () => document.querySelector('#row-properties')?.textContent?.includes('Urgent') && document.querySelector('#row-properties')?.textContent?.includes('42')))
  await visit(morgan.page, `/p/${dbId}`)
  await avery.page.locator('#page-title').fill('Launch the site')
  await avery.page.locator('#page-title').press('Enter')
  check("renaming the row's page renames the row", await until(morgan.page, () => document.querySelector('#database-table')?.textContent?.includes('Launch the site')))

  // DATABASE VIEWS: board, list, gallery and calendar over the seeded Tasks database.
  await visit(avery.page, '/p/demo-tasks')
  await visit(morgan.page, '/p/demo-tasks')
  const addView = async (page, label) => {
    await page.locator('#add-view').click()
    await until(page, () => document.querySelector('#picker[data-field="addView"]') !== null)
    await choose(page, label)
  }
  // Each drag event waits for the server to take the previous one, as a person's slower drag would.
  const drag = async (page, from, to) => {
    const transfer = await page.evaluateHandle(() => new DataTransfer())
    await page.locator(from).dispatchEvent('dragstart', { dataTransfer: transfer })
    await until(page, selector => document.querySelector(selector)?.classList.contains('nb-db-dragged'), from)
    await page.locator(to).dispatchEvent('dragenter', { dataTransfer: transfer })
    await until(page, selector => document.querySelector(selector)?.getAttribute('data-drop-on') === 'true', to)
    await page.locator(to).dispatchEvent('drop', { dataTransfer: transfer })
    await until(page, () => document.querySelector('.nb-db-dragged') === null)
    if (await page.locator(from).count() > 0) await page.locator(from).dispatchEvent('dragend', { dataTransfer: transfer })
  }
  await addView(avery.page, 'Board')
  check('+ Board adds a board grouped by status', await until(avery.page, () => document.querySelector('#database-board')?.getAttribute('data-group-by') === 'demo-status' && document.querySelectorAll('#database-board [data-group]').length === 4))
  check('board columns count their cards', await until(avery.page, () => document.querySelector('[data-count="demo-todo"]')?.textContent === '1' && document.querySelector('[data-count="demo-doing"]')?.textContent === '1'))
  await drag(avery.page, '#database-board [data-row="demo-task-1"]', '#database-board [data-group="demo-done"]')
  check('dragging a card to another column moves it there', await until(avery.page, () => document.querySelector('#database-board [data-group="demo-done"] [data-row="demo-task-1"]') !== null))
  check('the moved card changes its status for everyone', await until(morgan.page, () => document.querySelector('#cell-demo-task-1-demo-status')?.textContent === 'Done'))
  await avery.page.locator('#new-in-demo-doing').click()
  check('+ New in a column adds a row to that column', await until(avery.page, () => [...document.querySelectorAll('#database-board [data-group="demo-doing"] [data-row]')].some(row => !row.getAttribute('data-row')?.startsWith('demo-'))))
  await addView(avery.page, 'List')
  check('+ List shows one line per row', await until(avery.page, () => document.querySelectorAll('#database-list [data-row]').length === 4))
  check('list lines show their properties on the right', await until(avery.page, () => document.querySelector('#database-list [data-row="demo-task-1"] [data-value="demo-status"]')?.textContent === 'Done'))
  await addView(avery.page, 'Gallery')
  check('+ Gallery shows a card per row', await until(avery.page, () => document.querySelectorAll('#database-gallery [data-row]').length === 4))
  await addView(avery.page, 'Calendar')
  check('+ Calendar shows the month by the Due date', await until(avery.page, () => document.querySelector('#database-calendar')?.getAttribute('data-date-by') === 'demo-due' && document.querySelectorAll('#database-calendar [data-day]').length >= 35))
  const month = await avery.page.evaluate(() => document.querySelector('#database-calendar')?.getAttribute('data-month'))
  await avery.page.locator('#calendar-next').click()
  check('the arrows page through months', await until(avery.page, start => document.querySelector('#database-calendar')?.getAttribute('data-month') !== start, month))
  await avery.page.locator('#calendar-today').click()
  check('Today goes back to this month', await until(avery.page, start => document.querySelector('#database-calendar')?.getAttribute('data-month') === start, month))
  await avery.page.hover(`[data-day="${month}-15"]`)
  await avery.page.locator(`#new-on-${month}-15`).click()
  check('+ on a day adds a row due that day', await until(avery.page, day => document.querySelectorAll(`[data-day="${day}"] [data-row]`).length === 1, `${month}-15`))
  await drag(avery.page, `[data-day="${month}-15"] [data-row]`, `[data-day="${month}-16"]`)
  check('dragging a row to another day moves its date', await until(avery.page, day => document.querySelectorAll(`[data-day="${day}"] [data-row]`).length === 1 && document.querySelectorAll(`[data-day="${day.slice(0, 8)}15"] [data-row]`).length === 0, `${month}-16`))
  await avery.page.locator('#view-demo-tasks-table').click()
  check('the first tab goes back to the table', await until(avery.page, () => document.querySelectorAll('#database-table [data-row]').length === 5))

  // THEME
  await settle(avery.page)
  await avery.page.locator('#theme-toggle').click()
  check('dark mode', await until(avery.page, () => document.querySelector('#app')?.classList.contains('dark')))
  await avery.page.locator('#theme-toggle').click()
  await until(avery.page, () => !document.querySelector('#app')?.classList.contains('dark'))

  // SETTINGS: a theme preset follows the person onto every page, and back.
  await visit(avery.page, '/settings')
  await avery.page.locator('#preset-nord').click()
  check('a theme preset is worn on the page root', await until(avery.page, () => document.querySelector('#app')?.classList.contains('theme-nord')))
  check('the preset card shows as chosen', await until(avery.page, () => document.querySelector('#preset-nord')?.getAttribute('aria-pressed') === 'true'))
  await visit(avery.page, '/p/demo-wiki')
  check('other pages wear it too', await until(avery.page, () => document.querySelector('#app')?.classList.contains('theme-nord')))
  await visit(avery.page, '/settings')
  await avery.page.locator('#preset-default').click()
  check('the app theme takes the preset off again', await until(avery.page, () => ![...(document.querySelector('#app')?.classList ?? [])].some(name => name.startsWith('theme-'))))
  const fontStatus = await avery.page.evaluate(async () => (await fetch('/fonts/lora-400.woff2')).status)
  check('preset fonts are served', fontStatus === 200, String(fontStatus))

  const errors = people.flatMap(person => person.errors)
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}

const failed = results.filter(result => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
