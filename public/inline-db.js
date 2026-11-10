// Inline databases are their own page (/p/<id>?embed=1) in a frame. Inside the
// frame this reports the database's height to the page around it, which sizes
// the frame to fit; when the frame leaves the embed (a row opened as a page),
// the whole window goes there instead.
(() => {
  const TYPE = 'hypernotes:inline-db-height'
  const isFramed = window.parent !== window && new URLSearchParams(location.search).get('embed') === '1'
  if (isFramed) {
    let observed = null
    let last = 0
    const report = () => {
      const body = document.querySelector('[data-embed-body]')
      const height = body === null ? 0 : Math.ceil(body.getBoundingClientRect().height)
      if (height === last) return
      last = height
      window.parent.postMessage({ type: TYPE, height }, location.origin)
    }
    const sizes = new ResizeObserver(report)
    const watch = () => {
      const body = document.querySelector('[data-embed-body]')
      if (body !== observed) {
        if (observed !== null) sizes.unobserve(observed)
        if (body !== null) sizes.observe(body)
        observed = body
      }
      report()
    }
    new MutationObserver(watch).observe(document.documentElement, { childList: true, subtree: true })
    watch()
    // Links out of the database (a row opened as a page) open in the window, not the frame.
    document.addEventListener('click', event => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (link === null || link.target === '_blank' || event.defaultPrevented) return
      const url = new URL(link.href, location.href)
      if (url.origin !== location.origin || url.searchParams.get('embed') === '1') return
      event.preventDefault()
      event.stopImmediatePropagation()
      window.top.location.assign(url.href)
    }, true)
    return
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.type !== TYPE) return
    const height = Number(event.data.height)
    if (!Number.isFinite(height)) return
    for (const frame of document.querySelectorAll('iframe[data-inline-db]')) {
      if (frame.contentWindow === event.source) frame.style.height = `${Math.min(Math.max(height, 120), 5000)}px`
    }
  })
  document.addEventListener('load', event => {
    const frame = event.target
    if (!(frame instanceof HTMLIFrameElement) || !frame.matches('[data-inline-db]')) return
    try {
      const url = new URL(frame.contentWindow.location.href)
      if (url.origin === location.origin && url.searchParams.get('embed') !== '1') location.assign(url.href)
    } catch {
      // A frame on another origin is not one of ours.
    }
  }, true)
})()
