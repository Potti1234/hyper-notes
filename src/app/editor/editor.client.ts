import { Effect, Match as M, Option, Queue, Schema as S, Stream } from 'effect'
import { Command, Mount, Port, Runtime, Subscription } from 'foldkit'
import type { Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import * as Render from 'foldkit/render'

import * as B from './blocks'
import { link } from '../../ui/link'
import { blockAt, readSelection, writeSelection } from './dom.client'
import { EditorEvent, EditorProps, MAX_QUOTE, MemberRef, PageRef } from './island'
import { keyResult } from './keys'
import { BACKGROUND_COLORS, type BlockMenuItem, type InlineItem, TEXT_COLORS, blockMenuItems, iconChoices, inlineMenuItems, languageChoices, linkChoices, linkUnderCaret, slashItems } from './menus'
import { ANCHOR, colorClass, context, renderDocument } from './render'
import { type Block, type Color, Document, type ToggleMark, hasText } from './schema'
import { type Action, EditorState, type InlineMenu, Selection, apply, caret, initial, isCollapsed, ordered, targetIds } from './state'
import * as T from './text'
import { iconText } from '../icon-link'
import { anchoredStyle } from '@/lib/anchored'

/* The page editor island: a Foldkit program in the browser around the pure
   editor (state.ts). The Mount turns DOM events into Actions; every state is
   rendered by render.ts and the selection of the model is written back after the
   render commits. Content goes to the server a moment after typing stops. */

// MODEL

/** What floats over the editor besides the `/` menu (which lives in the editor state). */
export const Overlay = S.Union([
  S.TaggedStruct('Closed', {}),
  S.TaggedStruct('BlockMenu', { blockId: S.String, query: S.String, active: S.Number }),
  S.TaggedStruct('ColorMenu', { active: S.Number }),
  /** Typing into a small field: a link (Ctrl+K), a media URL, an equation or a code language. */
  S.TaggedStruct('Prompt', { field: S.Literals(['link', 'url', 'tex', 'language', 'page', 'icon']), blockId: S.String, value: S.String, active: S.Number }),
])
export type Overlay = typeof Overlay.Type

export const Model = S.Struct({
  pageId: S.String,
  revision: S.Number,
  isEditable: S.Boolean,
  pages: S.Array(PageRef),
  members: S.Array(MemberRef),
  crumbs: S.Array(PageRef),
  today: S.String,
  editor: EditorState,
  /** The content last sent or received: the editor has unsaved edits when its doc differs. */
  saved: Document,
  saveSeq: S.Number,
  overlay: Overlay,
  isComposing: S.Boolean,
  epoch: S.Number,
  threads: S.Array(S.String),
  activeThread: S.NullOr(S.String),
})
export type Model = typeof Model.Type

const ActionSchema = S.declare((input: unknown): input is Action => typeof input === 'object' && input !== null && '_tag' in input)
const Place = S.Literals(['before', 'after', 'inside', 'left', 'right'])

// MESSAGE

export const Message = defineMessageUnion({
  ReceivedProps: { props: EditorProps },
  Acted: { action: ActionSchema },
  PressedMenuKey: { key: S.Literals(['up', 'down', 'enter', 'escape', 'backspace']) },
  TypedMenuChar: { char: S.String },
  HoveredMenuItem: { index: S.Number },
  ChoseMenuItem: { index: S.Number },
  OpenedLink: {},
  StartedComment: {},
  ClickedCommentMark: { threadId: S.String },
  ToggledCurrent: {},
  OpenedBlockMenu: { blockId: S.NullOr(S.String) },
  ClickedControl: { action: S.String, blockId: S.String },
  ClickedTool: { tool: S.String },
  StartedComposition: {},
  Composed: { text: S.String },
  PastedBlocks: { blocks: Document },
  Dropped: { ids: S.Array(S.String), targetId: S.String, place: Place },
  ResizedImage: { blockId: S.String, width: S.Number },
  /** The caret moved by the browser (arrows, clicks) while inputs were still rendering. */
  ReadDomSelection: { selection: Selection },
  Blurred: {},
  DueSave: { seq: S.Number },
  CompletedEmit: {},
  CompletedSync: {},
})
export type Message = typeof Message.Type

const MOUNT_TAGS = ['Acted', 'PressedMenuKey', 'TypedMenuChar', 'HoveredMenuItem', 'ChoseMenuItem', 'OpenedLink', 'StartedComment', 'ClickedCommentMark', 'ToggledCurrent', 'OpenedBlockMenu', 'ClickedControl', 'ClickedTool', 'StartedComposition', 'Composed', 'PastedBlocks', 'Dropped', 'ResizedImage', 'Blurred'] as const
type MountMessage = Extract<Message, { _tag: (typeof MOUNT_TAGS)[number] }>

// PORT

export const ports = {
  inbound: { props: Port.inbound(EditorProps) },
  outbound: { events: Port.outbound(EditorEvent) },
}

// Browser state: the root of each editor and the model it last rendered (the
// DOM listeners read it to decide which keys belong to the editor).
const roots = new Map<string, HTMLElement>()
const mirrors = new Map<string, Model>()
/** Input messages offered but not yet rendered: until then the DOM selection is stale, so it is not read. */
const pending = new Map<string, number>()
/** The selection last written to the DOM, to tell a new model selection from a moved browser caret. */
const written = new Map<string, Selection>()
const writtenDocs = new Map<string, Document>()
/** Caret moves typed while inputs were still rendering, replayed on the rendered DOM afterwards. */
const queuedMoves = new Map<string, Array<readonly [alter: string, direction: string, granularity: string]>>()

const MOVE_KEYS: Readonly<Record<string, readonly [direction: string, granularity: string]>> = {
  ArrowLeft: ['backward', 'character'], ArrowRight: ['forward', 'character'], ArrowUp: ['backward', 'line'], ArrowDown: ['forward', 'line'],
  Home: ['backward', 'lineboundary'], End: ['forward', 'lineboundary'],
}

const samePoint = (a: { blockId: string; offset: number }, b: { blockId: string; offset: number }): boolean => a.blockId === b.blockId && a.offset === b.offset

const sameSelection = (a: Selection | undefined, b: Selection): boolean =>
  a !== undefined && (a._tag === 'TextSelection' && b._tag === 'TextSelection' ? samePoint(a.anchor, b.anchor) && samePoint(a.focus, b.focus)
    : a._tag === 'BlockSelection' && b._tag === 'BlockSelection' ? a.ids.join() === b.ids.join()
    : a._tag === b._tag)

// COMMAND

const Emit = Command.define('Emit', {
  args: { event: EditorEvent },
  messages: [Message.CompletedEmit],
  execute: ({ event }) => Port.emit(ports.outbound.events, event).pipe(Effect.as(Message.CompletedEmit())),
})

const ScheduleSave = Command.define('ScheduleSave', {
  args: { seq: S.Number },
  messages: [Message.DueSave],
  execute: ({ seq }) => Effect.sleep('600 millis').pipe(Effect.as(Message.DueSave({ seq }))),
})

const Sync = Command.define('Sync', {
  args: { model: Model, isAfterInput: S.Boolean },
  messages: [Message.CompletedSync, Message.ReadDomSelection],
  execute: ({ model, isAfterInput }) =>
    Effect.gen(function* () {
      const { pageId, editor } = model
      mirrors.set(pageId, model)
      yield* Render.afterCommit
      if (isAfterInput) pending.set(pageId, Math.max(0, (pending.get(pageId) ?? 1) - 1))
      const root = roots.get(pageId)
      if (root === undefined || model.isComposing || !model.isEditable) return Message.CompletedSync()
      const dom = root.contains(document.activeElement) ? readSelection(root) : null
      const isNew = !sameSelection(written.get(pageId), editor.selection)
      const isRerendered = writtenDocs.get(pageId) !== editor.doc
      writtenDocs.set(pageId, editor.doc)
      // The model moved or the blocks re-rendered: write the selection. Otherwise the browser moved the caret: read it.
      const isWriting = isNew || isRerendered || dom === null
      // Never pull focus back from the title, a prompt or the page around the editor.
      const isFocused = root.contains(document.activeElement) && document.activeElement?.closest('[data-overlay]') == null
      if (isWriting) {
        written.set(pageId, editor.selection)
        if (isFocused && (isNew || isRerendered || editor.selection._tag === 'TextSelection')) writeSelection(root, editor.selection)
      }
      if ((pending.get(pageId) ?? 0) > 0) return Message.CompletedSync()
      const moves = queuedMoves.get(pageId) ?? []
      queuedMoves.delete(pageId)
      const current = document.getSelection()
      for (const [alter, direction, granularity] of moves) current?.modify(alter, direction, granularity)
      const after = moves.length > 0 ? readSelection(root) : isWriting ? null : dom
      if (after === null || after._tag !== 'TextSelection' || sameSelection(after, editor.selection)) return Message.CompletedSync()
      // Until the read selection renders, later caret moves queue up behind it.
      pending.set(pageId, 1)
      return Message.ReadDomSelection({ selection: after })
    }),
})

const CopyText = Command.define('CopyText', {
  args: { text: S.String },
  messages: [Message.CompletedSync],
  execute: ({ text }) => Effect.promise(() => navigator.clipboard.writeText(text).catch(() => undefined)).pipe(Effect.as(Message.CompletedSync())),
})

// HELPERS

const freshId = (editor: EditorState): readonly [string, EditorState] => [`${editor.idPrefix}${editor.idCount}`, { ...editor, idCount: editor.idCount + 1 }]

const focusBlock = (editor: EditorState): string | null =>
  editor.selection._tag === 'TextSelection' ? editor.selection.focus.blockId : editor.selection._tag === 'BlockSelection' ? (editor.selection.ids.at(-1) ?? null) : null

const READ_ONLY_ACTIONS: ReadonlySet<Action['_tag']> = new Set(['Select', 'SelectAll', 'Escape', 'MoveBlockSelection', 'EditSelectedBlock', 'ToggleOpen', 'CloseMenu'])

/** The next model after an editor change, with what it takes: a save later, and the DOM selection. */
const commit = (model: Model, editor: EditorState, overlay: Overlay = model.overlay): Update.Return<Model, Message> => {
  const changed = editor.doc !== model.editor.doc
  const saveSeq = changed ? model.saveSeq + 1 : model.saveSeq
  const next: Model = { ...model, editor, overlay, saveSeq }
  return { model: next, commands: changed ? [ScheduleSave({ seq: saveSeq })] : [] }
}

const act = (model: Model, action: Action, overlay?: Overlay): Update.Return<Model, Message> =>
  !model.isEditable && !READ_ONLY_ACTIONS.has(action._tag) ? { model } : commit(model, apply(model.editor, action), overlay)

const actAll = (model: Model, actions: ReadonlyArray<Action>, overlay?: Overlay): Update.Return<Model, Message> =>
  !model.isEditable ? { model } : commit(model, actions.reduce(apply, model.editor), overlay)

const wrap = (index: number, length: number): number => (length === 0 ? 0 : ((index % length) + length) % length)

const visiblePages = (model: Model, query: string): ReadonlyArray<PageRef> =>
  model.pages.filter(page => page.id !== model.pageId && (page.title || 'Untitled').toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)

const inlineItems = (model: Model, menu: InlineMenu): ReadonlyArray<InlineItem> => inlineMenuItems(menu, model)

const chooseInline = (model: Model, index: number): Update.Return<Model, Message> => {
  const menu = model.editor.menu
  if (menu._tag !== 'InlineMenu') return { model }
  const chosen = inlineItems(model, menu)[index]
  return chosen === undefined ? act(model, { _tag: 'CloseMenu' }) : act(model, { _tag: 'ChooseInline', piece: chosen.piece })
}

const chooseSlash = (model: Model, index: number): Update.Return<Model, Message> => {
  const menu = model.editor.menu
  if (menu._tag === 'InlineMenu') return chooseInline(model, index)
  if (menu._tag !== 'SlashMenu') return { model }
  const chosen = slashItems(menu.query)[index]
  if (chosen === undefined) return act(model, { _tag: 'CloseMenu' })
  const editor = apply(model.editor, { _tag: 'ChooseSlash', tag: chosen.tag, level: chosen.level })
  // Blocks without text move the caret on, so the chosen block is the one the menu was opened in.
  const target = B.find(editor.doc, menu.blockId)
  if (target === null) return commit(model, editor)
  switch (target.kind._tag) {
    case 'SubPage': {
      const [childId, next] = freshId(editor)
      const withPage = apply(next, { _tag: 'SetKind', blockId: target.id, kind: { _tag: 'SubPage', pageId: `p${childId}` } })
      const result = commit(model, withPage)
      return { model: result.model, commands: [...(result.commands ?? []), Emit({ event: { _tag: 'CreatedSubPage', pageId: model.pageId, blockId: target.id, childId: `p${childId}` } })] }
    }
    case 'LinkToPage': return commit(model, editor, { _tag: 'Prompt', field: 'page', blockId: target.id, value: '', active: 0 })
    case 'Image':
    case 'Bookmark':
    case 'Embed': return commit(model, editor, { _tag: 'Prompt', field: 'url', blockId: target.id, value: '', active: 0 })
    case 'Equation': return commit(model, editor, { _tag: 'Prompt', field: 'tex', blockId: target.id, value: '', active: 0 })
    default: return commit(model, editor)
  }
}

const runBlockItem = (model: Model, entry: BlockMenuItem): Update.Return<Model, Message> => {
  const closed: Overlay = { _tag: 'Closed' }
  switch (entry._tag) {
    case 'Delete': return act(model, { _tag: 'DeleteBlocks' }, closed)
    case 'Duplicate': return act(model, { _tag: 'Duplicate' }, closed)
    case 'MoveUp': return act(model, { _tag: 'MoveBy', direction: -1 }, closed)
    case 'MoveDown': return act(model, { _tag: 'MoveBy', direction: 1 }, closed)
    case 'TurnInto': return act(model, { _tag: 'TurnInto', tag: entry.item.tag, level: entry.item.level }, closed)
    case 'Color': return act(model, { _tag: 'SetBlockColor', color: entry.color }, closed)
    case 'CopyLink': {
      const blockId = focusBlock(model.editor) ?? ''
      return { model: { ...model, overlay: closed }, commands: [CopyText({ text: `/p/${model.pageId}#block-${blockId}` })] }
    }
  }
}

const COLORS: ReadonlyArray<Color> = [...TEXT_COLORS, ...BACKGROUND_COLORS]

const submitPrompt = (model: Model, overlay: Extract<Overlay, { _tag: 'Prompt' }>): Update.Return<Model, Message> => {
  const closed: Overlay = { _tag: 'Closed' }
  const target = B.find(model.editor.doc, overlay.blockId)
  const value = overlay.value.trim()
  switch (overlay.field) {
    case 'link': return act(model, { _tag: 'SetLink', url: linkChoices(overlay.value, model.pages, model.pageId)[overlay.active]?.url ?? null }, closed)
    case 'page': {
      const page = visiblePages(model, overlay.value)[overlay.active]
      return page === undefined ? { model: { ...model, overlay: closed } } : act(model, { _tag: 'SetKind', blockId: overlay.blockId, kind: { _tag: 'LinkToPage', pageId: page.id } }, closed)
    }
    case 'url': {
      if (target === null || !('url' in target.kind)) return { model: { ...model, overlay: closed } }
      const url = value === '' || /^https?:\/\//.test(value) ? value : `https://${value}`
      return act(model, { _tag: 'SetKind', blockId: overlay.blockId, kind: { ...target.kind, url } }, closed)
    }
    case 'tex': return target?.kind._tag === 'Equation' ? act(model, { _tag: 'SetKind', blockId: overlay.blockId, kind: { _tag: 'Equation', tex: overlay.value } }, closed) : { model: { ...model, overlay: closed } }
    case 'language': {
      const language = languageChoices(overlay.value)[overlay.active]
      return target?.kind._tag === 'Code' && language !== undefined ? act(model, { _tag: 'SetKind', blockId: overlay.blockId, kind: { ...target.kind, language } }, closed) : { model: { ...model, overlay: closed } }
    }
    case 'icon': {
      const icon = iconChoices(overlay.value)[overlay.active]
      return target?.kind._tag === 'Callout' && icon !== undefined ? act(model, { _tag: 'SetKind', blockId: overlay.blockId, kind: { _tag: 'Callout', icon: icon.char } }, closed) : { model: { ...model, overlay: closed } }
    }
  }
}

const menuLength = (model: Model): number => {
  const { overlay } = model
  if (overlay._tag === 'BlockMenu') return blockMenuItems(overlay.query).length
  if (overlay._tag === 'ColorMenu') return COLORS.length
  if (overlay._tag === 'Prompt' && overlay.field === 'page') return visiblePages(model, overlay.value).length
  if (overlay._tag === 'Prompt' && overlay.field === 'link') return linkChoices(overlay.value, model.pages, model.pageId).length
  if (overlay._tag === 'Prompt' && overlay.field === 'language') return languageChoices(overlay.value).length
  if (overlay._tag === 'Prompt' && overlay.field === 'icon') return iconChoices(overlay.value).length
  const menu = model.editor.menu
  return menu._tag === 'SlashMenu' ? slashItems(menu.query).length : menu._tag === 'InlineMenu' ? inlineItems(model, menu).length : 0
}

const pressMenuKey = (model: Model, key: 'up' | 'down' | 'enter' | 'escape' | 'backspace'): Update.Return<Model, Message> => {
  const { overlay } = model
  const closed: Overlay = { _tag: 'Closed' }
  const step = key === 'up' ? -1 : 1
  if (overlay._tag === 'Closed') {
    const menu = model.editor.menu
    if (menu._tag === 'NoMenu') return { model }
    if (key === 'escape') return act(model, { _tag: 'CloseMenu' })
    // With nothing to choose, Enter is Enter again.
    if (key === 'enter' && menu._tag === 'InlineMenu' && menuLength(model) === 0) return actAll(model, [{ _tag: 'CloseMenu' }, { _tag: 'Enter' }])
    if (key === 'enter') return chooseSlash(model, menu.active)
    return act(model, { _tag: 'MoveSlash', active: wrap(menu.active + step, menuLength(model)) })
  }
  if (key === 'escape') return commit(model, model.editor, closed)
  if (overlay._tag === 'BlockMenu') {
    if (key === 'enter') {
      const entry = blockMenuItems(overlay.query)[overlay.active]
      return entry === undefined ? { model } : runBlockItem(model, entry)
    }
    if (key === 'backspace') return { model: { ...model, overlay: { ...overlay, query: overlay.query.slice(0, -1), active: 0 } } }
    return { model: { ...model, overlay: { ...overlay, active: wrap(overlay.active + step, menuLength(model)) } } }
  }
  if (overlay._tag === 'ColorMenu') {
    const color = COLORS[overlay.active]
    if (key === 'enter') return color === undefined ? { model } : act(model, { _tag: 'SetTextColor', color }, closed)
    if (key === 'backspace') return { model }
    return { model: { ...model, overlay: { ...overlay, active: wrap(overlay.active + step, COLORS.length) } } }
  }
  if (key === 'enter') return submitPrompt(model, overlay)
  if (key === 'backspace') return { model: { ...model, overlay: { ...overlay, value: overlay.value.slice(0, -1), active: 0 } } }
  return { model: { ...model, overlay: { ...overlay, active: wrap(overlay.active + step, menuLength(model)) } } }
}

const chooseMenuItem = (model: Model, index: number): Update.Return<Model, Message> => {
  const { overlay } = model
  if (overlay._tag === 'BlockMenu') {
    const entry = blockMenuItems(overlay.query)[index]
    return entry === undefined ? { model } : runBlockItem(model, entry)
  }
  if (overlay._tag === 'ColorMenu') {
    const color = COLORS[index]
    return color === undefined ? { model } : act(model, { _tag: 'SetTextColor', color }, { _tag: 'Closed' })
  }
  if (overlay._tag === 'Prompt') return submitPrompt(model, { ...overlay, active: index })
  return chooseSlash(model, index)
}

const TOOL_CLASS: Readonly<Record<string, string>> = { bold: 'nb-tool-bold', italic: 'nb-tool-italic', underline: 'nb-tool-underline', strike: 'nb-tool-strike' }

const TOOL_MARKS: Readonly<Record<string, ToggleMark>> = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike', code: 'code' }

// INIT

export const init = (props: EditorProps): Update.Return<Model, Message> => {
  const editor = initial(props.content, `${props.pageId.slice(-6)}-${Math.floor(props.revision % 1e6).toString(36)}-`)
  const model: Model = {
      pageId: props.pageId, revision: props.revision, isEditable: props.isEditable, pages: props.pages, members: props.members, crumbs: props.crumbs, today: props.today, threads: props.threads, activeThread: props.activeThread,
      editor, saved: editor.doc, saveSeq: 0, overlay: { _tag: 'Closed' }, isComposing: false, epoch: 0,
  }
  return { model, commands: [Sync({ model, isAfterInput: false })] }
}

// UPDATE

/** Comment on the selected text of one block: the page opens the comment box.
 *  Pending edits go first, so the store sees the text that was selected. */
const startComment = (model: Model): Update.Return<Model, Message> => {
  const { selection, doc } = model.editor
  if (!model.isEditable || selection._tag !== 'TextSelection' || isCollapsed(selection)) return { model }
  const [start, end] = ordered(doc, selection)
  const target = B.find(doc, start.blockId)
  if (start.blockId !== end.blockId || target === null) return { model }
  const quote = T.caretText(T.slice(target.text, start.offset, end.offset))
  if (quote.trim() === '' || quote.length > MAX_QUOTE) return { model }
  const isPending = doc !== model.saved
  return {
    model: isPending ? { ...model, saved: doc } : model,
    commands: [
      ...(isPending ? [Emit({ event: { _tag: 'ChangedContent', pageId: model.pageId, content: doc } })] : []),
      Emit({ event: { _tag: 'StartedComment', pageId: model.pageId, blockId: start.blockId, from: start.offset, to: end.offset, quote } }),
    ],
  }
}

const step = (model: Model, message: Message): Update.Return<Model, Message> =>
  M.value(message).pipe(
    M.withReturnType<Update.Return<Model, Message>>(),
    M.tagsExhaustive({
      ReceivedProps: ({ props }) => {
        if (props.pageId !== model.pageId) return { model }
        const base: Model = { ...model, pages: props.pages, members: props.members, crumbs: props.crumbs, today: props.today, threads: props.threads, activeThread: props.activeThread, isEditable: props.isEditable, revision: Math.max(model.revision, props.revision) }
        const hasPending = model.editor.doc !== model.saved
        if (props.revision <= model.revision || hasPending || JSON.stringify(props.content) === JSON.stringify(model.editor.doc)) return { model: base }
        const editor = apply(model.editor, { _tag: 'ReplaceDocument', doc: props.content })
        const next: Model = { ...base, editor, saved: editor.doc }
        return { model: next }
      },
      Acted: ({ action }) => act(model, action),
      PressedMenuKey: ({ key }) => pressMenuKey(model, key),
      TypedMenuChar: ({ char }) =>
        model.overlay._tag === 'BlockMenu' ? { model: { ...model, overlay: { ...model.overlay, query: model.overlay.query + char, active: 0 } } }
        : model.overlay._tag === 'Prompt' ? { model: { ...model, overlay: { ...model.overlay, value: model.overlay.value + char, active: 0 } } }
        : { model },
      HoveredMenuItem: ({ index }) =>
        model.overlay._tag === 'BlockMenu' || model.overlay._tag === 'ColorMenu' || model.overlay._tag === 'Prompt' ? { model: { ...model, overlay: { ...model.overlay, active: index } } }
        : model.editor.menu._tag !== 'NoMenu' ? act(model, { _tag: 'MoveSlash', active: index })
        : { model },
      ChoseMenuItem: ({ index }) => chooseMenuItem(model, index),
      OpenedLink: () => {
        const { selection } = model.editor
        if (selection._tag !== 'TextSelection' || isCollapsed(selection) || !model.isEditable) return { model }
        const [start, end] = ordered(model.editor.doc, selection)
        const text = B.find(model.editor.doc, start.blockId)?.text ?? []
        const link = start.blockId === end.blockId ? T.linkAt(text, start.offset, end.offset) : null
        return { model: { ...model, overlay: { _tag: 'Prompt', field: 'link', blockId: start.blockId, value: link ?? '', active: 0 } } }
      },
      ToggledCurrent: () => {
        const blockId = focusBlock(model.editor)
        const target = blockId === null ? null : B.find(model.editor.doc, blockId)
        if (target === null) return { model }
        if (target.kind._tag === 'Code') return act(model, { _tag: 'LeaveBlock' })
        return target.kind._tag === 'Todo' ? act(model, { _tag: 'ToggleTodo', blockId: target.id }) : act(model, { _tag: 'ToggleOpen', blockId: target.id })
      },
      OpenedBlockMenu: ({ blockId }) => {
        const id = blockId ?? focusBlock(model.editor)
        if (id === null || B.find(model.editor.doc, id) === null || !model.isEditable) return { model }
        const { selection } = model.editor
        const keep = selection._tag === 'BlockSelection' && selection.ids.includes(id)
        const editor = keep ? model.editor : apply(model.editor, { _tag: 'Select', selection: { _tag: 'BlockSelection', ids: [id], anchorId: id } })
        return commit(model, editor, { _tag: 'BlockMenu', blockId: id, query: '', active: 0 })
      },
      ClickedControl: ({ action, blockId }) => {
        const target = B.find(model.editor.doc, blockId)
        if (target === null) return { model }
        switch (action) {
          case 'toggle-todo': return act(model, { _tag: 'ToggleTodo', blockId })
          case 'toggle-open': return act(model, { _tag: 'ToggleOpen', blockId })
          case 'add': {
            if (!model.isEditable) return { model }
            const isEmpty = target.kind._tag === 'Paragraph' && T.lengthOf(target.text) === 0
            if (isEmpty) return actAll(model, [{ _tag: 'Select', selection: caret(blockId, 0) }, { _tag: 'InsertText', text: '/' }])
            const [id, editor] = freshId(model.editor)
            const placed = apply({ ...editor, doc: B.insertAfter(editor.doc, blockId, [B.paragraph(id)]) }, { _tag: 'Select', selection: caret(id, 0) })
            return commit(model, apply({ ...placed, undo: [...placed.undo, { doc: model.editor.doc, selection: model.editor.selection }] }, { _tag: 'InsertText', text: '/' }))
          }
          case 'add-in-toggle': {
            if (!model.isEditable) return { model }
            const [id, editor] = freshId(model.editor)
            return commit(model, apply({ ...editor, doc: B.appendChildren(editor.doc, blockId, [B.paragraph(id)]) }, { _tag: 'Select', selection: caret(id, 0) }))
          }
          case 'media-url': return model.isEditable ? { model: { ...model, overlay: { _tag: 'Prompt', field: 'url', blockId, value: 'url' in target.kind ? target.kind.url : '', active: 0 } } } : { model }
          case 'equation': return model.isEditable && target.kind._tag === 'Equation' ? { model: { ...model, overlay: { _tag: 'Prompt', field: 'tex', blockId, value: target.kind.tex, active: 0 } } } : { model }
          case 'table-add-row':
          case 'table-add-column': return model.isEditable && target.kind._tag === 'Table' ? act(model, { _tag: 'SetKind', blockId, kind: action === 'table-add-row' ? B.addRow(target.kind) : B.addColumn(target.kind) }) : { model }
          case 'callout-icon': return model.isEditable && target.kind._tag === 'Callout' ? { model: { ...model, overlay: { _tag: 'Prompt', field: 'icon', blockId, value: '', active: 0 } } } : { model }
          case 'code-copy': return target.kind._tag === 'Code' ? { model, commands: [CopyText({ text: T.plainText(target.text) })] } : { model }
          case 'code-language': return model.isEditable && target.kind._tag === 'Code' ? { model: { ...model, overlay: { _tag: 'Prompt', field: 'language', blockId, value: '', active: 0 } } } : { model }
          default: return { model }
        }
      },
      ClickedTool: ({ tool }) => {
        const mark = TOOL_MARKS[tool]
        if (mark !== undefined) return act(model, { _tag: 'ToggleMark', mark })
        if (tool === 'link') return step(model, Message.OpenedLink())
        if (tool === 'link-edit' || tool === 'link-copy' || tool === 'link-remove') {
          const spot = linkUnderCaret(model.editor.doc, model.editor.selection)
          if (spot === null) return { model }
          if (tool === 'link-copy') return { model, commands: [CopyText({ text: spot.url })] }
          if (!model.isEditable) return { model }
          const range: Selection = { _tag: 'TextSelection', anchor: { blockId: spot.blockId, offset: spot.from }, focus: { blockId: spot.blockId, offset: spot.to } }
          if (tool === 'link-edit') return commit(model, apply(model.editor, { _tag: 'Select', selection: range }), { _tag: 'Prompt', field: 'link', blockId: spot.blockId, value: spot.url, active: 0 })
          return actAll(model, [{ _tag: 'Select', selection: range }, { _tag: 'SetLink', url: null }, { _tag: 'Select', selection: model.editor.selection }])
        }
        if (tool === 'comment') return startComment(model)
        if (tool === 'color') return { model: { ...model, overlay: { _tag: 'ColorMenu', active: 0 } } }
        if (tool === 'turn') return step(model, Message.OpenedBlockMenu({ blockId: null }))
        return { model }
      },
      StartedComment: () => startComment(model),
      ClickedCommentMark: ({ threadId }) =>
        model.threads.includes(threadId) ? { model, commands: [Emit({ event: { _tag: 'OpenedComment', pageId: model.pageId, threadId } })] } : { model },
      StartedComposition: () => ({ model: { ...model, isComposing: true } }),
      Composed: ({ text }) => {
        const next = { ...model, isComposing: false, epoch: model.epoch + 1 }
        return text === '' ? commit(next, model.editor) : act(next, { _tag: 'InsertText', text })
      },
      PastedBlocks: ({ blocks }) => {
        let editor = model.editor
        const fresh = blocks.map(entry => B.copyWithIds(entry, () => {
          const [id, next] = freshId(editor)
          editor = next
          return id
        }))
        return act({ ...model, editor }, fresh.length === 1 && fresh[0] !== undefined && fresh[0].kind._tag === 'Paragraph' && fresh[0].children.length === 0
          ? { _tag: 'PasteText', text: T.caretText(fresh[0].text) }
          : { _tag: 'InsertBlocks', blocks: fresh })
      },
      Dropped: ({ ids, targetId, place }) => act(model, { _tag: 'Drop', ids, targetId, place }),
      ResizedImage: ({ blockId, width }) => {
        const target = B.find(model.editor.doc, blockId)
        const clamped = B.imageWidth(width)
        return target?.kind._tag === 'Image' && clamped !== null ? act(model, { _tag: 'SetKind', blockId, kind: { ...target.kind, width: clamped } }) : { model }
      },
      ReadDomSelection: ({ selection }) => act(model, { _tag: 'Select', selection }),
      Blurred: () => step(model, Message.DueSave({ seq: model.saveSeq })),
      DueSave: ({ seq }) =>
        seq !== model.saveSeq || model.editor.doc === model.saved || !model.isEditable
          ? { model }
          : { model: { ...model, saved: model.editor.doc }, commands: [Emit({ event: { _tag: 'ChangedContent', pageId: model.pageId, content: model.editor.doc } })] },
      CompletedEmit: () => ({ model }),
      CompletedSync: () => ({ model }),
    }),
  )

const SYNCED: ReadonlySet<Message['_tag']> = new Set(['CompletedEmit', 'CompletedSync', 'DueSave'])

/** Every input and every new prop is followed by a Sync: it mirrors the model for the DOM listeners and writes the selection back. */
export const update = (model: Model, message: Message): Update.Return<Model, Message> => {
  const result = step(model, message)
  if (SYNCED.has(message._tag)) return result
  const isAfterInput = message._tag === 'ReadDomSelection' || (MOUNT_TAGS as ReadonlyArray<string>).includes(message._tag)
  return { ...result, commands: [...(result.commands ?? []), Sync({ model: result.model, isAfterInput })] }
}

export const subscriptions = Subscription.make<Model, Message>()(_entry => ({
  props: Port.subscriptionEntry(ports.inbound.props, props => Message.ReceivedProps({ props })),
}))

// MOUNT: the DOM listeners live as long as the editor element.

const DROP_CLASS: Readonly<Record<B.DropPlace, string>> = { before: 'nb-drop-before', after: 'nb-drop-after', inside: 'nb-drop-after', left: 'nb-drop-left', right: 'nb-drop-right' }

const CLIPBOARD_TYPE = 'application/x-hypernotes'

const INPUTS: Readonly<Record<string, Action>> = {
  insertParagraph: { _tag: 'Enter' },
  insertLineBreak: { _tag: 'SoftBreak' },
  deleteContentBackward: { _tag: 'DeleteBackward', unit: 'char' },
  deleteWordBackward: { _tag: 'DeleteBackward', unit: 'word' },
  deleteSoftLineBackward: { _tag: 'DeleteBackward', unit: 'line' },
  deleteHardLineBackward: { _tag: 'DeleteBackward', unit: 'line' },
  deleteContentForward: { _tag: 'DeleteForward', unit: 'char' },
  deleteWordForward: { _tag: 'DeleteForward', unit: 'word' },
  deleteSoftLineForward: { _tag: 'DeleteForward', unit: 'line' },
  deleteHardLineForward: { _tag: 'DeleteForward', unit: 'line' },
  historyUndo: { _tag: 'Undo' },
  historyRedo: { _tag: 'Redo' },
  formatBold: { _tag: 'ToggleMark', mark: 'bold' },
  formatItalic: { _tag: 'ToggleMark', mark: 'italic' },
  formatUnderline: { _tag: 'ToggleMark', mark: 'underline' },
  formatStrikeThrough: { _tag: 'ToggleMark', mark: 'strike' },
}

/** The selected content: whole blocks, or the selected parts of text blocks. */
const selectedBlocks = (editor: EditorState): ReadonlyArray<Block> => {
  const { selection } = editor
  if (selection._tag === 'BlockSelection') return selection.ids.flatMap(id => B.find(editor.doc, id) ?? [])
  if (selection._tag !== 'TextSelection' || isCollapsed(selection)) return []
  const [start, end] = ordered(editor.doc, selection)
  return targetIds(editor).flatMap(id => {
    const found = B.find(editor.doc, id)
    if (found === null) return []
    const from = id === start.blockId ? start.offset : 0
    const to = id === end.blockId ? end.offset : T.lengthOf(found.text)
    return [{ ...found, text: T.slice(found.text, from, to), children: [] }]
  })
}

const plainOf = (blocks: ReadonlyArray<Block>): string =>
  blocks.flatMap(entry => [T.plainText(entry.text), ...B.visible(entry.children).map(child => T.plainText(child.block.text))]).join('\n')


const EditPage = Mount.defineStream('EditPage', {
  args: { pageId: S.String },
  messages: [Message.Acted, Message.PressedMenuKey, Message.TypedMenuChar, Message.HoveredMenuItem, Message.ChoseMenuItem, Message.OpenedLink, Message.StartedComment, Message.ClickedCommentMark, Message.ToggledCurrent, Message.OpenedBlockMenu, Message.ClickedControl, Message.ClickedTool, Message.StartedComposition, Message.Composed, Message.PastedBlocks, Message.Dropped, Message.ResizedImage, Message.Blurred],
  execute: ({ element, pageId }) =>
    Stream.callback<MountMessage>(queue =>
      Effect.gen(function* () {
        const host = element as HTMLElement
        const offer = (message: MountMessage): void => {
          pending.set(pageId, (pending.get(pageId) ?? 0) + 1)
          Queue.offerUnsafe(queue, message)
        }
        const root = (): HTMLElement | null => host.querySelector<HTMLElement>('[data-editor-root]')
        const state = (): Model | undefined => mirrors.get(pageId)
        const isStale = (): boolean => (pending.get(pageId) ?? 0) > 0
        const select = (): void => {
          if (isStale() || state()?.editor.selection._tag === 'BlockSelection') return
          const editorRoot = root()
          const selection = editorRoot === null ? null : readSelection(editorRoot)
          if (selection !== null) offer(Message.Acted({ action: { _tag: 'Select', selection } }))
        }
        // Block selections own the DOM selection until a person points into text again.
        let isPointing = false
        let resize: { blockId: string; x: number; width: number; side: number; frame: HTMLElement } | null = null
        let drag: { blockId: string; x: number; y: number; isDragging: boolean; target: Element | null; place: B.DropPlace } | null = null

        const listeners: ReadonlyArray<readonly [EventTarget, string, (event: Event) => void]> = [
          [host, 'beforeinput', event => {
            const input = event as InputEvent
            if (input.isComposing || input.inputType === 'insertCompositionText') return
            if (!host.contains(input.target as Node) || (input.target as Element).closest('[data-editor-root]') === null) return
            input.preventDefault()
            if (state()?.isEditable !== true) return
            select()
            const ranges = input.getTargetRanges()
            const range = ranges[0]
            if (input.inputType === 'insertReplacementText' && range !== undefined) {
              const text = input.dataTransfer?.getData('text/plain') ?? input.data ?? ''
              const editorRoot = root()
              const selection = editorRoot === null ? null : (() => {
                const staticRange = document.createRange()
                staticRange.setStart(range.startContainer, range.startOffset)
                staticRange.setEnd(range.endContainer, range.endOffset)
                const current = document.getSelection()
                current?.removeAllRanges()
                current?.addRange(staticRange)
                return readSelection(editorRoot)
              })()
              if (selection !== null) offer(Message.Acted({ action: { _tag: 'Select', selection } }))
              offer(Message.Acted({ action: { _tag: 'InsertText', text } }))
              return
            }
            if (input.inputType === 'insertText' && input.data !== null) return offer(Message.Acted({ action: { _tag: 'InsertText', text: input.data } }))
            const action = INPUTS[input.inputType]
            if (action !== undefined) offer(Message.Acted({ action }))
          }],
          [host, 'keydown', event => {
            const key = event as KeyboardEvent
            if (key.isComposing || key.keyCode === 229) return
            const model = state()
            if (model === undefined) return
            const editorState = model.editor
            const inEditor = (key.target as Element | null)?.closest?.('[data-editor-root]') !== null
            if (!inEditor && model.overlay._tag === 'Closed') return
            const result = keyResult(
              { key: key.key, mod: key.ctrlKey || key.metaKey, shift: key.shiftKey, alt: key.altKey },
              {
                menu: model.overlay._tag === 'BlockMenu' || model.overlay._tag === 'ColorMenu' ? 'block' : model.overlay._tag === 'Prompt' ? 'link' : editorState.menu._tag !== 'NoMenu' ? 'slash' : 'none',
                selection: editorState.selection._tag,
                isCollapsed: isCollapsed(editorState.selection),
              },
            )
            const move = MOVE_KEYS[key.key]
            if (result === null && move !== undefined && isStale() && !key.metaKey) {
              key.preventDefault()
              const [direction, granularity] = move
              queuedMoves.set(pageId, [...(queuedMoves.get(pageId) ?? []), [key.shiftKey ? 'extend' : 'move', direction, key.ctrlKey || key.altKey ? (granularity === 'character' ? 'word' : 'paragraph') : granularity]])
              return
            }
            if (result === null) return
            key.preventDefault()
            if (result._tag === 'Act' && result.action._tag !== 'Escape' && result.action._tag !== 'SelectAll') select()
            switch (result._tag) {
              case 'Act': return offer(Message.Acted({ action: result.action }))
              case 'MenuKey': return offer(Message.PressedMenuKey({ key: result.key }))
              case 'MenuChar': return offer(Message.TypedMenuChar({ char: result.char }))
              case 'OpenLink': return offer(Message.OpenedLink())
              case 'ToggleCurrent': return offer(Message.ToggledCurrent())
              case 'OpenBlockMenu': return offer(Message.OpenedBlockMenu({ blockId: null }))
              case 'Comment': return offer(Message.StartedComment())
            }
          }],
          [document, 'selectionchange', () => {
            const model = state()
            const editorRoot = root()
            if (model === undefined || model.isComposing || editorRoot === null || isStale()) return
            const current = document.getSelection()
            if (current === null || !editorRoot.contains(current.anchorNode)) return
            const selection = readSelection(editorRoot)
            if (selection === null || selection._tag !== 'TextSelection') return
            const known = model.editor.selection
            if (known._tag !== 'TextSelection' && !isPointing) return
            isPointing = false
            if (known._tag === 'TextSelection' && known.anchor.blockId === selection.anchor.blockId && known.anchor.offset === selection.anchor.offset && known.focus.blockId === selection.focus.blockId && known.focus.offset === selection.focus.offset) return
            offer(Message.Acted({ action: { _tag: 'Select', selection } }))
          }],
          [host, 'compositionstart', () => {
            select()
            offer(Message.StartedComposition())
          }],
          [host, 'compositionend', event => offer(Message.Composed({ text: (event as CompositionEvent).data }))],
          [host, 'paste', event => {
            const clip = (event as ClipboardEvent).clipboardData
            event.preventDefault()
            if (clip === null || state()?.isEditable !== true) return
            select()
            const custom = clip.getData(CLIPBOARD_TYPE)
            const decoded = custom === '' ? Option.none() : S.decodeUnknownOption(Document)((() => {
              try {
                return JSON.parse(custom) as unknown
              } catch {
                return null
              }
            })())
            if (Option.isSome(decoded)) return offer(Message.PastedBlocks({ blocks: decoded.value }))
            offer(Message.Acted({ action: { _tag: 'PasteText', text: clip.getData('text/plain') } }))
          }],
          ...(['copy', 'cut'] as const).map((name): readonly [EventTarget, string, (event: Event) => void] => [host, name, (event: Event) => {
            const model = state()
            const clip = (event as ClipboardEvent).clipboardData
            if (model === undefined || clip === null) return
            const blocks = selectedBlocks(model.editor)
            if (blocks.length === 0) return
            event.preventDefault()
            clip.setData('text/plain', plainOf(blocks))
            clip.setData(CLIPBOARD_TYPE, JSON.stringify(blocks))
            if (name === 'cut' && model.isEditable) offer(Message.Acted({ action: model.editor.selection._tag === 'BlockSelection' ? { _tag: 'DeleteBlocks' } : { _tag: 'DeleteBackward', unit: 'char' } }))
          }]),
          [host, 'mousedown', event => {
            const target = event.target as Element
            // Controls, tools and menu rows act on the selection: keep it.
            if (target.closest('[data-action], [data-tool], [data-menu-item]') !== null) event.preventDefault()
          }],
          [host, 'click', event => {
            const mouse = event as MouseEvent
            const target = mouse.target as Element
            const tool = target.closest('[data-tool]')
            if (tool !== null) return offer(Message.ClickedTool({ tool: tool.getAttribute('data-tool') ?? '' }))
            const entry = target.closest('[data-menu-item]')
            if (entry !== null) return offer(Message.ChoseMenuItem({ index: Number(entry.getAttribute('data-menu-item')) }))
            const control = target.closest('[data-action]')
            const action = control?.getAttribute('data-action') ?? ''
            // The handle opens its menu on pointerup (unless it dragged); its click must not close it.
            if (action === 'handle') return
            if (control !== null) return offer(Message.ClickedControl({ action, blockId: control.getAttribute('data-block') ?? '' }))
            const thread = target.closest('[data-comment-thread]')?.getAttribute('data-comment-thread')
            if (thread !== undefined && thread !== null) offer(Message.ClickedCommentMark({ threadId: thread }))
            const link = target.closest('a[data-link]')
            if (link !== null && (mouse.ctrlKey || mouse.metaKey)) window.open(link.getAttribute('href') ?? '', '_blank', 'noopener')
            if (target.closest('[data-overlay]') === null && state()?.overlay._tag !== 'Closed') offer(Message.PressedMenuKey({ key: 'escape' }))
          }],
          [host, 'mouseover', event => {
            const entry = (event.target as Element).closest('[data-menu-item]')
            if (entry !== null) offer(Message.HoveredMenuItem({ index: Number(entry.getAttribute('data-menu-item')) }))
          }],
          [host, 'pointerdown', event => {
            const pointer = event as PointerEvent
            isPointing = (pointer.target as Element).closest('[data-text-of]') !== null
            const edge = (pointer.target as Element).closest('[data-action="image-resize"]')
            const frame = edge?.closest<HTMLElement>('.nb-image-frame') ?? null
            if (edge !== null && frame !== null && pointer.button === 0) {
              pointer.preventDefault()
              resize = { blockId: edge.getAttribute('data-block') ?? '', x: pointer.clientX, width: frame.getBoundingClientRect().width, side: edge.getAttribute('data-side') === 'left' ? -1 : 1, frame }
              return
            }
            const grip = (pointer.target as Element).closest('[data-action="handle"]')
            if (grip === null || pointer.button !== 0) return
            pointer.preventDefault()
            drag = { blockId: grip.getAttribute('data-block') ?? '', x: pointer.clientX, y: pointer.clientY, isDragging: false, target: null, place: 'after' }
          }],
          [document, 'pointermove', event => {
            const pointer = event as PointerEvent
            if (resize !== null) {
              // Images are centered, so an edge moves half of the change in width.
              resize.frame.style.width = `${B.imageWidth(resize.width + resize.side * 2 * (pointer.clientX - resize.x)) ?? resize.width}px`
              return
            }
            if (drag === null) return
            if (!drag.isDragging && Math.hypot(pointer.clientX - drag.x, pointer.clientY - drag.y) < 4) return
            drag.isDragging = true
            host.classList.add('nb-dragging')
            drag.target?.classList.remove('nb-drop-before', 'nb-drop-after', 'nb-drop-left', 'nb-drop-right')
            const over = blockAt(pointer.clientX, pointer.clientY)
            if (over === null || !host.contains(over) || over.closest(`[data-block-id="${CSS.escape(drag.blockId)}"]`) !== null) {
              drag.target = null
              return
            }
            const rect = over.getBoundingClientRect()
            drag.place = pointer.clientX < rect.left + 24 ? 'left' : pointer.clientX > rect.right - 24 ? 'right' : pointer.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
            drag.target = over
            over.classList.add(DROP_CLASS[drag.place])
          }],
          [document, 'pointerup', () => {
            if (resize !== null) {
              const { blockId, frame } = resize
              resize = null
              return offer(Message.ResizedImage({ blockId, width: frame.getBoundingClientRect().width }))
            }
            if (drag === null) return
            const { blockId, isDragging, target, place } = drag
            drag = null
            host.classList.remove('nb-dragging')
            target?.classList.remove('nb-drop-before', 'nb-drop-after', 'nb-drop-left', 'nb-drop-right')
            if (!isDragging) return offer(Message.OpenedBlockMenu({ blockId }))
            const targetId = target?.getAttribute('data-block-id')
            const selection = state()?.editor.selection
            const ids = selection?._tag === 'BlockSelection' && selection.ids.includes(blockId) ? selection.ids : [blockId]
            if (targetId !== undefined && targetId !== null) offer(Message.Dropped({ ids, targetId, place }))
          }],
          [host, 'focusout', event => {
            if (!host.contains((event as FocusEvent).relatedTarget as Node | null)) offer(Message.Blurred())
          }],
        ]
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const editorRoot = root()
            if (editorRoot !== null) roots.set(pageId, editorRoot)
            for (const [target, name, listener] of listeners) target.addEventListener(name, listener)
          }),
          () =>
            Effect.sync(() => {
              roots.delete(pageId)
              mirrors.delete(pageId)
              pending.delete(pageId)
              written.delete(pageId)
              writtenDocs.delete(pageId)
              queuedMoves.delete(pageId)
              for (const [target, name, listener] of listeners) target.removeEventListener(name, listener)
            }),
        )
        return yield* Effect.never
      }),
    ),
})

// VIEW

const menuRow = (h: HtmlBuilder<Message>, index: number, active: number, label: string, hint = '', description = ''): Html =>
  h.div([h.Class((index === active ? 'nb-menu-item nb-active' : 'nb-menu-item')), h.Attribute('data-menu-item', String(index)), h.Attribute('role', 'option'), h.Attribute('aria-selected', String(index === active))], [
    h.span([h.Class('nb-menu-label')], [label]),
    ...(description === '' ? [] : [h.span([h.Class('nb-menu-description')], [description])]),
    ...(hint === '' ? [] : [h.span([h.Class('nb-menu-hint')], [hint])]),
  ])

const panel = (h: HtmlBuilder<Message>, name: string, children: ReadonlyArray<Html>, side: 'top' | 'bottom' = 'bottom'): Html =>
  h.div([h.Class(`nb-overlay ${name}`), h.Attribute('data-overlay', name), h.Attribute('role', 'listbox'), h.Style(anchoredStyle(ANCHOR, { side }))], [...children])

const overlayView = (model: Model, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const { overlay, editor } = model
  if (overlay._tag === 'BlockMenu') {
    const items = blockMenuItems(overlay.query)
    return [panel(h, 'nb-block-menu', [
      h.div([h.Class('nb-menu-search')], [overlay.query === '' ? 'Search actions…' : overlay.query]),
      ...(items.length === 0 ? [h.div([h.Class('nb-menu-empty')], ['No results'])] : items.map((entry, index) => menuRow(h, index, overlay.active, entry.label, entry.shortcut))),
    ])]
  }
  if (overlay._tag === 'ColorMenu') {
    return [panel(h, 'nb-color-menu', COLORS.map((color, index) =>
      h.div([h.Class((index === overlay.active ? 'nb-menu-item nb-active' : 'nb-menu-item')), h.Attribute('data-menu-item', String(index))], [
        h.span([h.Class(['nb-swatch', colorClass(color)].join(' '))], ['A']),
        h.span([h.Class('nb-menu-label')], [blockMenuItems('').find(entry => entry._tag === 'Color' && entry.color === color)?.label ?? color]),
      ])), 'top')]
  }
  if (overlay._tag === 'Prompt') {
    const title = { link: 'Paste link or search pages', url: 'Paste a link', tex: 'TeX equation', language: 'Language', page: 'Link to page', icon: 'Search emoji' }[overlay.field]
    const pages = overlay.field === 'page' ? visiblePages(model, overlay.value) : []
    const links = overlay.field === 'link' ? linkChoices(overlay.value, model.pages, model.pageId) : []
    const languages = overlay.field === 'language' ? languageChoices(overlay.value) : []
    const icons = overlay.field === 'icon' ? iconChoices(overlay.value) : []
    return [panel(h, 'nb-prompt', [
      h.div([h.Class('nb-menu-heading')], [title]),
      h.div([h.Class('nb-menu-search nb-prompt-value'), h.Attribute('data-prompt', overlay.field)], [overlay.value === '' ? '…' : overlay.value]),
      ...pages.map((page, index) => menuRow(h, index, overlay.active, `${iconText(page.icon)} ${page.title || 'Untitled'}`.trim())),
      ...links.flatMap((choice, index) => [
        ...(choice.group !== links[index - 1]?.group ? [h.div([h.Class('nb-menu-heading')], [choice.group])] : []),
        menuRow(h, index, overlay.active, choice.label, choice.group === 'Link' ? 'Link' : ''),
      ]),
      ...languages.map((language, index) => menuRow(h, index, overlay.active, language)),
      ...icons.map((entry, index) => menuRow(h, index, overlay.active, `${entry.char} ${entry.name}`)),
      h.div([h.Class('nb-menu-hint')], ['Enter to confirm, Esc to close']),
    ])]
  }
  if (editor.menu._tag === 'SlashMenu') {
    const items = slashItems(editor.menu.query)
    const active = editor.menu.active
    const groups = [...new Set(items.map(entry => entry.group))]
    return [panel(h, 'nb-slash-menu', items.length === 0 ? [h.div([h.Class('nb-menu-empty')], ['No results'])] : groups.flatMap(group => [
      h.div([h.Class('nb-menu-heading')], [group]),
      ...items.flatMap((entry, index) => (entry.group === group ? [menuRow(h, index, active, entry.label, entry.shortcut, entry.description)] : [])),
    ]))]
  }
  if (editor.menu._tag === 'InlineMenu') {
    const items = inlineItems(model, editor.menu)
    const active = editor.menu.active
    const groups = [...new Set(items.map(entry => entry.group))]
    const body = items.length === 0 ? [h.div([h.Class('nb-menu-empty')], ['No results'])] : groups.flatMap(group => [
      h.div([h.Class('nb-menu-heading')], [group]),
      ...items.flatMap((entry, index) => (entry.group === group ? [menuRow(h, index, active, entry.label, entry.hint)] : [])),
    ])
    return [editor.menu.trigger === '@' ? panel(h, 'nb-mention-menu', body) : panel(h, 'nb-emoji-menu', body)]
  }
  const { selection } = editor
  const tool = (name: string, label: string, isOn = false): Html => h.span([h.Class(['nb-tool', TOOL_CLASS[name] ?? '', isOn ? 'nb-on' : ''].join(' ')), h.Attribute('data-tool', name), h.Attribute('role', 'button'), h.Attribute('aria-label', label)], [label])
  if (model.isEditable && selection._tag === 'TextSelection' && !isCollapsed(selection)) {
    const [start, end] = ordered(editor.doc, selection)
    const text = B.find(editor.doc, start.blockId)?.text ?? []
    const same = start.blockId === end.blockId
    const has = (mark: ToggleMark) => same && T.hasMark(text, start.offset, end.offset, mark)
    return [panel(h, 'nb-toolbar', [
      tool('turn', 'Turn into'), tool('link', 'Link', same && T.linkAt(text, start.offset, end.offset) !== null), ...(same && B.find(editor.doc, start.blockId) !== null ? [tool('comment', 'Comment')] : []),
      tool('bold', 'B', has('bold')), tool('italic', 'i', has('italic')), tool('underline', 'U', has('underline')), tool('strike', 'S', has('strike')), tool('code', '</>', has('code')), tool('color', 'A'),
    ], 'top')]
  }
  const spot = linkUnderCaret(editor.doc, selection)
  if (spot !== null) {
    return [panel(h, 'nb-link-card', [
      h.span([h.Class('nb-link-url')], [link({ children: [spot.url], href: spot.url, target: spot.url.startsWith('/') ? '_self' : '_blank', color: 'secondary', hasUnderline: true, maxLines: 1 }, h)]),
      ...(model.isEditable ? [tool('link-edit', 'Edit')] : []),
      tool('link-copy', 'Copy'),
      ...(model.isEditable ? [tool('link-remove', 'Remove')] : []),
    ])]
  }
  return []
}

const anchorOf = (model: Model): string | null => {
  const { overlay, editor } = model
  if (overlay._tag === 'BlockMenu' || overlay._tag === 'Prompt') return B.ownerId(overlay.blockId)
  if (editor.menu._tag !== 'NoMenu') return B.ownerId(editor.menu.blockId)
  if (editor.selection._tag === 'TextSelection') return B.ownerId(ordered(editor.doc, editor.selection)[0].blockId)
  return null
}

export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { editor } = model
  const selected = editor.selection._tag === 'BlockSelection' ? editor.selection.ids : []
  const focused = editor.selection._tag === 'TextSelection' ? editor.selection.focus.blockId : null
  const ctx = context(model, selected, focused, anchorOf(model), model.epoch)
  return h.div([h.Class('nb-editor-host'), h.OnMount(EditPage({ pageId: model.pageId }))], [
    h.div([
      h.Class((selected.length > 0 ? 'nb-editor nb-has-block-selection' : 'nb-editor')),
      h.Attribute('data-editor-root', ''),
      h.Attribute('contenteditable', model.isEditable ? 'true' : 'false'),
      h.Attribute('spellcheck', 'true'),
      h.Attribute('role', 'textbox'),
      h.Attribute('aria-multiline', 'true'),
      h.Attribute('aria-label', 'Page content'),
      h.Attribute('tabindex', '0'),
    ], [...renderDocument(editor.doc, ctx, h)]),
    ...overlayView(model, h),
  ])
}

// PROGRAM

export const makePageEditor = (container: HTMLElement, props: EditorProps) =>
  Runtime.makeElement({ Model, Flags: EditorProps, flags: Effect.succeed(props), init, update, view, subscriptions, ports, container })

export { hasText, type Selection }
