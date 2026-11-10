import { Option, Schema as S } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import * as Icon from '@/lib/icon'
import { cn } from '@/lib/utils'
import { button } from '@/ui/button'

import { Cover, Font, type Page } from '../domain'
import { hash } from '../emoji'
import { box } from '../view/design'
import { pageIcon } from '../view/icons'
import type { PagePatch } from '../workspace'

/* The page header, Notion's way: a cover across the top, the big icon
   overlapping it, and "Add icon" / "Add cover" that appear on hover while
   either is missing. The ••• menu in the top bar holds the page's style
   (font, small text, full width) and its lock. */

export const ICON_ANCHOR = '--page-icon'
export const COVER_ANCHOR = '--page-cover'
export const OPTIONS_ANCHOR = '--page-options'

export const COVERS = [
  { name: 'gradient-1', label: 'Sunrise', group: 'Gradients' },
  { name: 'gradient-2', label: 'Ocean', group: 'Gradients' },
  { name: 'gradient-3', label: 'Forest', group: 'Gradients' },
  { name: 'gradient-4', label: 'Dusk', group: 'Gradients' },
  { name: 'red', label: 'Red', group: 'Colors' },
  { name: 'yellow', label: 'Yellow', group: 'Colors' },
  { name: 'green', label: 'Green', group: 'Colors' },
  { name: 'blue', label: 'Blue', group: 'Colors' },
  { name: 'purple', label: 'Purple', group: 'Colors' },
  { name: 'gray', label: 'Gray', group: 'Colors' },
] as const

const COVER_CLASS: Readonly<Record<string, string>> = {
  'gradient-1': 'bg-linear-to-r from-[#f6d365] to-[#fda085]',
  'gradient-2': 'bg-linear-to-r from-[#4facfe] to-[#00f2fe]',
  'gradient-3': 'bg-linear-to-r from-[#43e97b] to-[#38f9d7]',
  'gradient-4': 'bg-linear-to-r from-[#667eea] to-[#764ba2]',
  red: 'bg-[#e16259]',
  yellow: 'bg-[#dfab01]',
  green: 'bg-[#0f7b6c]',
  blue: 'bg-[#0b6e99]',
  purple: 'bg-[#6940a5]',
  gray: 'bg-[#9b9a97]',
}

export const isCoverName = (name: string): boolean => COVERS.some(cover => cover.name === name)

/** A stable pick for "Add cover": the same page and moment give the same cover. */
export const pickCover = (seed: string): string => COVERS[hash(seed) % COVERS.length]?.name ?? 'gradient-1'

/** An image cover: https only, and nothing that could end the CSS string. */
export const isCoverUrl = (url: string): boolean => /^https:\/\/[^\s"'()\\]{1,2000}$/.test(url)

/** One change to the page's look, each a field of `Workspace.updatePage`. */
export const PageChange = S.Union([
  S.TaggedStruct('SetIcon', { icon: S.String }),
  S.TaggedStruct('SetCover', { cover: Cover }),
  S.TaggedStruct('SetCoverPosition', { position: S.Number }),
  S.TaggedStruct('SetFont', { font: Font }),
  S.TaggedStruct('SetSmallText', { isOn: S.Boolean }),
  S.TaggedStruct('SetFullWidth', { isOn: S.Boolean }),
  S.TaggedStruct('SetLocked', { isOn: S.Boolean }),
])
export type PageChange = typeof PageChange.Type

export const patchOf = (change: PageChange): PagePatch => {
  switch (change._tag) {
    case 'SetIcon': return { icon: change.icon }
    case 'SetCover': return { cover: change.cover }
    case 'SetCoverPosition': return { coverPosition: coverPosition(change.position) }
    case 'SetFont': return { font: change.font }
    case 'SetSmallText': return { isSmallText: change.isOn }
    case 'SetFullWidth': return { isFullWidth: change.isOn }
    case 'SetLocked': return { isLocked: change.isOn }
  }
}

const FONT_CLASS: Readonly<Record<Font, string>> = { default: '', serif: 'font-serif', mono: 'font-mono' }

export const fontClass = (font: Font): string => FONT_CLASS[font]

export type HeaderActions<Msg> = Readonly<{
  onAddIcon: Msg
  onIcon: Msg
  onAddCover: Msg
  onCover: Msg
  onRemoveCover: Msg
  onReposition: Msg
  onMoveCover: (position: number) => Msg
  onSaveCover: Msg
  onCancelCover: Msg
  onAddComment: Msg
}>

/** How far down an image cover shows, 0 (its top) to 100 (its bottom). */
export const coverPosition = (position: number): number => Math.round(Math.min(100, Math.max(0, position)))

const CoverDetail = S.Struct({ position: S.Number })

/** The cover's listener for the image dragged in the browser (public/cover-reposition.js). */
const onMoveCover = <Msg>(move: (position: number) => Msg): Attribute<Msg> => ({
  _tag: 'OnCustomEvent',
  name: 'hypercover',
  f: (event: CustomEvent<unknown>) => Option.map(S.decodeUnknownOption(CoverDetail)(event.detail), detail => move(detail.position)),
})

/** The cover band, with "Change cover", "Reposition" (image covers) and
    "Remove" on hover. While `draft` is set the image drags up and down,
    and "Save position" keeps where it is. */
export const coverView = <Msg>(page: Page, isEditable: boolean, actions: HeaderActions<Msg>, h: HtmlBuilder<Msg>, draft: number | null = null): ReadonlyArray<Html> => {
  const { cover } = page
  if (cover._tag === 'NoCover') return []
  const look = cover._tag === 'GalleryCover' ? COVER_CLASS[cover.name] ?? COVER_CLASS['gray'] : 'bg-muted bg-cover'
  const isImage = cover._tag === 'ImageCover' && isCoverUrl(cover.url)
  const isRepositioning = isEditable && isImage && draft !== null
  const position = isRepositioning ? draft : page.coverPosition
  const controls = isRepositioning
    ? [
        box({ class: 'pointer-events-none absolute inset-0 flex items-center justify-center', children: [box({ as: 'span', class: 'rounded-md bg-foreground/60 px-3 py-1 text-[13px] text-background', children: ['Drag image to reposition'] }, h)] }, h),
        box({ class: 'absolute right-4 bottom-3 flex gap-1', children: [
            button({ variant: 'outline', size: 'compact', id: 'save-cover-position', onClick: actions.onSaveCover, children: ['Save position'] }, h),
            button({ variant: 'outline', size: 'compact', id: 'cancel-cover-position', onClick: actions.onCancelCover, children: ['Cancel'] }, h),
          ] }, h),
      ]
    : [box({ class: 'absolute right-4 bottom-3 flex gap-1 opacity-0 transition-opacity group-hover/cover:opacity-100 focus-within:opacity-100', style: { anchorName: COVER_ANCHOR }, children: [
        button({ variant: 'outline', size: 'compact', id: 'change-cover', onClick: actions.onCover, children: ['Change cover'] }, h),
        ...(isImage ? [button({ variant: 'outline', size: 'compact', id: 'reposition-cover', onClick: actions.onReposition, children: ['Reposition'] }, h)] : []),
        button({ variant: 'outline', size: 'compact', id: 'remove-cover', onClick: actions.onRemoveCover, children: ['Remove'] }, h),
      ] }, h)]
  return [box({ class: cn('group/cover relative h-[30vh] max-h-[280px] min-h-[120px] w-full shrink-0', look, isRepositioning && 'cursor-move'), style: isImage ? { backgroundImage: `url("${cover.url}")`, backgroundPosition: `center ${position}%` } : undefined, attributes: [
      h.Id('page-cover'),
      h.DataAttribute('cover', cover._tag === 'GalleryCover' ? cover.name : 'image'),
      h.DataAttribute('cover-position', String(position)),
      ...(isRepositioning ? [h.DataAttribute('reposition-cover', ''), onMoveCover(actions.onMoveCover)] : []),
    ], children: isEditable ? controls : [] }, h)]
}

/** The big icon (a button that opens the picker) and the hover row of what is missing. */
export const iconAndControls = <Msg>(page: Page, isEditable: boolean, canComment: boolean, actions: HeaderActions<Msg>, h: HtmlBuilder<Msg>): ReadonlyArray<Html> => {
  const hasCover = page.cover._tag !== 'NoCover'
  const icon = page.icon === ''
    ? []
    : [box({ class: cn('relative mb-1 w-fit', hasCover && '-mt-[42px]'), style: { anchorName: ICON_ANCHOR }, children: [
        isEditable
          ? button({ variant: 'ghost', size: 'icon-page', id: 'page-icon', ariaLabel: 'Change icon', title: 'Change icon', onClick: actions.onIcon, children: [pageIcon(page.icon, h, 'lg')] }, h)
          : box({ attributes: [h.Id('page-icon')], children: [pageIcon(page.icon, h, 'lg')] }, h),
      ] }, h)]
  const missing = [
    ...(page.icon === '' ? [button({ variant: 'ghost', size: 'compact', id: 'add-icon', onClick: actions.onAddIcon, children: [Icon.icon('smile', { class: 'size-3.5' }, h), 'Add icon'] }, h)] : []),
    ...(hasCover ? [] : [button({ variant: 'ghost', size: 'compact', id: 'add-cover', onClick: actions.onAddCover, children: [Icon.icon('image', { class: 'size-3.5' }, h), 'Add cover'] }, h)]),
  ]
  const comment = canComment ? [button({ variant: 'ghost', size: 'compact', id: 'add-comment', onClick: actions.onAddComment, children: [Icon.icon('message-square', { class: 'size-3.5' }, h), 'Add comment'] }, h)] : []
  return [
    ...icon,
    box({ class: 'flex h-7 gap-1 text-muted-foreground opacity-0 transition-opacity group-hover/header:opacity-100 focus-within:opacity-100', attributes: [h.Id('header-controls')], style: { anchorName: page.icon === '' ? ICON_ANCHOR : 'none' }, children: [...(isEditable ? missing : []), ...comment] }, h),
  ]
}
