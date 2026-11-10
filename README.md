# hypernotes

A Notion-style workspace: nested pages, a block editor and databases. Built with hyper-effect: Foldkit programs run on the server with Effect, Datastar updates the browser, and Postgres stores the workspace. The rich-text editor is a Foldkit island in the browser.

All bundled people and pages are fictional demo content. Demo addresses use the reserved `hypernotes.example` domain.

## Start locally

Requires Node.js 22.19 or later and Docker with Compose.

```sh
npm install
npm run db:up
npm run demo:seed
npm start
```

Open [localhost:4300](http://localhost:4300). The database runs on `localhost:5436` in its own `hypernotes` Compose project. `npm run db:up` creates `.env` with random application secrets if it does not exist. `npm run dev` restarts the server when source files change. `PORT` and `DATABASE_URL` override the defaults (`4300`, `postgres://hypernotes:hypernotes-dev@localhost:5436/hypernotes`).

| Name | Email | Password |
| --- | --- | --- |
| Avery Finch | afinch@hypernotes.example | Avery |
| Morgan Vale | mvale@hypernotes.example | Morgan |
| Riley Quinn | rquinn@hypernotes.example | Riley |

Passwords are stored as scrypt hashes. `npm run user:create` adds an account. Everything the seed adds is marked `isDemo`: `npm run demo:clear` removes it and `npm run demo:reset` seeds again.

## Features

[`docs/notion-features.md`](docs/notion-features.md) lists Notion's features and interactions and which of them are built.

- **Sidebar:** Favorites, workspace and private sections, a page tree (open state per person), `+` and `•••` per row (favorite, duplicate, move, trash), Search, Home, Settings and Trash.
- **Page:** emoji icon, covers, title, breadcrumbs, style (font, small text, full width), lock, comments and discussions, backlinks, page history with preview and restore, Trash with restore and delete forever.
- **Editor:** text, headings, toggle headings, lists, to-dos, toggles, quotes, callouts, dividers, code (languages, copy), images (resize), bookmarks, sub-pages, table of contents, equations, columns and simple tables. Markdown shortcuts, the `/` menu, the block handle menu (turn into, colour, duplicate, move, delete), the inline toolbar, links, `@` mentions of people, pages and dates, `:` emoji, block selection, drag and drop, copy and paste, and undo/redo.
- **Databases:** an empty page becomes a database whose rows are pages. Table, board, list, gallery and calendar views; text, number, select, multi-select, status, date, person, checkbox, URL, email, phone, created/edited time and by, ID, relation, rollup and formula properties; filters, sorts, grouping, resizable columns, footer calculations, hidden board groups, card sizes and side/center/full-page peeks.
- **Search:** `Ctrl+K` matches titles and page text with highlighted matches; an empty search lists recent pages.
- **Appearance:** light and dark mode and the creaseui theme presets on `/settings`.

Edits reach everyone with the page open live.

## Validation

```sh
npm run typecheck
npm run lint
npm test
npm run test:pg
npm run check:fresh
```

`npm run lint` runs ESLint with the `@creaseui/lint` strict preset, `creaseui-lint doctor`, `creaseui-lint css` and the native-control and overlay tests. `test:pg` and `check:fresh` need `npm run db:up`; they use separate throwaway databases. `check:fresh` builds the assets, seeds a fresh database, starts a server on port 4200 and runs three Playwright checks: the app with two people at once (`scripts/check.mjs`), overlay placement (`scripts/check-overlays.mjs`) and the editor (`scripts/check-editor.mjs`).

## Architecture

Each page is a server-side Foldkit program with a pure update and view; Commands do the effects. Shared changes are pure operations in `src/app/workspace.ts`, run by the Workspace service, and Postgres (`src/app/postgres.ts`) writes the rows that changed. Page documents are schema-validated block JSON (`src/app/editor`); the editor island (`*.client.ts`, `npm run build:islands`) edits them in the browser through pure operations on the document and selection. Databases live in `src/app/database.ts` (properties, views, filters, sorts, rollups, calculations) and `src/app/formula.ts` (the formula language).

The UI is built from creaseui components copied into `src/ui` (see `crease.lock.json`). Only the registered adapters render raw elements: the design layer (`src/app/view/design.ts`), icons and the editor.

hyper-effect comes from npm: `@hyper-effect/core` and `@hyper-effect/island` (0.1.1), on Foldkit 0.170 and Effect 4.1.
