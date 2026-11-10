import type { Action } from './state'
import type { ToggleMark } from './schema'

/* Keyboard shortcuts, as Notion binds them (Ctrl on Windows/Linux, Cmd on
   macOS). Text input, Enter and Backspace in text arrive as `beforeinput`;
   these are the keys that do not. Pure, so the browser listener only asks
   "is this ours?" and prevents the default when it is. */

export type KeyInput = Readonly<{ key: string; mod: boolean; shift: boolean; alt: boolean }>
export type KeyContext = Readonly<{ menu: 'none' | 'slash' | 'block' | 'link'; selection: 'TextSelection' | 'BlockSelection' | 'NoSelection'; isCollapsed: boolean }>

export type KeyResult =
  | Readonly<{ _tag: 'Act'; action: Action }>
  | Readonly<{ _tag: 'MenuKey'; key: 'up' | 'down' | 'enter' | 'escape' | 'backspace' }>
  | Readonly<{ _tag: 'MenuChar'; char: string }>
  | Readonly<{ _tag: 'OpenLink' }>
  | Readonly<{ _tag: 'ToggleCurrent' }>
  | Readonly<{ _tag: 'OpenBlockMenu' }>
  | Readonly<{ _tag: 'Comment' }>

const act = (action: Action): KeyResult => ({ _tag: 'Act', action })

const MARKS: Readonly<Record<string, ToggleMark>> = { b: 'bold', i: 'italic', u: 'underline', e: 'code' }

/** Ctrl+Alt+0…9: turn into text, heading 1–3, to-do, bullet, number, toggle, code, page. */
const TURN_KEYS: Readonly<Record<string, Extract<Action, { _tag: 'TurnInto' }>>> = {
  '0': { _tag: 'TurnInto', tag: 'Paragraph', level: 1 },
  '1': { _tag: 'TurnInto', tag: 'Heading', level: 1 },
  '2': { _tag: 'TurnInto', tag: 'Heading', level: 2 },
  '3': { _tag: 'TurnInto', tag: 'Heading', level: 3 },
  '4': { _tag: 'TurnInto', tag: 'Todo', level: 1 },
  '5': { _tag: 'TurnInto', tag: 'Bulleted', level: 1 },
  '6': { _tag: 'TurnInto', tag: 'Numbered', level: 1 },
  '7': { _tag: 'TurnInto', tag: 'Toggle', level: 1 },
  '8': { _tag: 'TurnInto', tag: 'Code', level: 1 },
}

const MENU_KEYS: Readonly<Record<string, 'up' | 'down' | 'enter' | 'escape' | 'backspace'>> = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'enter', Tab: 'enter', Escape: 'escape', Backspace: 'backspace' }

export const keyResult = (input: KeyInput, context: KeyContext): KeyResult | null => {
  const { key, mod, shift, alt } = input
  const lower = key.toLowerCase()
  if (context.menu === 'block' || context.menu === 'link') {
    const menuKey = MENU_KEYS[key]
    if (menuKey !== undefined && !(key === 'Tab')) return { _tag: 'MenuKey', key: menuKey }
    return !mod && key.length === 1 ? { _tag: 'MenuChar', char: key } : null
  }
  if (context.menu === 'slash') {
    const menuKey = MENU_KEYS[key]
    if (menuKey !== undefined && menuKey !== 'backspace' && !shift) return { _tag: 'MenuKey', key: menuKey }
  }
  if (mod && alt && TURN_KEYS[key] !== undefined) return act(TURN_KEYS[key])
  if (mod && !alt) {
    if (lower === 'z') return act(shift ? { _tag: 'Redo' } : { _tag: 'Undo' })
    if (lower === 'y') return act({ _tag: 'Redo' })
    if (lower === 'a' && !shift) return act({ _tag: 'SelectAll' })
    if (lower === 'd' && !shift) return act({ _tag: 'Duplicate' })
    if (lower === 'k' && !shift) return { _tag: 'OpenLink' }
    if (shift && lower === 'm') return { _tag: 'Comment' }
    if (shift && (lower === 's' || lower === 'x')) return act({ _tag: 'ToggleMark', mark: 'strike' })
    if (!shift && MARKS[lower] !== undefined) return act({ _tag: 'ToggleMark', mark: MARKS[lower] })
    if (shift && key === 'ArrowUp') return act({ _tag: 'MoveBy', direction: -1 })
    if (shift && key === 'ArrowDown') return act({ _tag: 'MoveBy', direction: 1 })
    if (key === 'Enter') return { _tag: 'ToggleCurrent' }
    if (key === '/') return { _tag: 'OpenBlockMenu' }
  }
  if (key === 'Tab' && !mod && !alt) return act({ _tag: 'Indent', isOutdent: shift })
  if (key === 'Escape') return act({ _tag: 'Escape' })
  if (context.selection === 'BlockSelection' && !mod && !alt) {
    if (key === 'ArrowUp' || key === 'ArrowDown') return act({ _tag: 'MoveBlockSelection', direction: key === 'ArrowUp' ? -1 : 1, isExtending: shift })
    if (key === 'Enter') return act({ _tag: 'EditSelectedBlock' })
    if (key === 'Backspace' || key === 'Delete') return act({ _tag: 'DeleteBlocks' })
  }
  if (alt && shift && lower === 'l') return act({ _tag: 'Escape' })
  return null
}
