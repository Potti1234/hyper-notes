# Notion, feature by feature

What hyper-notes rebuilds, written down before building it. Sources: the Notion
Help Center (keyboard shortcuts, writing & editing basics, customize & style,
sidebar, columns/headings/dividers, delete & restore, databases, views,
properties, comments) and the behaviour of the Notion web app. Every
interaction below is either implemented (✅), planned in a later slice (⏳) or
deliberately left out (✗, with the reason). The status column is kept current.

## 1. Workspace shell

| Feature | Interaction | Status |
|---|---|---|
| Sidebar | Fixed left column, 240 px, resizable by dragging its right edge (min 200, max 480); collapse with `«` in the sidebar header or `Ctrl+\`; when collapsed, hovering the left edge peeks it; `»` in the topbar opens it again | ✅ resize (saved per person), collapse, and hover peek (left edge, the panel itself or `»`; "Keep open" in the peek reopens it) |
| Workspace switcher | Top row: workspace icon + name + chevron; menu shows the account email, settings, log out | ✅ workspace name and chevron open a menu with the account email, Settings, Light/Dark theme and Log out |
| Top shortcuts | Search (`Ctrl+K`/`Ctrl+P`), Home, Inbox, Settings | ✅ Search, Home, Settings; Inbox ⏳ |
| New page | Pencil/compose button in the sidebar header and `Ctrl+N`: creates an untitled private page and opens it | ✅ button and `Ctrl+Alt+N` (browsers keep `Ctrl+N` for a new window) |
| Sections | Favorites (only when non-empty), Shared (workspace pages), Private (my pages); each heading shows a `+` on hover that creates a page in that section | ✅ |
| Page tree | Row = disclosure arrow (replaces the icon on hover; empty pages show "No pages inside"), icon (emoji or default page glyph), title (`Untitled` grey when empty); hover shows `•••` and `+` (add a page inside, expands the row); the open page is highlighted; expansion state persists per member | ✅ |
| Row `•••` menu | Add to / Remove from Favorites, Copy link, Duplicate (`Ctrl+D`), Rename (inline input popover), Move to (page picker), Move to Trash; footer "Last edited by … · time" | ✅ favorite, Copy link, duplicate, Rename, move, trash, open |
| Drag in the tree | Drag a row onto another (nest inside: blue box) or between rows (reorder: blue line); drag between sections | ✅ nest, reorder, move to the end of either section |
| Trash | Sidebar entry opens a popover: search field, filter, list of trashed pages with restore (↶) and delete forever (🗑 with confirm); trashed pages open read-only with a red banner "This page is in Trash" + Restore page + Delete from Trash | ✅ as a Trash page with search instead of a popover |
| Templates / Import | Out of scope for the first version | ✗ |
| Dark mode | `Ctrl+Shift+L` toggles; theme presets on /settings (as in hyper-tasks) | ✅ |

## 2. Page chrome

| Feature | Interaction | Status |
|---|---|---|
| Topbar | Breadcrumbs (icon + title per ancestor, middle ones collapse into `…` when deep; each one a link), "Edited 5m ago" (title tooltip shows editor + date), Share, comments (💬), Favorite ☆/★, `•••` | ✅ breadcrumbs, Edited, Favorite, comments, `•••`; Share ✗ (single workspace) |
| `•••` page menu | Search box at the top (filters the actions); Style: Default / Serif / Mono (three "Ag" tiles); toggles: Small text, Full width, Lock page; Copy link (`Ctrl+L`), Duplicate, Move to, Move to Trash, Undo, Version history, Export (Markdown), Word count footer "Last edited by …" | ✅ action search, style, small text, full width, lock, history, favorite, Copy link (`Ctrl+L`), duplicate, move, trash, word count and last edited, Export (Markdown download) |
| Hover controls | Hovering the title area shows "Add icon", "Add cover", "Add comment" (only the missing ones) | ✅ |
| Icon | 78 px emoji left above the title; click opens the emoji picker: tabs Emoji / Upload(URL), filter field, Random 🔀, Remove; categories with headings, recent emoji first; in sidebar + breadcrumbs too | ✅ emoji, filter, Random, Remove; Upload ⏳ |
| Cover | Full-width 30vh banner; hover shows "Change cover" and "Reposition"; Change opens a gallery (colour & gradient tiles, Link tab with URL); Reposition drags the image vertically then "Save position"; Remove | ✅ gallery, link, change, remove, Reposition (image covers; Esc cancels) |
| Title | Large (40 px, bold) editable heading, placeholder "Untitled"; Enter moves into the first block (creating one); ArrowDown at the end enters the body; changes rename the page everywhere live | ✅ |
| Empty page | Body shows "Press Enter to continue with an empty page, or pick a template" style list: Empty page, Table/Board/List/Gallery/Calendar (turn the page into a database) | ✅ all five database layouts; templates ✗ |
| Lock page | Locked pages refuse edits; a "🔒 Locked" chip in the topbar unlocks | ✅ |
| Full width / small text / font | Applied on the page root; persisted per page | ✅ |
| Backlinks | "N backlinks" line under the title, expands the list of pages mentioning this one | ✅ |
| Page comments | Comment thread under the title ("Add a comment…"), resolve, delete own | ✅ plus reply, edit, reopen |
| Version history | Snapshots on edits (throttled), list with author/time, preview, Restore | ✅ |

## 3. Editor: the block model

Everything is a block: `id`, `type`, rich text (`[text, annotations]` runs), type
props (checked, color, language, collapsed, emoji, url, …) and children. Any
block can hold children (Tab nests under the previous block; toggles and pages
show theirs collapsed/elsewhere).

Block types: Text, Heading 1/2/3, Toggle heading 1/2/3, Bulleted list, Numbered
list, To-do, Toggle list, Quote, Callout, Divider, Code (language picker, copy,
wrap), Page (sub-page), Link to page, Image (URL), Bookmark (URL card), Embed
(URL), Table of contents, Breadcrumb, Equation (TeX block), Simple table,
Columns (2–5), Button? (✗: needs automation), Synced block (✗), Database inline
(⏳ after databases).

Inline: bold, italic, underline, strikethrough, inline code, link, text colour
(10) and background colour (10), inline equation, mentions (page, person, date),
emoji.

## 4. Editor: typing and keys (single block)

| Key / input | Behaviour |
|---|---|
| Printable text | Inserted with the marks of the text before the caret (not after a link/code end) |
| `Enter` | Split the block at the caret; the new block keeps list/to-do type (unchecked), headings/quote/callout split into Text; on an empty list/to-do/toggle/quote → turn into Text (Enter again creates a new block); in code: newline |
| `Shift+Enter` | Soft line break inside the block |
| `Backspace` at start | List/to-do/heading/toggle/quote/callout → Text (keeps text); nested Text → outdent; top-level Text → merge into previous text block (caret at the join); previous block a divider/image → select it (block selection) |
| `Delete` at end | Merge the next block's text into this one |
| `Tab` / `Shift+Tab` | Nest under the previous sibling / un-nest (children follow) |
| `Ctrl+B/I/U`, `Ctrl+Shift+S`, `Ctrl+E` | Toggle bold/italic/underline/strike/code on the selection (or the typing marks at a caret) |
| `Ctrl+K` | Link popover for the selection |
| `Ctrl+Shift+H` | Apply the last used colour |
| `Ctrl+Alt+0…9` | Turn into Text, H1, H2, H3, To-do, Bulleted, Numbered, Toggle, Code, Page |
| `Ctrl+Enter` | Toggle the to-do / open-close the toggle / open the sub-page |
| `Ctrl+Alt+T` | Expand/collapse all toggles |
| `Ctrl+D` | Duplicate the block |
| `Ctrl+Shift+↑/↓` | Move the block up/down |
| `Ctrl+Z` / `Ctrl+Shift+Z` (`Ctrl+Y`) | Undo / redo, grouped by typing bursts |
| `Ctrl+A` | First: select the block's text; second: select all blocks |
| `Esc` | Select the current block (block selection); again: clear |
| `↑/↓` at first/last visual line | Move into the previous/next block keeping the x position (approximately: same offset) |
| `Ctrl+/` | Open the block action menu with its filter |
| Markdown at block start + space | `#`, `##`, `###` headings; `-`, `*`, `+` bullet; `1.` `a.` `i.` numbered; `[]` to-do; `>` toggle; `"` quote; ` ``` ` code; `---` divider |
| Inline markdown | `**bold**`, `*italic*`/`_italic_`, `` `code` ``, `~strike~`/`~~strike~~`: converted when the closing mark is typed |
| `/` | Slash menu (see §5) |
| `@` | Mention menu: people, pages, dates (Today, Tomorrow, Yesterday, typed dates), "Remind" |
| `[[` and `+` | Link-to-page menu (page search, "+ Add new sub-page") |
| `:` + 2 letters | Emoji menu (`:fire` → 🔥) |
| Paste | Plain text: lines → blocks, markdown recognised; HTML from the editor/other apps: blocks with marks; URL on a selection → link; URL on empty → menu Dismiss / Create bookmark / Create embed |
| Copy/Cut | Selected text or selected blocks as HTML + plain text |
| IME composition | Never interrupted; committed text applied at composition end |

## 5. Editor: menus and overlays

| Menu | Details |
|---|---|
| Slash menu | Opens at `/` (start of a block or after a space); filter by what follows; groups: Suggested (recent), Basic blocks, Media, Inline, Advanced, Actions (Delete, Duplicate, Move to, Turn into…), Colors (`/red`, `/blue background`, `/default`); each item with an illustration tile, name, description and markdown hint; ↑/↓ wrap, Enter/Tab apply, Esc closes keeping the `/`, closing when the filter matches nothing after 3+ extra characters ("No results"); hover moves the highlight |
| `+` in the margin | Hover a block → `+` and `⋮⋮` in the left gutter; `+` inserts an empty block below (Alt+click: above) and opens the slash menu |
| `⋮⋮` handle | Click: block action menu; drag: move the block (blue drop line between blocks, drop onto the left/right edge of a block to create columns, nesting by horizontal offset); Alt+drag duplicates |
| Block action menu | Filter field ("Search actions…"), Turn into ▸ (list of types, current one checked), Color ▸ (text colours, background colours, "Last used"), Copy link to block, Duplicate, Move to, Delete, Comment; footer "Last edited by … time" |
| Inline toolbar | On a non-empty text selection: Turn into ▾ (current type name), Link, Comment, B, I, U, S, `<>`, √x (equation), A ▾ (colour), @ mention; active marks highlighted; stays above the selection, flips below near the top |
| Link popover | Input "Paste link or search pages", page results, Enter applies; on an existing link hovering shows its URL with Edit / Copy / Remove |
| Colour menu | Text colour list (Default, Gray, Brown, Orange, Yellow, Green, Blue, Purple, Pink, Red) and Background list, each with an "A" swatch |
| Block selection | Esc/margin drag/click on handle selects whole blocks (blue tint); ↑/↓ move, Shift+↑/↓ extend, Shift+click range, Backspace deletes, Ctrl+D duplicates, Enter edits, Ctrl+C/X copy/cut, typing a printable replaces with a new block; floating counter "N blocks · words · characters" |
| Placeholders | Focused empty Text: "Press '/' for commands" (Notion: "Write something, or press 'space' for AI, '/' for commands…"); headings "Heading 1/2/3"; list "List"; to-do "To-do"; toggle "Toggle"; quote "Empty quote"; empty toggle body "Empty toggle. Click or drop blocks inside." |
| Toggle | Arrow click opens/closes; Enter at the end of an open toggle creates the first child |
| Code block | Language dropdown (searchable), Copy button, Tab inserts two spaces, Enter = newline, `Ctrl+Enter`/↓ at end leaves |
| Image | Empty state "Add an image" opens an Embed link panel; resize handles left/right; caption |
| Bookmark | URL card with title, description, domain |
| Table of contents | Lists H1–H3 indented, click scrolls to the heading |
| Equation | Block TeX editor popover (textarea + Done); renders monospace TeX preview (no KaTeX dependency) |
| Simple table | Tab/Shift+Tab move between cells, `+` row/column buttons on hover, header row/column toggles, delete row/column |
| Columns | Created by drag to a block's side; resize by dragging the gap |

## 6. Databases (full page and inline)

| Feature | Interaction | Status |
|---|---|---|
| Database page | Title + description, view tabs, "New" button (with ▾ templates), Filter, Sort, Search 🔍, `•••` (properties, layout, group) | ✅ title, view tabs, New, Filter, Sort, Search, view menu; description and templates ⏳ |
| Rows are pages | Open as side peek (default), centre peek or full page; peek shows properties above the page body | ✅ (page body is edited on the full page) |
| Properties | Text, Number (format), Select, Multi-select (coloured options, create on type), Status (To do / In progress / Done groups), Date (range, time), Person, Checkbox, URL, Email, Phone, Created time, Created by, Last edited time, Last edited by, ID; Formula, Relation, Rollup, Files (✗ first version) | ✅ all listed; Files ✗ |
| Table view | Column headers with type icon; click header → menu (rename, type, sort asc/desc, filter, hide, insert left/right, duplicate, delete); resize by dragging; cell editing in place; "+ New" row at the bottom; row hover handle with Open; calculations footer (count, …) | ✅ |
| Board view | Group by select/status/person; columns with counts, drag cards between columns; "+ New" per column; hidden groups | ✅ |
| List view | One line per page with chosen properties right-aligned | ✅ |
| Gallery view | Cards with page cover/content preview; card size | ✅ |
| Calendar view | Month grid by a date property; Today; drag to move dates; "+" on day hover | ✅ |
| Timeline view | ✗ (later) | ✗ |
| Filters/sorts | Simple filter chips per property (operators per type), advanced groups ✗; multiple sorts with drag order | ✅ sorts reorder with Move up instead of drag |
| Grouping | Table/list/board group by a property | ✅ |

## 7. Collaboration and the rest

| Feature | Status |
|---|---|
| Live updates from other members (tree, titles, content when not typing) | ✅ |
| Presence avatars in the topbar | ✅ avatars of the others on the page, live; name on hover |
| Comments: inline (on a text range, shown with underline highlight and a margin bubble) and page-level; resolve | ✅ page-level and on selected text (toolbar Comment or `Ctrl+Shift+M`; yellow mark, quote above the discussion, click to show it; resolving or deleting clears the mark) |
| Inbox: mentions of me and replies | ⏳ |
| Search: `Ctrl+K` modal, recent pages when empty, results by title and content with highlighted match, ↑/↓/Enter, filters "Only titles" | ✅ including "Only titles" |
| Sharing/publishing to web, guests, permissions | ✗ (single workspace, members edit; locked pages are read-only) |
| AI | ✗ |
| Mobile toolbar | ✗ |

## 8. How it maps onto the stack

- Server pages (hyper-effect, Foldkit update on the server): shell, sidebar,
  topbar, page header, trash, search, settings, databases.
- The editor is an **island**: a Foldkit program in the browser whose Model is
  the whole document (block tree with rich text), the selection, and an
  explicit `EditorMode` union (`Typing`, `SlashMenu`, `BlockMenu`,
  `InlineToolbar`, `LinkPopover`, `MentionMenu`, `EmojiMenu`, `BlockSelection`,
  `Dragging`, …). Every keystroke is a Message; every edit is a pure function
  `(Doc, Selection) → (Doc, Selection)` tested with Story tests. The DOM is a
  rendering of the Model (one `contenteditable` root, `beforeinput` handled in
  update); only IME composition is read back from the DOM.
- Documents are stored as Schema-validated block JSON (the Schema decode is the
  sanitizer); the server renders the same blocks read-only.
