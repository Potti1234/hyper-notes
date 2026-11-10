// "Copy link" in a page menu: the clipboard only takes writes during the
// click itself, so the address is written here; the server shows the notice.
document.addEventListener('click', event => {
  const item = event.target instanceof Element ? event.target.closest('[data-value="copylink"]') : null
  const pageId = item?.closest('#picker')?.getAttribute('data-picker-page')
  if (!pageId || !navigator.clipboard) return
  void navigator.clipboard.writeText(`${location.origin}/p/${pageId}`).catch(() => {})
}, true)
