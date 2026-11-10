/* A page icon is an emoji, '' for none, or an https image link (the Link tab
   of Notion's icon picker). */

export const isIconLink = (icon: string): boolean => /^https:\/\/[^\s"'()\\]{1,2000}$/.test(icon)

/** The icon where only text fits (menus, mentions, Markdown): an image link reads as nothing. */
export const iconText = (icon: string): string => (isIconLink(icon) ? '' : icon)
