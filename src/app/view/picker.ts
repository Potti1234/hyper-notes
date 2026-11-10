import { Option, Schema as S } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { input } from '@/ui/input'
import { kbd } from '@/ui/kbd'
import { cn } from '@/lib/utils'
import { anchoredStyle } from '@/lib/anchored'
import * as Icon from '@/lib/icon'
import { box, optionRow } from '@/app/view/design'

/* The picker: a small filterable menu, used for page menus, "Move to", the
   search palette, the icon and cover pickers and the page's ••• options.

   Its state lives in the page's Model (open, field, query, active row), so it
   works the same from a click on a property button and from a keyboard
   shortcut. It is drawn after everything else on the page: anchored to the
   trigger with CSS anchor positioning (src/lib/anchored.ts: no measuring, and
   it flips to stay on screen), or
   centered like a command menu when opened from the keyboard.

   crease's `command` is the visual source (classes, spacing). It is not used
   directly: on the server its Enter key does nothing (EXPERIMENT.md, F2). */

export const PickerField = S.Literals(['page', 'move', 'search', 'icon', 'cover', 'options', 'property', 'propertyType', 'addProperty', 'cell', 'cells', 'view', 'addView'])
export type PickerField = typeof PickerField.Type

export const Picker = S.Struct({
  field: PickerField,
  /** The page the choice applies to ('' for the search palette). */
  pageId: S.String,
  query: S.String,
  active: S.Number,
  /** CSS anchor name of the trigger; null centers the picker. */
  anchor: S.NullOr(S.String),
})
export type Picker = typeof Picker.Type

export type PickerItem = Readonly<{
  value: string
  label: string
  group?: string
  /** Shown as a checkbox (multi-select fields) or a check mark. */
  isChecked?: boolean
  shortcut?: string
  /** Extra words the filter matches. */
  keywords?: string
  /** Muted text after the label, such as where a page lives. */
  hint?: string
  /** A line under the label with the matching words highlighted. */
  detail?: Readonly<{ before: string; match: string; after: string }>
}>

export const isMultiSelect = (field: PickerField): boolean => field === 'cells'

export const placeholder: Readonly<Record<PickerField, string>> = {
  page: 'Search actions…',
  move: 'Move page to…',
  search: 'Search pages…',
  icon: 'Filter…',
  cover: 'Search covers or paste an https:// image link…',
  options: 'Search actions…',
  property: 'Search actions…',
  propertyType: 'Search for a type…',
  addProperty: 'Search for a type…',
  cell: 'Search for an option…',
  cells: 'Search for an option…',
  view: 'Type a new name…',
  addView: 'Search layouts…',
}

/** Index of the first checked item: where a single-choice picker starts. */
export const checkedIndex = (items: ReadonlyArray<PickerItem>): number => Math.max(0, items.findIndex(item => item.isChecked === true))

export const open = (field: PickerField, pageId: string, anchor: string | null, active = 0): Picker => ({ field, pageId, query: '', active, anchor })

export const filterItems = (items: ReadonlyArray<PickerItem>, query: string): ReadonlyArray<PickerItem> => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  if (words.length === 0) return items
  return items.filter(item => {
    const text = `${item.label} ${item.group ?? ''} ${item.keywords ?? ''}`.toLowerCase()
    return words.every(word => text.includes(word))
  })
}

/** A key pressed in the picker's input. `move` changes the active row;
 *  `choose` picks it; `close` dismisses. */
export type PickerKey = Readonly<{ _tag: 'move'; active: number } | { _tag: 'choose'; value: string } | { _tag: 'close' } | { _tag: 'none' }>

export const keyAction = (picker: Picker, items: ReadonlyArray<PickerItem>, key: string): PickerKey => {
  const visible = filterItems(items, picker.query)
  const count = visible.length
  const active = Math.min(picker.active, Math.max(0, count - 1))
  switch (key) {
    case 'ArrowDown':
      return count === 0 ? { _tag: 'none' } : { _tag: 'move', active: (active + 1) % count }
    case 'ArrowUp':
      return count === 0 ? { _tag: 'none' } : { _tag: 'move', active: (active - 1 + count) % count }
    case 'Home':
      return { _tag: 'move', active: 0 }
    case 'End':
      return { _tag: 'move', active: Math.max(0, count - 1) }
    case 'Enter': {
      const item = visible[active]
      return item === undefined ? { _tag: 'none' } : { _tag: 'choose', value: item.value }
    }
    case 'Escape':
      return { _tag: 'close' }
    default: {
      const value = picker.query === '' ? shortcutValue(items, key) : undefined
      return value === undefined ? { _tag: 'none' } : { _tag: 'choose', value }
    }
  }
}

const PICKER_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape'])

/** Items with a number shortcut (status 1–6, priority 0–4) are chosen by
 *  pressing it, while nothing has been typed into the filter. */
const numberKey = (picker: Picker, items: ReadonlyArray<PickerItem>, key: string): boolean =>
  picker.query === '' && /^[0-9]$/.test(key) && items.some(item => item.shortcut === key)

export const shortcutValue = (items: ReadonlyArray<PickerItem>, key: string): string | undefined =>
  items.find(item => item.shortcut === key)?.value

export type PickerViewProps<Msg> = Readonly<{
  picker: Picker
  items: ReadonlyArray<PickerItem>
  /** Icon for an item (status circle, avatar, label dot…). */
  itemIcon: (item: PickerItem) => Html | undefined
  onQuery: (query: string) => Msg
  onKey: (key: string) => Msg
  onChoose: (value: string) => Msg
  onClose: Msg
  title?: string
}>

export const PICKER_INPUT_ID = 'picker-input'

export const pickerView = <Msg>(props: PickerViewProps<Msg>, h: HtmlBuilder<Msg>): Html => {
  const { picker } = props
  const visible = filterItems(props.items, picker.query)
  const active = Math.min(picker.active, Math.max(0, visible.length - 1))
  const isCentered = picker.anchor === null
  const multi = isMultiSelect(picker.field)

  const rows: Array<Html> = []
  let group: string | undefined
  visible.forEach((item, index) => {
    if (item.group !== undefined && item.group !== group) {
      group = item.group
      rows.push(box({ class: 'px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground', children: [item.group] }, h))
    }
    const icon = props.itemIcon(item)
    rows.push(
      optionRow({ id: `picker-item-${index}`, value: item.value, isActive: index === active, onClick: props.onChoose(item.value), children: [
          ...(multi
            ? [
                box({ as: 'span', class: cn(
                        'flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border',
                        item.isChecked === true ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                      ), children: item.isChecked === true ? [Icon.check({ class: 'size-3' }, h)] : [] }, h),
              ]
            : []),
          ...(icon === undefined ? [] : [box({ as: 'span', class: 'flex w-4 shrink-0 justify-center text-muted-foreground', children: [icon] }, h)]),
          item.detail === undefined && item.hint === undefined
            ? box({ as: 'span', class: 'min-w-0 flex-1 truncate', children: [item.label] }, h)
            : box({ as: 'span', class: 'flex min-w-0 flex-1 flex-col', children: [
                box({ as: 'span', class: 'flex min-w-0 items-baseline gap-2', children: [
                  box({ as: 'span', class: 'min-w-0 shrink-0 truncate', children: [item.label] }, h),
                  ...(item.hint === undefined ? [] : [box({ as: 'span', class: 'min-w-0 truncate text-[12px] text-muted-foreground', attributes: [h.DataAttribute('picker-hint', '')], children: [item.hint] }, h)]),
                ] }, h),
                ...(item.detail === undefined ? [] : [box({ as: 'span', class: 'min-w-0 truncate text-[12px] text-muted-foreground', attributes: [h.DataAttribute('picker-detail', '')], children: [
                  item.detail.before,
                  box({ as: 'span', class: 'rounded-sm bg-accent font-medium text-foreground', attributes: [h.DataAttribute('picker-match', '')], children: [item.detail.match] }, h),
                  item.detail.after,
                ] }, h)]),
              ] }, h),
          ...(!multi && item.isChecked === true ? [Icon.check({ class: 'size-4 text-muted-foreground' }, h)] : []),
          ...(item.shortcut === undefined ? [] : [kbd({ children: [item.shortcut] }, h)]),
        ] }, h),
    )
  })

  const panel = box({ class: cn(
          'z-50 flex flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-[0_8px_30px_rgb(0_0_0/0.12)]',
          isCentered ? 'fixed top-[14vh] left-1/2 w-[min(640px,calc(100vw-32px))] -translate-x-1/2' : 'w-64',
        ), attributes: [h.Id('picker'), h.Role('dialog'), h.AriaLabel(props.title ?? placeholder[picker.field]), h.DataAttribute('field', picker.field), ], // Below the trigger, flipping to stay on screen (src/lib/anchored.ts).
        style: isCentered || picker.anchor === null ? undefined : anchoredStyle(picker.anchor), children: [
      ...(isCentered && props.title !== undefined
        ? [box({ class: 'px-4 pt-3 text-[11px] font-medium text-muted-foreground', children: [props.title] }, h)]
        : []),
      box({ class: cn('flex items-center border-b', isCentered ? 'px-2' : 'px-1'), children: [
          input(
            {
              id: PICKER_INPUT_ID,
              value: picker.query,
              placeholder: placeholder[picker.field],
              ariaLabel: placeholder[picker.field],
              autocomplete: 'off',
              role: 'combobox',
              onInput: props.onQuery,
              variant: isCentered ? 'inline-lg' : 'inline',
            },
            h,
          ),
        ] }, h),
      box({ class: cn('min-h-0 overflow-y-auto p-1', isCentered ? 'max-h-[360px]' : 'max-h-[300px]'), attributes: [h.Role('listbox'), h.AriaLabel(placeholder[picker.field])], children: visible.length === 0 ? [box({ class: 'px-2 py-6 text-center text-[13px] text-muted-foreground', children: ['No results'] }, h)] : rows }, h),
    ] }, h)

  return box({ class: 'contents', attributes: [h.Id('picker-layer')], children: [
      box({ class: cn('fixed inset-0 z-40', isCentered ? 'bg-black/20 dark:bg-black/40' : ''), attributes: [h.AriaHidden(true), h.OnClick(props.onClose)], children: [] }, h),
      // The key handler goes on the panel: keys typed in the input bubble to it.
      box({ class: 'contents', attributes: [h.OnKeyDownPreventDefault(key =>
            PICKER_KEYS.has(key) || numberKey(picker, props.items, key) ? Option.some(props.onKey(key)) : Option.none(),
          )], children: [panel] }, h),
    ] }, h)
}
