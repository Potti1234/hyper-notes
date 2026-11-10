/* Dragging the sidebar's edge (data-resize-sidebar) resizes it in the
   browser while the pointer moves, then posts the width once as a
   `hypersidebar` event, which the sidebar sends to the server (shell.ts,
   OnCustomEvent). The saved width comes back with the next render.
   Loaded on the page route (main.ts). */

const MIN = 200
const MAX = 480
let drag = null

document.addEventListener('pointerdown', event => {
  const handle = event.target instanceof Element ? event.target.closest('[data-resize-sidebar]') : null
  const sidebar = handle?.closest('#sidebar')
  if (event.button !== 0 || !handle || !sidebar) return
  event.preventDefault()
  drag = { sidebar, startX: event.clientX, startWidth: sidebar.getBoundingClientRect().width, width: null }
  document.body.style.cursor = 'col-resize'
})

document.addEventListener('pointermove', event => {
  if (drag === null) return
  drag.width = Math.round(Math.min(MAX, Math.max(MIN, drag.startWidth + event.clientX - drag.startX)))
  drag.sidebar.style.width = `${drag.width}px`
})

const end = () => {
  if (drag === null) return
  const { sidebar, width } = drag
  drag = null
  document.body.style.cursor = ''
  if (width !== null) sidebar.dispatchEvent(new CustomEvent('hypersidebar', { bubbles: true, detail: { width } }))
}
document.addEventListener('pointerup', end)
document.addEventListener('pointercancel', end)
