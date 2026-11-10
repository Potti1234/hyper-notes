import { chromium } from 'playwright'

/* Browser check: two people (Avery and Morgan) in Chromium against a running
   server (npm start, or NODE_ENV=production). It walks every Tier 1 and
   Tier 2 flow: the grouped list, filters and search in the URL, My issues,
   creating an issue, the issue page (title, properties, comments, activity),
   live updates and presence across the two people, the board, docs, the
   project chat and calendar, and the keyboard (c, j/k, Enter, s/p/a, /, Ctrl+K, Ctrl+Enter, Esc).

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
const settle = page => page.waitForTimeout(150)

const browser = await chromium.launch()
const people = []
/** Demo accounts (npm run demo:seed): the password is the first name. */
const DEMO_EMAILS = { Avery: 'afinch@hypernotes.example', Morgan: 'mvale@hypernotes.example' }

const signIn = async (name, path = '/project/ORB', email = DEMO_EMAILS[name], password = name) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(`${name}: ${error}`))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`${name}: ${message.text()}`)
  })
  await page.goto(`${base}${path}`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  const stream = page.waitForRequest(request => request.url().includes('/stream'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await stream
  await page.waitForFunction(() => document.querySelector('#hyper-keys[data-hyper-keys]') !== null)
  const person = { page, errors }
  people.push(person)
  return person
}
/** Navigates and waits until the page is live (stream open, key bindings rendered). */
const visit = async (page, path) => {
  const stream = page.waitForRequest(request => request.url().includes('/stream'))
  await page.goto(`${base}${path}`)
  await stream
  await page.waitForFunction(() => document.querySelector('#hyper-keys[data-hyper-keys]') !== null)
  await settle(page)
}
const rowsText = page => page.evaluate(() => [...document.querySelectorAll('#issue-list [id^="row-"]')].map(row => row.id.slice(4)))

try {
  const avery = await signIn('Avery')
  const morgan = await signIn('Morgan')

  // LIST
  const groups = await avery.page.evaluate(() =>
    [...document.querySelectorAll('#issue-list section')].map(section => ({
      status: section.id.replace('group-', ''),
      count: Number(section.querySelector('[data-count]')?.textContent),
      rows: section.querySelectorAll('[id^="row-"]').length,
    })),
  )
  check('the list is grouped by status with counts', groups.length >= 4 && groups.every(group => group.count === group.rows), JSON.stringify(groups.map(g => `${g.status}:${g.count}`)))
  check('groups put started work first', groups[0]?.status === 'in_review' && groups.at(-1)?.status === 'canceled')
  const firstRow = avery.page.locator('#issue-list [id^="row-"]').first()
  check('rows show priority, identifier, status, title, labels, assignee and date', await firstRow.evaluate(row =>
    row.querySelector('[aria-label^="Priority"]') !== null &&
    /^[A-Z]+-\d+$/.test(row.id.slice(4)) &&
    row.querySelector('[aria-label^="Status"]') !== null &&
    row.querySelector('[aria-label^="Assign"]') !== null &&
    /[A-Z][a-z]{2} \d+/.test(row.textContent),
  ))

  // SEARCH (in the URL)
  await avery.page.locator('#search').pressSequentially('memory', { delay: 10 })
  check('search narrows the list', await until(avery.page, () => {
    const rows = [...document.querySelectorAll('#issue-list [id^="row-"]')]
    return rows.length === 1 && rows[0].textContent.toLowerCase().includes('memory')
  }))
  check('search is reflected in the URL', await until(avery.page, () => location.search.includes('q=memory')))
  await avery.page.locator('#search').fill('')
  await avery.page.locator('#search').dispatchEvent('input')
  await until(avery.page, () => !location.search.includes('q='))

  // FILTERS (in the URL)
  await avery.page.locator('#filter-button').click()
  await until(avery.page, () => document.activeElement?.id === 'picker-input')
  await avery.page.keyboard.type('in progress', { delay: 10 })
  await settle(avery.page)
  await avery.page.keyboard.press('Enter')
  check('a status filter shows only that status', await until(avery.page, () => {
    const rows = [...document.querySelectorAll('#issue-list [id^="row-"]')]
    return rows.length > 0 && rows.every(row => row.dataset.status === 'in_progress')
  }))
  check('the filter is reflected in the URL', await until(avery.page, () => location.search.includes('status=in_progress')))
  await avery.page.keyboard.press('Escape')
  await until(avery.page, () => document.querySelector('#picker') === null)
  await avery.page.reload()
  await avery.page.waitForFunction(() => document.querySelector('#hyper-keys[data-hyper-keys]') !== null)
  check('a filtered URL opens filtered', await until(avery.page, () =>
    document.querySelector('[data-filter="status"]') !== null &&
    [...document.querySelectorAll('#issue-list [id^="row-"]')].every(row => row.dataset.status === 'in_progress'),
  ))
  await avery.page.getByRole('button', { name: 'Remove Status filter' }).click()
  check('removing the filter clears it from the URL', await until(avery.page, () => !location.search.includes('status=')))

  // MY ISSUES
  await visit(avery.page, '/my-issues')
  check('My issues shows only my issues', await until(avery.page, () => {
    const rows = [...document.querySelectorAll('#issue-list [id^="row-"]')]
    return rows.length > 0 && rows.every(row => row.querySelector('[aria-label="Assignee: Avery Finch"]') !== null)
  }))
  await visit(avery.page, '/project/ORB')

  // The sidebar moves between list scopes within the session: no page load,
  // the same session, and back returns to the project.
  await settle(avery.page)
  const sessionBefore = await avery.page.evaluate(() => {
    window.hyperCheckMarker = true
    return document.getElementById('hyper-control')?.getAttribute('data-hyper-endpoint')
  })
  await avery.page.locator('nav a[href="/my-issues"]').first().click()
  check('a sidebar link moves to My issues within the session', await avery.page.waitForURL('**/my-issues', { timeout: TIMEOUT }).then(() => true, () => false) && await until(avery.page, () => {
    const rows = [...document.querySelectorAll('#issue-list [id^="row-"]')]
    return rows.length > 0 && rows.every(row => row.querySelector('[aria-label="Assignee: Avery Finch"]') !== null)
  }) && await avery.page.evaluate(endpoint => window.hyperCheckMarker === true && document.getElementById('hyper-control')?.getAttribute('data-hyper-endpoint') === endpoint, sessionBefore))
  await avery.page.goBack()
  check('back returns to the project list in the same session', await avery.page.waitForURL('**/project/ORB', { timeout: TIMEOUT }).then(() => true, () => false) && await until(avery.page, () => document.querySelector('#issue-list [id^="row-ORB-"]') !== null && document.querySelector('#issue-list [id^="row-PRS-"]') === null && window.hyperCheckMarker === true))

  // An issue page, then back: the list is a fresh page (never a cached copy
  // replaying the old session's event numbers), so shortcuts still work.
  await avery.page.keyboard.press('j')
  await settle(avery.page)
  await avery.page.keyboard.press('Enter')
  await avery.page.waitForURL('**/issue/**', { timeout: TIMEOUT })
  await settle(avery.page)
  const reopened = avery.page.waitForRequest(request => request.url().includes('/stream'))
  await avery.page.goBack()
  await reopened
  await settle(avery.page)
  await avery.page.keyboard.press('j')
  await avery.page.keyboard.press('s')
  check('after an issue page and back, s opens the status picker', await until(avery.page, () => document.activeElement?.id === 'picker-input'))
  await avery.page.keyboard.press('Escape')
  await until(avery.page, () => document.querySelector('#picker') === null)

  // CREATE ISSUE
  await avery.page.keyboard.press('c')
  check('c opens the new issue dialog with the title focused', await until(avery.page, () => document.activeElement?.id === 'draft-title'))
  await avery.page.locator('#draft-submit').click()
  check('an empty title is refused', await until(avery.page, () => document.querySelector('#draft-title-error')?.textContent?.includes('Give the issue a title')))
  const title = `Checkout fails for EU cards ${Date.now() % 100000}`
  await avery.page.locator('#draft-title').pressSequentially(title, { delay: 5 })
  await avery.page.locator('#draft-priority').click()
  await until(avery.page, () => document.activeElement?.id === 'picker-input')
  await avery.page.keyboard.type('high', { delay: 10 })
  await settle(avery.page)
  await avery.page.keyboard.press('Enter')
  await until(avery.page, () => document.querySelector('#draft-priority')?.textContent?.includes('High'))
  await avery.page.locator('#draft-labels').click()
  await until(avery.page, () => document.activeElement?.id === 'picker-input')
  await avery.page.getByRole('option', { name: 'Bug' }).click()
  await until(avery.page, () => document.querySelector('#draft-labels')?.textContent?.includes('Bug'))
  await avery.page.keyboard.press('Escape')
  await until(avery.page, () => document.querySelector('#picker') === null)
  await avery.page.locator('#draft-description').fill('Cards issued in the EU are declined at the 3-D Secure step.')
  await avery.page.locator('#draft-description').press('Control+Enter')
  check('Ctrl+Enter creates the issue and confirms it', await until(avery.page, () => document.querySelector('#toast')?.textContent?.includes('Created')))
  const created = await avery.page.evaluate(() => document.querySelector('#toast')?.textContent?.match(/[A-Z]+-\d+/)?.[0])
  check('the new issue appears in the list with its properties', await until(avery.page, id => {
    const row = document.querySelector(`#row-${id}`)
    return row?.dataset.status === 'todo' && row.querySelector('[aria-label="Priority: High"]') !== null && row.textContent.includes('Bug')
  }, created), created)
  check("it appears live in the other person's list", await until(morgan.page, id => document.querySelector(`#row-${id}`) !== null, created))

  // ISSUE PAGE + PRESENCE
  await avery.page.locator(`#row-${created} a`).click()
  await avery.page.waitForURL(`**/issue/${created}`)
  await avery.page.waitForFunction(() => document.querySelector('#hyper-keys[data-hyper-keys]') !== null)
  await visit(morgan.page, `/issue/${created}`)
  check('the issue page shows title, description and properties', await until(avery.page, text =>
    document.querySelector('#issue-title')?.value === text &&
    document.querySelector('#issue-description')?.value.includes('3-D Secure') &&
    document.querySelector('#property-priority')?.textContent.includes('High'), title))
  check('presence: each sees the other viewing', (await until(avery.page, () => document.querySelector('#viewers')?.textContent?.includes('Morgan'))) && (await until(morgan.page, () => document.querySelector('#viewers')?.textContent?.includes('Avery'))))

  // Edit the title.
  const newTitle = `${title} (3DS)`
  await avery.page.locator('#issue-title').click()
  await avery.page.locator('#issue-title').press('End')
  await avery.page.locator('#issue-title').pressSequentially(' (3DS)', { delay: 10 })
  await avery.page.locator('#issue-title').press('Enter')
  check("a title edit reaches the other person's page", await until(morgan.page, text => document.querySelector('#issue-title')?.value === text, newTitle))
  check('the title edit is in the activity log', await until(morgan.page, () => [...document.querySelectorAll('#activity [data-kind="title"]')].length === 1))

  // Description, saved when the field loses focus.
  await morgan.page.locator('#issue-description').click()
  await morgan.page.locator('#issue-description').press('End')
  await morgan.page.locator('#issue-description').pressSequentially(' Only Visa.', { delay: 5 })
  await morgan.page.locator('#comment-input').click()
  check('a description edit is saved on blur and shows for the other person', await until(avery.page, () => document.querySelector('#issue-description')?.value.endsWith('Only Visa.')))

  // Properties through the picker (mouse) and the keyboard (s, a).
  await morgan.page.locator('#property-status').click()
  await until(morgan.page, () => document.activeElement?.id === 'picker-input')
  await morgan.page.keyboard.type('progress', { delay: 10 })
  await settle(morgan.page)
  await morgan.page.keyboard.press('Enter')
  check('a status change from the properties panel shows live for the other person', await until(avery.page, () => document.querySelector('#property-status')?.textContent?.includes('In Progress')))
  check('the status change is logged with who did it', await until(avery.page, () => [...document.querySelectorAll('#activity [data-kind="status"]')].some(item => item.textContent.includes('Morgan Vale changed status from Todo to In Progress'))))
  await avery.page.locator('#issue-title').blur()
  await avery.page.locator('body').click({ position: { x: 700, y: 820 } })
  await avery.page.keyboard.press('a')
  await until(avery.page, () => document.activeElement?.id === 'picker-input')
  await avery.page.keyboard.type('morgan', { delay: 10 })
  await settle(avery.page)
  await avery.page.keyboard.press('Enter')
  check('a assigns from the keyboard; the other page shows it', await until(morgan.page, () => document.querySelector('#property-assignee')?.textContent?.includes('Morgan Vale')))

  // Comments.
  await avery.page.locator('#comment-submit').click()
  check('an empty comment is refused', await until(avery.page, () => document.querySelector('#comment-error')?.textContent?.includes('Write something')))
  await avery.page.locator('#comment-input').pressSequentially('Repro on staging with a Visa test card.', { delay: 5 })
  await avery.page.locator('#comment-input').press('Control+Enter')
  check("a comment shows on the other person's page", await until(morgan.page, () => document.querySelector('#activity')?.textContent?.includes('Repro on staging with a Visa test card.')))
  check('the comment box is cleared after posting', await until(avery.page, () => document.querySelector('#comment-input')?.value === ''))

  // Live list: a change on the issue page moves the row on the other person's list.
  await visit(morgan.page, '/project/ORB')
  // Shortcuts are off while typing in a field (Foldkit's keyBindings default).
  await avery.page.locator('#comment-input').blur()
  await avery.page.keyboard.press('s')
  await until(avery.page, () => document.activeElement?.id === 'picker-input')
  await avery.page.keyboard.press('5')
  check('a status set with a number key moves the row live in the other list', await until(morgan.page, id => document.querySelector(`#group-done #row-${id}`) !== null, created))

  // KEYBOARD ON THE LIST
  await visit(avery.page, '/project/ORB')
  await avery.page.keyboard.press('j')
  await avery.page.keyboard.press('j')
  const selected = await avery.page.evaluate(() => new Promise(resolve => setTimeout(() => resolve(document.querySelector('[data-selected="true"]')?.id.slice(4)), 400)))
  const order = await rowsText(avery.page)
  check('j/k moves the selection', selected === order[1], `${selected}`)
  await avery.page.keyboard.press('k')
  check('k moves it back', await until(avery.page, id => document.querySelector('[data-selected="true"]')?.id === `row-${id}`, order[0]))
  await avery.page.keyboard.press('p')
  await until(avery.page, () => document.activeElement?.id === 'picker-input')
  await avery.page.keyboard.press('4')
  check('p sets the priority of the selected issue', await until(avery.page, id => document.querySelector(`#row-${id} [aria-label="Priority: Low"]`) !== null, order[0]))
  await avery.page.keyboard.press('/')
  check('/ focuses the search', await until(avery.page, () => document.activeElement?.id === 'search'))
  await avery.page.keyboard.press('Escape')
  await avery.page.locator('#search').blur()
  await avery.page.keyboard.press('Control+k')
  check('Ctrl+K opens the command palette', await until(avery.page, () => document.querySelector('#picker[data-field="command"]') !== null && document.activeElement?.id === 'picker-input'))
  await avery.page.keyboard.type('board layout', { delay: 10 })
  await settle(avery.page)
  await avery.page.keyboard.press('Enter')
  check('the palette runs a command (switch to board)', await until(avery.page, () => document.querySelector('#column-todo') !== null && location.search.includes('view=board')))

  // BOARD
  await visit(morgan.page, '/project/ORB?view=board')
  const card = await avery.page.evaluate(() => document.querySelector('#column-todo [id^="row-"]')?.id.slice(4))
  await avery.page.locator(`#row-${card} [aria-label^="Status"]`).click()
  await until(avery.page, () => document.activeElement?.id === 'picker-input')
  await avery.page.getByRole('option', { name: 'In Review' }).click()
  check('moving a card to another column (status menu)', await until(avery.page, id => document.querySelector(`#column-in_review #row-${id}`) !== null, card))
  check("the card moves on the other person's board", await until(morgan.page, id => document.querySelector(`#column-in_review #row-${id}`) !== null, card))

  // Drag and drop (native HTML5 drag events, bound on the server).
  const dragged = await avery.page.evaluate(() => document.querySelector('#column-backlog [id^="row-"]')?.id.slice(4))
  await avery.page.locator(`#row-${dragged}`).dragTo(avery.page.locator('#column-todo'))
  check('dragging a card onto another column moves it', await until(avery.page, id => document.querySelector(`#column-todo #row-${id}`) !== null, dragged), dragged)
  check("the dragged card moves on the other person's board", await until(morgan.page, id => document.querySelector(`#column-todo #row-${id}`) !== null, dragged))

  // Enter opens the selected issue.
  await visit(avery.page, '/project/ORB')
  await avery.page.keyboard.press('j')
  await until(avery.page, () => document.querySelector('[data-selected="true"]') !== null)
  const toOpen = await avery.page.evaluate(() => document.querySelector('[data-selected="true"]')?.id.slice(4))
  await avery.page.keyboard.press('Enter')
  check('Enter opens the selected issue', await avery.page.waitForURL(`**/issue/${toOpen}`, { timeout: TIMEOUT }).then(() => true, () => false))
  await avery.page.waitForFunction(() => document.querySelector('#hyper-keys[data-hyper-keys]') !== null)
  await settle(avery.page)
  await avery.page.keyboard.press('Escape')
  check('Esc on an issue goes back to its list', await avery.page.waitForURL('**/project/ORB', { timeout: TIMEOUT }).then(() => true, () => false))

  // j moves the selection in the page itself (a local effect), before the
  // server has seen the key; the server then agrees.
  await avery.page.waitForFunction(() => document.querySelector('#hyper-keys[data-hyper-keys]') !== null)
  await settle(avery.page)
  const moved = await avery.page.evaluate(() => {
    const before = document.querySelector('#issue-list [data-selected="true"]')?.id
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
    const after = document.querySelector('#issue-list [data-selected="true"]')?.id
    return after !== undefined && after !== before ? after : undefined
  })
  check('j moves the selection before the server answers', moved !== undefined)
  await settle(avery.page)
  check('the server agrees with the moved selection', await avery.page.evaluate(id => document.querySelector('#issue-list [data-selected="true"]')?.id === id, moved))

  // ? opens the shortcuts dialog: a styled crease dialog whose ShowDialog
  // runs in the page and replies to the server.
  await avery.page.focus('#layout-list')
  await avery.page.keyboard.press('Shift+?')
  check('? opens the styled shortcuts dialog with focus inside', await until(avery.page, () => document.querySelector('#shortcuts-help')?.open === true && document.activeElement?.closest('#shortcuts-help') != null))
  check('the rest of the page is inert while it is open', await avery.page.evaluate(() => document.querySelector('#issue-list')?.closest('[inert]') != null))
  await avery.page.keyboard.press('Escape')
  check('Esc closes it and the page is usable again', await until(avery.page, () => document.querySelector('#shortcuts-help')?.open === false && document.querySelector('[inert]') === null))
  check('focus returns to what had it before the dialog opened', await until(avery.page, () => document.activeElement?.id === 'layout-list'))

  // The ⋯ menu (crease dropdown-menu, activateOnHover: false): hover is CSS,
  // so moving over its items sends nothing; choosing an item works.
  await visit(avery.page, `/issue/${toOpen}`)
  await avery.page.getByRole('button', { name: 'Issue actions' }).click()
  await avery.page.getByRole('menuitem', { name: 'Back to list' }).waitFor({ timeout: TIMEOUT })
  let hoverPosts = 0
  const countPost = request => {
    if (request.method() === 'POST') hoverPosts += 1
  }
  avery.page.on('request', countPost)
  for (const name of ['Back to list', 'Delete issue', 'Back to list']) await avery.page.getByRole('menuitem', { name }).hover()
  await avery.page.waitForTimeout(200)
  avery.page.off('request', countPost)
  check('hovering the menu items sends no requests', hoverPosts === 0, `${hoverPosts} posts`)
  await avery.page.keyboard.press('Escape')
  check('Esc closes the menu and focus returns to its trigger', await until(avery.page, () => document.querySelector('[role="menu"]') === null && document.activeElement?.getAttribute('aria-label') === 'Issue actions'))
  await avery.page.getByRole('button', { name: 'Issue actions' }).click()
  await avery.page.getByRole('menuitem', { name: 'Back to list' }).waitFor({ timeout: TIMEOUT })
  await avery.page.getByRole('menuitem', { name: 'Back to list' }).click()
  check('a menu item chosen with the pointer works', await avery.page.waitForURL('**/project/ORB', { timeout: TIMEOUT }).then(() => true, () => false))

  // SIGN-IN: a wrong password is refused.
  {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${base}/project/ORB`)
    await page.getByLabel('Email').fill('afinch')
    await page.getByLabel('Password').fill('not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    check('a wrong password is refused', (await page.locator('#login-error').count()) === 1 && page.url().includes('/login'))
    await context.close()
  }

  // PROJECTS: a new project through its dialog, like the new-issue dialog.
  const projectKey = `T${String(Date.now() % 10000).padStart(4, '0')}`
  await visit(morgan.page, '/my-issues')
  await visit(avery.page, '/project/ORB')
  await avery.page.locator('#create-project').click()
  check('+ opens the new project dialog with the name focused', await until(avery.page, () => document.activeElement?.id === 'project-name'))
  await avery.page.locator('#project-name').pressSequentially('Check Project', { delay: 10 })
  check('the key follows the name', await until(avery.page, () => document.querySelector('#project-key')?.value === 'CP'))
  await avery.page.locator('#project-key').fill('x')
  await avery.page.locator('#project-submit').click()
  check('an invalid key is refused', await until(avery.page, () => document.querySelector('#project-key-error') !== null))
  await avery.page.locator('#project-key').fill(projectKey)
  await settle(avery.page)
  await avery.page.keyboard.press('Control+Enter')
  check(`creating the project opens its list (${projectKey})`, await avery.page.waitForURL(`**/project/${projectKey}`, { timeout: TIMEOUT }).then(() => true, () => false))
  check('the new project is among my projects', await until(avery.page, key => document.querySelector(`#sidebar [data-project="${key}"]`) !== null, projectKey))
  check('the new project is empty', await until(avery.page, () => document.querySelector('#issue-list')?.textContent?.includes('No issues here')))

  // MEMBERS: the third layout; add an existing account, then a new one.
  await avery.page.waitForFunction(() => document.querySelector('#hyper-keys[data-hyper-keys]') !== null)
  await avery.page.locator('#layout-members').click()
  check('Members shows the project: only its creator', await until(avery.page, () => document.querySelectorAll('#member-board li').length === 1 && document.querySelector('#member-avery') !== null))
  check('the members layout is in the URL', await avery.page.waitForURL('**view=members', { timeout: TIMEOUT }).then(() => true, () => false))
  check('Morgan does not have the project yet', (await morgan.page.locator(`#sidebar [data-project="${projectKey}"]`).count()) === 0)
  await avery.page.locator('#add-member').click()
  check('Add member opens on the organisation list, search focused', await until(avery.page, () => document.activeElement?.id === 'member-query' && document.querySelectorAll('#member-picks [role="checkbox"]').length === 16))
  await avery.page.locator('#member-query').pressSequentially('vale', { delay: 10 })
  check('the search narrows the list', await until(avery.page, () => document.querySelectorAll('#member-picks [role="checkbox"]').length === 1))
  await avery.page.locator('#member-pick-morgan').click()
  await avery.page.locator('#member-query').fill('')
  await until(avery.page, () => document.querySelectorAll('#member-picks [role="checkbox"]').length === 16)
  await avery.page.locator('#member-pick-riley').click()
  check('several people are ticked', await until(avery.page, () =>
    document.querySelector('#member-pick-morgan')?.getAttribute('aria-checked') === 'true' &&
    document.querySelector('#member-pick-riley')?.getAttribute('aria-checked') === 'true' &&
    document.querySelector('#member-submit')?.textContent?.includes('Add 2 members')))
  await avery.page.locator('#member-submit').click()
  check('both join the project', await until(avery.page, () => document.querySelector('#member-morgan') !== null && document.querySelector('#member-riley') !== null && document.querySelectorAll('#member-board li').length === 3))
  check('the toast names them', await until(avery.page, () => document.querySelector('#toast')?.textContent?.includes('Added Morgan Vale, Riley Quinn')))
  check('it reaches the other person live: the project is in their sidebar', await until(morgan.page, key => document.querySelector(`#sidebar [data-project="${key}"]`) !== null, projectKey))
  await avery.page.locator('#add-member').click()
  check('people already in the project are not offered again', await until(avery.page, () => document.querySelectorAll('#member-picks [role="checkbox"]').length === 14 && document.querySelector('#member-pick-morgan') === null))

  const newEmail = `check${projectKey.toLowerCase()}@hypernotes.example`
  await avery.page.locator('#member-mode-new').click()
  check('New account switches to the account form', await until(avery.page, () => document.activeElement?.id === 'member-name'))
  await avery.page.locator('#member-name').pressSequentially('Check Person', { delay: 5 })
  await avery.page.locator('#member-email').pressSequentially(newEmail, { delay: 5 })
  await avery.page.locator('#member-password').pressSequentially('short', { delay: 5 })
  await avery.page.locator('#member-submit').click()
  check('a short password is refused', await until(avery.page, () => document.querySelector('#member-password-error')?.textContent?.includes('at least')))
  await avery.page.locator('#member-password').fill('check-password-1')
  await settle(avery.page)
  await avery.page.locator('#member-submit').click()
  check('a new account is created and added', await until(avery.page, email => [...document.querySelectorAll('#member-board li')].some(card => card.dataset.email === email), newEmail))
  check('the dialog closes with a confirmation', await until(avery.page, () => document.querySelector('#add-member-dialog') === null && document.querySelector('#toast')?.textContent?.includes('Created an account')))
  const newcomer = await signIn('Check Person', `/project/${projectKey}`, newEmail, 'check-password-1')
  check('the new account can sign in and sees its project', await until(newcomer.page, key => document.querySelector(`#sidebar [data-project="${key}"]`) !== null, projectKey))

  // Back to the list for the theme check.
  await visit(avery.page, '/project/ORB')

  // OVERVIEW: every project as a card; About: the description and the
  // properties, edited in place, reaching the other person's Overview live.
  await visit(morgan.page, '/project/ORB')
  await morgan.page.locator('#sidebar a[href="/overview"]').click()
  await morgan.page.waitForURL('**/overview', { timeout: TIMEOUT })
  check('the sidebar opens the Overview without the issue filter', await until(morgan.page, () => document.querySelector('#project-cards') !== null && document.querySelector('#filter-button') === null))
  check('the Overview lists the projects as cards', await until(morgan.page, () => document.querySelector('#card-ORB') !== null && document.querySelector('#card-PRS') !== null))
  check('a card lists the most important open issues', await until(morgan.page, () => document.querySelectorAll('#card-ORB [data-issue]').length >= 4))
  check('a card shows the progress', await until(morgan.page, () => /^\d+\/\d+$/.test(document.querySelector('#card-ORB [data-progress]')?.getAttribute('data-progress') ?? '')))
  await visit(avery.page, '/project/ORB?view=about')
  check('About shows the description and the properties', await until(avery.page, () => document.querySelector('#about-description') !== null && document.querySelector('#about-priority') !== null))
  const note = `Ziele der Prüfung ${Date.now() % 100000}`
  await avery.page.locator('#about-description').click()
  await avery.page.keyboard.press('Control+A')
  await avery.page.keyboard.type(note, { delay: 5 })
  await avery.page.locator('#about-name').click()
  check('the description is saved on blur and shows on the other Overview live', await until(morgan.page, text => document.querySelector('#card-ORB')?.textContent?.includes(text), note))
  await avery.page.locator('#about-priority').click()
  await until(avery.page, () => document.activeElement?.id === 'picker-input')
  await avery.page.keyboard.type('urgent', { delay: 10 })
  await avery.page.keyboard.press('Enter')
  check('a priority set on About shows on the card', await until(morgan.page, () => document.querySelector('#card-ORB [data-priority]')?.getAttribute('data-priority') === '1'))
  await avery.page.locator('#about-state').click()
  await until(avery.page, () => document.activeElement?.id === 'picker-input')
  await avery.page.keyboard.type('hold', { delay: 10 })
  await avery.page.keyboard.press('Enter')
  check('a project put on hold shows so on the card', await until(morgan.page, () => document.querySelector('#card-ORB')?.getAttribute('data-state') === 'paused'))
  await morgan.page.locator('#overview-filter-active').click()
  check('the Active filter leaves out projects on hold', await until(morgan.page, () => document.querySelector('#card-ORB') === null && document.querySelector('#card-PRS') !== null))
  await morgan.page.locator('#overview-filter-current').click()
  await avery.page.locator('#about-state').click()
  await until(avery.page, () => document.activeElement?.id === 'picker-input')
  await avery.page.keyboard.type('active', { delay: 10 })
  await avery.page.keyboard.press('Enter')
  check('back to active', await until(morgan.page, () => document.querySelector('#card-ORB')?.getAttribute('data-state') === 'active'))
  await morgan.page.goto(`${base}/team/ORB`)
  check('old /team links lead to the project', morgan.page.url().endsWith('/project/ORB'))

  // SIDEBAR: one row per project, no sub-items; a project link keeps the view.
  await visit(avery.page, '/project/ORB?view=board')
  check('the sidebar lists projects without sub-items', await until(avery.page, () => document.querySelectorAll('#sidebar a[href^="/project/ORB"]').length === 1))
  check('a project link keeps the board', await until(avery.page, () => document.querySelector('#sidebar [data-project="PRS"]')?.getAttribute('href') === '/project/PRS?view=board'))
  await avery.page.locator('#sidebar [data-project="PRS"]').click()
  check('switching projects stays on the board', await avery.page.waitForURL('**/project/PRS?view=board', { timeout: TIMEOUT }).then(() => true, () => false) && await until(avery.page, () => document.querySelector('#issue-list')?.getAttribute('aria-label') === 'Board'))
  check('the open project is marked', await until(avery.page, () => document.querySelector('#sidebar [data-project="PRS"]')?.getAttribute('aria-current') === 'page'))
  await visit(avery.page, '/project/ORB/chat')
  check('from a chat, the other project opens its chat', await until(avery.page, () => document.querySelector('#sidebar [data-project="PRS"]')?.getAttribute('href') === '/project/PRS/chat'))

  // DOCS: a page per project, written in the Notion-like editor (an island),
  // live for the other person, read-only for people outside the project.
  await visit(avery.page, '/project/ORB?view=docs')
  check('Docs lists the project pages (none yet)', await until(avery.page, () => document.querySelector('#doc-count')?.textContent === '0'))
  await avery.page.locator('#new-doc').click()
  check('New page opens it in the editor', await avery.page.waitForURL('**/doc/**', { timeout: TIMEOUT }).then(() => true, () => false) && await avery.page.waitForSelector('.ProseMirror', { timeout: 15000 }).then(() => true, () => false))
  const docUrl = avery.page.url()
  await avery.page.locator('#doc-title-input').fill('Check-Seite')
  await avery.page.locator('.ProseMirror').click()
  check('the title is saved when leaving it', await until(avery.page, () => document.querySelector('#doc-tree [aria-current="page"]')?.textContent === 'Check-Seite'))
  await avery.page.keyboard.type('/to-do', { delay: 20 })
  check('"/" opens the block menu', await until(avery.page, () => document.querySelector('.doc-menu .doc-menu-item')?.textContent?.startsWith('To-do list')))
  await avery.page.keyboard.press('Enter')
  await avery.page.keyboard.type('Zugang beantragen', { delay: 10 })
  await avery.page.waitForTimeout(1200)
  const florianDoc = morgan.page
  {
    const stream = florianDoc.waitForRequest(request => request.url().includes('/stream'))
    await florianDoc.goto(docUrl)
    await stream
  }
  check('the other member sees the saved page', await florianDoc.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent?.includes('Zugang beantragen') && document.querySelector('.ProseMirror input[type="checkbox"]') !== null, null, { timeout: 15000 }).then(() => true, () => false))
  await avery.page.keyboard.press('Enter')
  await avery.page.keyboard.type('Termin vereinbaren', { delay: 10 })
  check('a later edit reaches them live', await florianDoc.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent?.includes('Termin vereinbaren'), null, { timeout: 15000 }).then(() => true, () => false))
  {
    const stream = newcomer.page.waitForRequest(request => request.url().includes('/stream'))
    await newcomer.page.goto(docUrl)
    await stream
  }
  check('someone outside the project reads it, without the editor', await until(newcomer.page, () => document.querySelector('#doc-read')?.textContent?.includes('Termin vereinbaren') && document.querySelector('.ProseMirror') === null && document.querySelector('#delete-doc') === null))
  await visit(avery.page, '/project/ORB?view=docs')
  check('the page is in the project docs', await until(avery.page, () => document.querySelector('#doc-list')?.textContent?.includes('Check-Seite')))

  // SCROLL: following a link in the sidebar or the doc tree loads another
  // page; both stay where they were scrolled to (public/keep-scroll.js).
  const scrollOf = (page, selector) => page.evaluate(selector => document.querySelector(selector)?.scrollTop ?? -1, selector)
  /** Scrolls a panel to its end with the wheel, follows the last of `links`, and returns the scroll positions before and after. */
  const followLastLink = async (page, panel, links) => {
    const box = await page.locator(panel).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 3000)
    await page.waitForTimeout(300)
    const before = await scrollOf(page, panel)
    const link = page.locator(links).last()
    const href = await link.getAttribute('href')
    // A new page opens a stream; a project link within the same page navigates in place.
    const stream = page.waitForRequest(request => request.url().includes('/stream'), { timeout: 3000 }).catch(() => undefined)
    await link.click()
    await page.waitForURL(url => url.pathname + url.search === href, { timeout: TIMEOUT })
    await stream
    await settle(page)
    return { before, after: await scrollOf(page, panel) }
  }
  await avery.page.setViewportSize({ width: 1440, height: 260 })
  await visit(avery.page, '/project/ORB')
  {
    const { before, after } = await followLastLink(avery.page, '[data-keep-scroll="sidebar"]', '[data-keep-scroll="sidebar"] a[data-project]')
    check('the sidebar keeps its scroll position on another page', before > 0 && Math.abs(after - before) <= 2, `${before} → ${after}`)
  }
  {
    const stream = avery.page.waitForRequest(request => request.url().includes('/stream'))
    await avery.page.goto(docUrl)
    await stream
    await settle(avery.page)
  }
  for (let added = 0; added < 15 && (await avery.page.evaluate(() => { const tree = document.querySelector('#doc-tree'); return tree.scrollHeight <= tree.clientHeight })); added++) {
    const stream = avery.page.waitForRequest(request => request.url().includes('/stream'))
    const from = avery.page.url()
    await avery.page.locator('#new-top-page').click()
    await avery.page.waitForURL(url => url.href !== from, { timeout: TIMEOUT })
    await stream
    await settle(avery.page)
  }
  {
    const { before, after } = await followLastLink(avery.page, '#doc-tree', '#doc-tree a[href^="/doc/"]:not([aria-current])')
    check('the doc tree keeps its scroll position on another page', before > 0 && Math.abs(after - before) <= 2, `${before} → ${after}`)
  }
  await avery.page.setViewportSize({ width: 1440, height: 900 })

  // CHAT: a chat per project, live for the other members (Enter sends,
  // Shift+Enter is a new line), unread counts in the sidebar, reactions and
  // edits; people outside the project read only.
  await visit(morgan.page, '/overview')
  await visit(avery.page, '/project/ORB')
  check('the project has Chat and Calendar tabs', await until(avery.page, () => document.querySelector('#tab-chat') !== null && document.querySelector('#tab-calendar') !== null))
  await avery.page.locator('#tab-chat').click()
  await avery.page.waitForURL('**/project/ORB/chat', { timeout: TIMEOUT })
  await avery.page.waitForFunction(() => document.querySelector('#hyper-keys[data-hyper-keys]') !== null)
  check('the chat opens empty', await until(avery.page, () => document.querySelector('#chat-empty') !== null))
  const chatText = `Hallo Morgan ${Date.now() % 100000}`
  await avery.page.locator('#chat-composer').click()
  await avery.page.keyboard.type(chatText, { delay: 5 })
  await avery.page.keyboard.press('Shift+Enter')
  await avery.page.keyboard.type('zweite Zeile', { delay: 5 })
  await avery.page.keyboard.press('Enter')
  check('Enter sends, Shift+Enter keeps a new line', await until(avery.page, text => [...document.querySelectorAll('#chat-list [data-message-text]')].some(node => node.innerText === `${text}\nzweite Zeile`), chatText))
  check('the box empties once sent', await until(avery.page, () => document.querySelector('#chat-composer')?.value === ''))
  check('the other member sees an unread message in the sidebar', await until(morgan.page, () => document.querySelector('#sidebar [data-project="ORB"] [data-unread="1"], #sidebar [data-unread="1"]') !== null))
  await visit(morgan.page, '/project/ORB/chat')
  check('they see the message in the chat', await until(morgan.page, text => document.querySelector('#chat-list')?.textContent?.includes(text), chatText))
  check('opening the chat reads it', await until(morgan.page, () => document.querySelector('#sidebar [data-unread]') === null && !/\d/.test(document.querySelector('#tab-chat')?.textContent ?? '')))
  const theirMessage = morgan.page.locator('#chat-list li[data-author="avery"]').first()
  await theirMessage.hover()
  await theirMessage.getByRole('button', { name: 'React with 👍' }).click()
  check('a reaction shows live for the author', await until(avery.page, () => [...document.querySelectorAll('#chat-list button[aria-label]')].some(button => button.getAttribute('aria-label')?.startsWith('👍 1'))))
  check('nobody but the author can edit', (await theirMessage.getByRole('button', { name: 'Edit message' }).count()) === 0)
  const ownMessage = avery.page.locator('#chat-list li[data-author="avery"]').first()
  await ownMessage.hover()
  await ownMessage.getByRole('button', { name: 'Edit message' }).click()
  check('editing focuses the message', await until(avery.page, () => document.activeElement?.id === 'chat-edit'))
  await avery.page.keyboard.press('Control+A')
  await avery.page.keyboard.type('Korrigiert: Review morgen', { delay: 5 })
  await avery.page.keyboard.press('Enter')
  check('an edit reaches the others live, marked as edited', await until(morgan.page, () => document.querySelector('#chat-list')?.textContent?.includes('Korrigiert: Review morgen') && document.querySelector('#chat-list')?.textContent?.includes('edited')))
  check('focus goes back to the box after an edit', await until(avery.page, () => document.activeElement?.id === 'chat-composer'))
  await visit(newcomer.page, '/project/ORB/chat')
  check('someone outside the project reads the chat without a box', await until(newcomer.page, () => document.querySelector('#chat-list')?.textContent?.includes('Korrigiert') && document.querySelector('#chat-readonly') !== null && document.querySelector('#chat-composer') === null))

  // CALENDAR: dates per project in a month, added in a dialog, live for the
  // others, read-only for people outside the project.
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())
  await visit(avery.page, '/project/ORB/calendar')
  await visit(morgan.page, '/project/ORB/calendar')
  check('the calendar shows this month with today marked', await until(avery.page, day => document.querySelector(`#day-${day}`) !== null && document.querySelector('#month-label')?.textContent !== '', today))
  await avery.page.locator('#new-event').click()
  check('New date opens the dialog on today', await until(avery.page, day => document.querySelector('#event-dialog') !== null && document.querySelector('#event-date')?.dataset.value === day, today))
  check('dates and times are crease pickers, no native inputs', await until(avery.page, () => document.querySelector('#event-dialog input[type="date"], #event-dialog input[type="time"]') === null && document.querySelector('#event-date[aria-haspopup="dialog"]') !== null && document.querySelector('#event-start[aria-haspopup="dialog"]') !== null))
  await avery.page.keyboard.press('Escape')
  check('Escape closes the dialog', await until(avery.page, () => document.querySelector('#event-dialog') === null))
  await avery.page.locator('#new-event').click()
  await until(avery.page, () => document.querySelector('#event-title') !== null)
  await avery.page.locator('#event-save').click()
  check('a date without a title is refused', await until(avery.page, () => document.querySelector('#event-title-error') !== null))
  await avery.page.locator('#event-title').fill('Abnahme Prüfung')
  await avery.page.locator('#event-kind-milestone').click()
  // The end date: the picker opens on this month, moves to the next, and
  // days before the start cannot be picked.
  await avery.page.locator('#event-end-date').click()
  check('the date picker opens on the month of the date', await until(avery.page, day => document.querySelector(`#event-end-date-panel [data-day="${day}"]`)?.closest('[role="gridcell"]')?.hasAttribute('data-today'), today))
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  check('days before the start are disabled', await until(avery.page, day => document.querySelector(`#event-end-date-day-${day}`)?.disabled !== false, yesterday))
  await avery.page.locator('#event-end-date-panel').getByRole('button', { name: 'Next month' }).click()
  const nextFirst = (() => {
    const [year, month] = today.split('-').map(Number)
    return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
  })()
  await until(avery.page, day => document.querySelector(`#event-end-date-day-${day}`) !== null && !document.querySelector(`#event-end-date-day-${day}`)?.closest('[data-outside-month]'), nextFirst)
  await avery.page.locator(`#event-end-date-day-${nextFirst}`).click()
  check('a picked day shows in the field and the picker closes', await until(avery.page, day => document.querySelector('#event-end-date')?.dataset.value === day && document.querySelector('#event-end-date-panel') === null, nextFirst))
  // The start time: an hour, then the minutes.
  await avery.page.locator('#event-start').click()
  await avery.page.locator('#event-start-hour-14').click()
  check('picking an hour keeps the time picker open', await until(avery.page, () => document.querySelector('#event-start')?.dataset.value === '14:00' && document.querySelector('#event-start-panel') !== null))
  await avery.page.locator('#event-start-minute-30').click()
  check('picking the minutes closes it', await until(avery.page, () => document.querySelector('#event-start')?.dataset.value === '14:30' && document.querySelector('#event-start-panel') === null))
  await avery.page.locator('#event-start').click()
  await until(avery.page, () => document.querySelector('#event-start-panel') !== null)
  await avery.page.keyboard.press('Escape')
  check('Escape closes the picker, not the dialog', await until(avery.page, () => document.querySelector('#event-start-panel') === null && document.querySelector('#event-dialog') !== null))
  // The end date again: Clear makes it a one-day date.
  await avery.page.locator('#event-end-date').click()
  await avery.page.locator('#event-end-date-clear').click()
  check('Clear empties an optional date', await until(avery.page, () => document.querySelector('#event-end-date')?.dataset.value === ''))
  await avery.page.locator('#event-save').click()
  check('the date is added and the dialog closes', await until(avery.page, () => document.querySelector('#event-dialog') === null))
  check('the other member sees it on its day, live', await until(morgan.page, day => document.querySelector(`#day-${day}`)?.textContent?.includes('14:30 Abnahme Prüfung'), today))
  check('it is under Coming up', await until(morgan.page, () => document.querySelector('#calendar-upcoming')?.textContent?.includes('Abnahme Prüfung')))
  await visit(newcomer.page, '/project/ORB/calendar')
  check('someone outside the project sees it, without New date', await until(newcomer.page, () => document.querySelector('#calendar-upcoming')?.textContent?.includes('Abnahme Prüfung') && document.querySelector('#new-event') === null))
  await newcomer.page.locator('#calendar-upcoming [data-upcoming]').first().click()
  check('and opens it read-only', await until(newcomer.page, () => document.querySelector('#event-dialog') !== null && document.querySelector('#event-save') === null))
  await avery.page.locator('#month-next').click()
  check('the next month shows', await until(avery.page, day => document.querySelector(`#day-${day}`) === null || document.querySelector(`#day-${day}`)?.classList.contains('bg-muted/40'), today))
  await avery.page.locator('#month-today').click()
  await avery.page.locator('#calendar-upcoming [data-upcoming]').first().click()
  await until(avery.page, () => document.querySelector('#event-delete') !== null)
  await avery.page.locator('#event-delete').click()
  await avery.page.locator('#event-confirm-delete').click()
  check('a deleted date goes for everyone', await until(morgan.page, () => !document.querySelector('#calendar-upcoming')?.textContent?.includes('Abnahme Prüfung')))

  // Theme (dark mode follows the person on every open page).
  await avery.page.waitForFunction(() => document.querySelector('#hyper-keys[data-hyper-keys]') !== null)
  await avery.page.locator('#theme-toggle').click()
  check('dark mode', await until(avery.page, () => document.querySelector('#app')?.classList.contains('dark')))
  await avery.page.locator('#theme-toggle').click()
  await until(avery.page, () => !document.querySelector('#app')?.classList.contains('dark'))

  // Settings: a theme preset follows the person onto every page, and back.
  await avery.page.locator('#settings-link').click()
  await avery.page.waitForURL(`${base}/settings`)
  await avery.page.waitForFunction(() => document.querySelector('#preset-nord') !== null)
  await avery.page.locator('#preset-nord').click()
  check('a theme preset is worn on the page root', await until(avery.page, () => document.querySelector('#app')?.classList.contains('theme-nord')))
  check('the preset card shows as chosen', await until(avery.page, () => document.querySelector('#preset-nord')?.getAttribute('aria-pressed') === 'true'))
  await avery.page.goto(`${base}/project/ORB`)
  check('other pages wear it too', await until(avery.page, () => document.querySelector('#app')?.classList.contains('theme-nord')))
  await avery.page.goto(`${base}/settings`)
  await avery.page.waitForFunction(() => document.querySelector('#preset-default') !== null)
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
