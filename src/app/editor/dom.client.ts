import type { Point, Selection } from './state'

/* DOM ↔ document positions. A text block's offsets are the text nodes and
   atoms (width 1) under its `[data-text-of]` element, in order; the filler
   `<br>` of an empty line counts for nothing. */

type Leaf = Text | Element

const leaves = (textElement: Element): ReadonlyArray<Leaf> => {
  const out: Array<Leaf> = []
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child instanceof Text) out.push(child)
      else if (child instanceof Element) {
        if (child.hasAttribute('data-atom')) out.push(child)
        else if (!child.hasAttribute('data-filler')) walk(child)
      }
    }
  }
  walk(textElement)
  return out
}

const width = (leaf: Leaf): number => (leaf instanceof Text ? leaf.data.length : 1)

export const textElementOf = (root: Element, blockId: string): Element | null => root.querySelector(`[data-text-of="${CSS.escape(blockId)}"]`)

/** The document point of a DOM position, if it is in a block's text. */
export const pointOf = (node: Node | null, offset: number): Point | null => {
  if (node === null) return null
  const element = node instanceof Element ? node : node.parentElement
  let textElement = element?.closest('[data-text-of]') ?? null
  if (textElement === null && element !== null) {
    // A position between blocks or in a block's chrome: its block's text, at the start or the end.
    const block = (node instanceof Element && offset < node.childNodes.length ? node.childNodes[offset] : null) as Element | null
    const inside = block instanceof Element ? (block.matches('[data-text-of]') ? block : block.querySelector('[data-text-of]')) : null
    const owner = inside ?? element.closest('[data-block-id]')?.querySelector('[data-text-of]') ?? null
    if (owner === null) return null
    const blockId = owner.getAttribute('data-text-of') ?? ''
    return { blockId, offset: inside !== null ? 0 : leaves(owner).reduce((sum, leaf) => sum + width(leaf), 0) }
  }
  if (textElement === null) return null
  const blockId = textElement.getAttribute('data-text-of') ?? ''
  const range = document.createRange()
  range.setStart(textElement, 0)
  range.setEnd(node, offset)
  let total = 0
  for (const leaf of leaves(textElement)) {
    if (leaf === node) return { blockId, offset: total + offset }
    if (leaf instanceof Element && leaf.contains(node)) return { blockId, offset: total + (offset > 0 ? 1 : 0) }
    if (range.intersectsNode(leaf)) total += width(leaf)
  }
  textElement = null
  return { blockId, offset: total }
}

/** The DOM position of a document point. */
export const positionOf = (root: Element, point: Point): readonly [Node, number] | null => {
  const textElement = textElementOf(root, point.blockId)
  if (textElement === null) return null
  let remaining = point.offset
  for (const leaf of leaves(textElement)) {
    if (leaf instanceof Text) {
      if (remaining <= leaf.data.length) return [leaf, remaining]
    } else if (remaining === 0 && leaf.parentNode !== null) {
      return [leaf.parentNode, Array.from(leaf.parentNode.childNodes).indexOf(leaf as ChildNode)]
    }
    remaining -= width(leaf)
  }
  const filler = textElement.querySelector(':scope > [data-filler]')
  return [textElement, filler === null ? textElement.childNodes.length : Array.from(textElement.childNodes).indexOf(filler)]
}

export const readSelection = (root: Element): Selection | null => {
  const selection = document.getSelection()
  if (selection === null || selection.rangeCount === 0 || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null
  const anchor = pointOf(selection.anchorNode, selection.anchorOffset)
  const focus = pointOf(selection.focusNode, selection.focusOffset)
  return anchor === null || focus === null ? null : { _tag: 'TextSelection', anchor, focus }
}

const samePoint = (a: Point | null, b: Point): boolean => a !== null && a.blockId === b.blockId && a.offset === b.offset

/** Puts the browser selection where the model says, if it is elsewhere. */
export const writeSelection = (root: HTMLElement, selection: Selection): void => {
  const current = document.getSelection()
  if (current === null) return
  if (selection._tag !== 'TextSelection') {
    if (selection._tag === 'BlockSelection' && root.contains(current.anchorNode)) {
      current.removeAllRanges()
      root.focus({ preventScroll: true })
    }
    return
  }
  if (current.rangeCount > 0 && samePoint(pointOf(current.anchorNode, current.anchorOffset), selection.anchor) && samePoint(pointOf(current.focusNode, current.focusOffset), selection.focus)) return
  const anchor = positionOf(root, selection.anchor)
  const focus = positionOf(root, selection.focus)
  if (anchor === null || focus === null) return
  if (document.activeElement !== root) root.focus({ preventScroll: true })
  current.setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1])
  const rect = (focus[0] instanceof Element ? focus[0] : focus[0].parentElement)?.getBoundingClientRect()
  if (rect !== undefined && (rect.bottom > window.innerHeight || rect.top < 0)) (focus[0] instanceof Element ? focus[0] : focus[0].parentElement)?.scrollIntoView({ block: 'nearest' })
}

/** Caret's screen rectangle, for placing menus at it. */
export const caretRect = (): DOMRect | null => {
  const selection = document.getSelection()
  if (selection === null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0).cloneRange()
  range.collapse(false)
  const rects = range.getClientRects()
  return rects[0] ?? (range.startContainer instanceof Element ? range.startContainer.getBoundingClientRect() : range.startContainer.parentElement?.getBoundingClientRect() ?? null)
}

export const blockAt = (x: number, y: number): Element | null => document.elementFromPoint(x, y)?.closest('[data-block-id]') ?? null
