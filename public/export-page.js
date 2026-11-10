/* ••• → Export: downloads the page as Markdown from /export/<id> (export.ts).
   A download has to start from the person's click, so it starts here; the
   server only closes the menu. Loaded on the page route (main.ts). */

document.addEventListener('click', event => {
  const item = event.target instanceof Element ? event.target.closest('[data-value="export"]') : null
  const pageId = item?.closest('#picker[data-field="options"]')?.getAttribute('data-picker-page')
  if (!pageId) return
  const link = document.createElement('a')
  link.href = `/export/${encodeURIComponent(pageId)}`
  link.download = ''
  document.body.append(link)
  link.click()
  link.remove()
}, true)
