/* Copy link: the clipboard can only be written in the browser, during the
   person's click or key press, so this does it there.
   - "Copy link" in a page menu (#picker, data-picker-page) copies that page;
     the server shows the notice when it receives the choice.
   - Ctrl+L (⌘L) copies the open page (#page-body data-copy-link) and tells
     the server with a `hypercopylink` event (page.ts, OnCustomEvent).
   Loaded on the page route (main.ts). */

const linkTo = pageId => `${location.origin}/p/${pageId}`

document.addEventListener('click', event => {
  const item = event.target instanceof Element ? event.target.closest('[data-value="copylink"]') : null
  const pageId = item?.closest('#picker')?.getAttribute('data-picker-page')
  if (!pageId || !navigator.clipboard) return
  void navigator.clipboard.writeText(linkTo(pageId)).catch(() => {})
}, true)

document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() !== 'l' || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
  const body = document.querySelector('#page-body[data-copy-link]')
  const pageId = body?.getAttribute('data-copy-link')
  if (!pageId || !navigator.clipboard) return
  event.preventDefault()
  void navigator.clipboard.writeText(linkTo(pageId)).then(() => body.dispatchEvent(new CustomEvent('hypercopylink', { bubbles: true })), () => {})
}, true)
