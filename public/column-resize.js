/* Dragging a database column's edge (data-resize-column) resizes the column
   in the browser while the pointer moves, then posts the width once as a
   `hyperresize` event, which the table sends to the server (database-view.ts,
   OnCustomEvent). The saved width comes back with the next render.
   Loaded on the page route (main.ts). */

const MIN = 80
const MAX = 800
let drag = null

document.addEventListener('pointerdown', event => {
  const handle = event.target instanceof Element ? event.target.closest('[data-resize-column]') : null
  const cell = handle?.closest('[data-column]')
  const table = handle?.closest('[role="table"]')
  if (event.button !== 0 || !handle || !cell || !table) return
  event.preventDefault()
  drag = { id: handle.getAttribute('data-resize-column'), table, startX: event.clientX, startWidth: cell.getBoundingClientRect().width, width: null }
})

document.addEventListener('pointermove', event => {
  if (drag === null) return
  drag.width = Math.round(Math.min(MAX, Math.max(MIN, drag.startWidth + event.clientX - drag.startX)))
  for (const cell of drag.table.querySelectorAll(`[data-column="${CSS.escape(drag.id)}"]`)) cell.style.width = `${drag.width}px`
})

const end = () => {
  if (drag === null) return
  const { id, table, width } = drag
  drag = null
  if (width !== null) table.dispatchEvent(new CustomEvent('hyperresize', { bubbles: true, detail: { propertyId: id, width } }))
}
document.addEventListener('pointerup', end)
document.addEventListener('pointercancel', end)
