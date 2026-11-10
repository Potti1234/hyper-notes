import { NodeHttpServer, NodeRuntime, NodeServices } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerResponse, HttpStaticServer } from 'effect/http'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

import * as Hyper from '@hyper-effect/core'

import * as Auth from '@/app/auth'
import * as Export from '@/app/export'
import * as NotePage from '@/app/page/page'
import * as Postgres from '@/app/postgres'
import * as SettingsPage from '@/app/settings/page'
import { Viewers } from '@/app/store'

/* The server: one hyper-effect layer per page, plain routes for sign-in and
   static files, the workspace in Postgres, and session snapshots there too
   (open pages carry on across restarts).

   Environment:
   - PORT (default 4300)
   - DATABASE_URL (default: the development database of `npm run db:up`,
     postgres://hypernotes:hypernotes-dev@localhost:5436/hypernotes)
   - APP_SECRET signs the sign-in cookie; HYPER_SNAPSHOT_SECRET seals session
     snapshots. Both have development values in the source: set them
     everywhere else.
 */

const port = Number(process.env['PORT'] ?? 4300)
const publicFile = (path: string) => fileURLToPath(new URL(`../public/${path}`, import.meta.url))

const page: Hyper.Options = {
  stylesheets: ['/styles.css'],
  scripts: ['/keep-scroll.js'],
  principal: Auth.principal,
  // Covers and image blocks embed https images from anywhere, as in Notion.
  // Inline databases frame their own page (/p/<id>?embed=1).
  contentSecurityPolicy: { directives: { 'img-src': ['https:'], 'frame-src': ["'self'"] } },
  snapshotSecret: Hyper.secretFromEnvironment('HYPER_SNAPSHOT_SECRET', 'dev-snapshot-secret, set HYPER_SNAPSHOT_SECRET'),
}

/** hyper-effect forbids all framing; inline databases frame the app's own pages, so allow the same origin (only). */
const SameOriginFrames = HttpRouter.middleware(app => Effect.map(app, response => {
  const policy = response.headers['content-security-policy']
  return policy === undefined ? response : HttpServerResponse.setHeader(response, 'content-security-policy', policy.replace("frame-ancestors 'none'", "frame-ancestors 'self'"))
}), { global: true })

const Routes = Layer.mergeAll(
  // The page route loads the islands bundle (the editor) and accepts whole documents.
  Hyper.layer(NotePage.program, {
    ...page,
    path: '/p/:id',
    paths: ['/'],
    scripts: ['/keep-scroll.js', '/enter-submits.js', '/column-resize.js', '/sidebar-resize.js', '/copy-link.js', '/cover-reposition.js', '/export-page.js', '/sign-out.js', '/inline-db.js', '/assets/islands.js'],
    prefetch: ['/p/*'],
    limits: { maxBodyBytes: 2 * 1024 * 1024 },
  }),
  Hyper.layer(SettingsPage.program, { ...page, path: '/settings' }),
  Auth.routes,
  Export.layer,
  HttpRouter.add('GET', '/favicon.ico', HttpServerResponse.file(publicFile('favicon.svg'), { contentType: 'image/svg+xml' })),
  HttpRouter.add('GET', '/favicon.svg', HttpServerResponse.file(publicFile('favicon.svg'), { contentType: 'image/svg+xml' })),
  HttpRouter.add('GET', '/styles.css', HttpServerResponse.file(publicFile('styles.css'), { contentType: 'text/css' })),
  HttpRouter.add('GET', '/keep-scroll.js', HttpServerResponse.file(publicFile('keep-scroll.js'), { contentType: 'text/javascript' })),
  HttpRouter.add('GET', '/enter-submits.js', HttpServerResponse.file(publicFile('enter-submits.js'), { contentType: 'text/javascript' })),
  HttpRouter.add('GET', '/column-resize.js', HttpServerResponse.file(publicFile('column-resize.js'), { contentType: 'text/javascript' })),
  HttpRouter.add('GET', '/sidebar-resize.js', HttpServerResponse.file(publicFile('sidebar-resize.js'), { contentType: 'text/javascript' })),
  HttpRouter.add('GET', '/cover-reposition.js', HttpServerResponse.file(publicFile('cover-reposition.js'), { contentType: 'text/javascript' })),
  HttpRouter.add('GET', '/export-page.js', HttpServerResponse.file(publicFile('export-page.js'), { contentType: 'text/javascript' })),
  HttpRouter.add('GET', '/sign-out.js', HttpServerResponse.file(publicFile('sign-out.js'), { contentType: 'text/javascript' })),
  HttpRouter.add('GET', '/inline-db.js', HttpServerResponse.file(publicFile('inline-db.js'), { contentType: 'text/javascript' })),
  HttpRouter.add('GET', '/copy-link.js', HttpServerResponse.file(publicFile('copy-link.js'), { contentType: 'text/javascript' })),
  HttpStaticServer.layer({ root: publicFile('assets'), prefix: '/assets' }),
  HttpStaticServer.layer({ root: publicFile('fonts'), prefix: '/fonts' }),
)

HttpRouter.serve(Layer.mergeAll(Routes, SameOriginFrames)).pipe(
  Layer.provide([Viewers.layer, Hyper.sqlStore()]),
  Layer.provideMerge(Postgres.layer),
  Layer.provide(Postgres.clientLayer),
  Layer.provide(NodeServices.layer),
  Layer.provide(NodeHttpServer.layer(createServer, { port })),
  Layer.launch,
  NodeRuntime.runMain,
)
