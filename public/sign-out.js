/* Log out from the workspace menu: choosing it renders a POST /logout form
   (page.ts, isSigningOut), which this submits once it appears, whether the
   choice was a click or Enter. Loaded on the page route (main.ts). */

let isSent = false

const submit = () => {
  const form = document.querySelector('form[data-sign-out]')
  if (isSent || !(form instanceof HTMLFormElement)) return
  isSent = true
  form.submit()
}

new MutationObserver(submit).observe(document.documentElement, { childList: true, subtree: true })
