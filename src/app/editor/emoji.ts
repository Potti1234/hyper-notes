/* Emoji are page and callout icons: user data, like text. They are kept as
   code points here (the picker's catalog, the defaults) and turned into
   strings when used, so the source holds no glyphs for the UI. */

/** `'1f4a1'` or `'1f5d3-fe0f'` to the emoji. */
export const emoji = (hex: string): string => String.fromCodePoint(...hex.split('-').map(part => Number.parseInt(part, 16)))
