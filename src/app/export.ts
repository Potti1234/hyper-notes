import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'

import { signedInMemberId } from './auth'
import { exportFileName, pageMarkdown } from './markdown'
import { Workspace } from './store'
import { canSee } from './workspace'

/* GET /export/<page id>: the page as a Markdown download (••• → Export,
   public/export-page.js). Only for a signed-in member who can see the page. */

export const routes = HttpRouter.add(
  'GET',
  '/export/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const memberId = signedInMemberId(request.cookies)
    if (memberId === undefined) return HttpServerResponse.empty({ status: 401 })
    const pageId = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice('/export/'.length))
    const state = yield* Workspace.use(workspace => workspace.current)
    const page = state.pages.find(entry => entry.id === pageId)
    if (state.members.every(member => member.id !== memberId) || page === undefined || !canSee(page, memberId)) return HttpServerResponse.empty({ status: 404 })
    return HttpServerResponse.text(pageMarkdown(state, page, memberId), {
      contentType: 'text/markdown; charset=utf-8',
      headers: {
        'content-disposition': `attachment; filename="${exportFileName(page).replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(exportFileName(page))}`,
        'cache-control': 'no-store',
      },
    })
  }),
)

export const layer = Layer.mergeAll(routes)
