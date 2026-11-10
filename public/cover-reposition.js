/* While an image cover is being repositioned (data-reposition-cover),
   dragging it moves the image up or down in the browser, then posts the
   position once as a `hypercover` event, which the cover sends to the
   server (header.ts, OnCustomEvent). "Save position" saves it.
   Loaded on the page route (main.ts). */

let drag = null

const clamp = position => Math.round(Math.min(100, Math.max(0, position)))

document.addEventListener('pointerdown', event => {
  const cover = event.target instanceof Element ? event.target.closest('[data-reposition-cover]') : null
  if (event.button !== 0 || !cover || event.target.closest('button')) return
  event.preventDefault()
  const start = Number(cover.getAttribute('data-cover-position'))
  drag = { cover, startY: event.clientY, start: Number.isFinite(start) ? start : 50, height: cover.getBoundingClientRect().height || 1, position: null }
})

document.addEventListener('pointermove', event => {
  if (drag === null) return
  drag.position = clamp(drag.start - ((event.clientY - drag.startY) / drag.height) * 100)
  drag.cover.style.backgroundPositionY = `${drag.position}%`
})

const end = () => {
  if (drag === null) return
  const { cover, position } = drag
  drag = null
  if (position !== null) cover.dispatchEvent(new CustomEvent('hypercover', { bubbles: true, detail: { position } }))
}
document.addEventListener('pointerup', end)
document.addEventListener('pointercancel', end)
