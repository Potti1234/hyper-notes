import type { Html, HtmlBuilder } from 'foldkit/html'

import * as Icon from '@/lib/icon'
import { cn } from '@/lib/utils'
import { box } from '@/app/view/design'

import { type Member, initials } from '../domain'
import { isIconLink } from '../icon-link'

/* Avatars and page icons (an emoji, an image link, or the default page glyph). */

export const avatar = <Msg>(member: Member | undefined, h: HtmlBuilder<Msg>, size: 'xs' | 'sm' | 'md' = 'sm', className = ''): Html => {
  const sizeClass = size === 'xs' ? 'size-4 text-[8px]' : size === 'sm' ? 'size-5 text-[9px]' : 'size-6 text-[10px]'
  if (member === undefined) {
    return box({ as: 'span', class: cn('inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/50', sizeClass, className), attributes: [h.AriaLabel('Someone'), h.Role('img')], children: [] }, h)
  }
  return box({ as: 'span', class: cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', member.color, sizeClass, className), attributes: [h.DataAttribute('slot', 'avatar'), h.Title(member.name), h.AriaLabel(member.name), h.Role('img')], children: [initials(member.name)] }, h)
}

/** A page's icon at a size: its emoji, its image, or the page glyph. */
export const pageIcon = <Msg>(icon: string, h: HtmlBuilder<Msg>, size: 'sm' | 'md' | 'lg' = 'sm'): Html =>
  isIconLink(icon)
    ? h.img([h.Src(icon), h.Alt(''), h.DataAttribute('icon-image', ''), h.Class(cn('shrink-0 object-cover', size === 'sm' ? 'size-4 rounded-[3px]' : size === 'md' ? 'size-5 rounded-[3px]' : 'size-[78px] rounded-md'))])
    : icon === ''
    ? Icon.icon('file-text', { class: size === 'sm' ? 'size-4 text-muted-foreground' : size === 'md' ? 'size-5 text-muted-foreground' : 'size-16 text-muted-foreground' }, h)
    : box({ as: 'span', class: cn('inline-flex shrink-0 items-center justify-center leading-none', size === 'sm' ? 'size-4 text-[15px]' : size === 'md' ? 'size-5 text-[18px]' : 'size-[78px] text-[70px]'), attributes: [h.AriaHidden(true)], children: [icon] }, h)
