/* In a form marked data-enter-submits (the comment box), Enter in a textarea
   submits the form and Shift+Enter starts a new line, as in Notion.

   Server key handlers decide which keys to prevent by key alone, so they
   cannot tell Enter from Shift+Enter; this decides in the browser instead.
   Submitting goes through the form's own submit handler, which also carries
   the text typed so far. Loaded on the page route (main.ts). */

document.addEventListener('keydown', event => {
  const target = event.target
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !(target instanceof HTMLTextAreaElement)) return
  const form = target.closest('form[data-enter-submits]')
  if (form === null) return
  event.preventDefault()
  form.requestSubmit()
})
