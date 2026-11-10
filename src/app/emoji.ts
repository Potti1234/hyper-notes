/* The emoji the icon picker offers, with the words its filter matches.
   Grouped like Notion's picker; "Add icon" picks from all of them. */

export type Emoji = Readonly<{ char: string; name: string; group: string }>

/** Code points as hex, '-' joined (the glyphs themselves trip crease/no-native-glyphs). */
const fromHex = (code: string): string => String.fromCodePoint(...code.split('-').map(part => Number.parseInt(part, 16)))

const group = (name: string, entries: ReadonlyArray<readonly [code: string, words: string]>): ReadonlyArray<Emoji> =>
  entries.map(([code, words]) => ({ char: fromHex(code), name: words, group: name }))

export const EMOJI: ReadonlyArray<Emoji> = [
  ...group('Objects', [
    ['1f4c4', 'page document'], ['1f4dd', 'memo note writing'], ['1f4da', 'books library'], ['1f4d6', 'open book reading'], ['1f4d3', 'notebook'],
    ['1f4d2', 'ledger'], ['1f4cc', 'pushpin pin'], ['1f4ce', 'paperclip attachment'], ['1f4c5', 'calendar date'], ['1f5d3-fe0f', 'spiral calendar planner'],
    ['1f4ca', 'bar chart stats'], ['1f4c8', 'chart increasing growth'], ['1f4c9', 'chart decreasing'], ['1f5c2-fe0f', 'card index dividers folder'], ['1f4c1', 'folder'],
    ['1f4a1', 'light bulb idea'], ['1f511', 'key'], ['1f512', 'lock locked'], ['1f527', 'wrench tool settings'], ['1f6e0-fe0f', 'hammer and wrench tools'],
    ['2699-fe0f', 'gear settings'], ['1f4bb', 'laptop computer'], ['1f5a5-fe0f', 'desktop computer'], ['1f4f1', 'mobile phone'], ['2709-fe0f', 'envelope mail email'],
    ['1f4e6', 'package box shipping'], ['1f381', 'gift present'], ['1f3f7-fe0f', 'label tag'], ['1f4bc', 'briefcase work'], ['1f9ed', 'compass direction'],
    ['1f5fa-fe0f', 'world map'], ['23f0', 'alarm clock time'], ['231b', 'hourglass time'], ['1f4b0', 'money bag'], ['1f9fe', 'receipt invoice'],
  ]),
  ...group('Activity', [
    ['1f680', 'rocket launch ship'], ['1f3af', 'target goal bullseye'], ['1f3c6', 'trophy win award'], ['1f389', 'party popper celebrate'], ['1f3a8', 'palette art design'],
    ['1f3b5', 'music note'], ['1f3ae', 'video game'], ['26bd', 'soccer football'], ['1f3c3', 'runner running'], ['1f9d8', 'yoga meditation'],
    ['2708-fe0f', 'airplane travel'], ['1f3e0', 'house home'], ['1f3e2', 'office building company'], ['1f373', 'cooking breakfast'], ['2615', 'coffee hot beverage'],
  ]),
  ...group('Nature', [
    ['1f331', 'seedling plant growth'], ['1f333', 'tree'], ['1f338', 'cherry blossom flower'], ['1f33b', 'sunflower'], ['1f340', 'four leaf clover luck'],
    ['1f525', 'fire hot'], ['2b50', 'star'], ['1f31f', 'glowing star'], ['1f319', 'crescent moon night'], ['2600-fe0f', 'sun sunny'],
    ['1f308', 'rainbow'], ['26a1', 'lightning bolt fast'], ['2744-fe0f', 'snowflake winter'], ['1f30a', 'wave ocean water'], ['1f436', 'dog puppy'],
    ['1f431', 'cat kitten'], ['1f98a', 'fox'], ['1f41d', 'bee honeybee'], ['1f98b', 'butterfly'], ['1f422', 'turtle slow'],
  ]),
  ...group('People', [
    ['1f600', 'grinning face smile happy'], ['1f60a', 'smiling face blush'], ['1f60e', 'cool sunglasses'], ['1f914', 'thinking face'], ['1f634', 'sleeping'],
    ['1f973', 'partying face'], ['1f605', 'sweat smile'], ['1f64c', 'raising hands hooray'], ['1f44d', 'thumbs up yes'], ['1f44b', 'waving hand hello'],
    ['1f440', 'eyes look'], ['1f9e0', 'brain think'], ['1f4aa', 'flexed biceps strong'], ['1f91d', 'handshake deal'], ['1f465', 'people team'],
  ]),
  ...group('Symbols', [
    ['2705', 'check mark done'], ['274c', 'cross mark no'], ['2757', 'exclamation important'], ['2753', 'question mark'], ['26a0-fe0f', 'warning caution'],
    ['1f4ac', 'speech balloon comment chat'], ['2764-fe0f', 'red heart love'], ['1f4af', 'hundred points'], ['267b-fe0f', 'recycle'], ['1f517', 'link chain'],
    ['1f195', 'new button'], ['1f534', 'red circle'], ['1f7e2', 'green circle'], ['1f535', 'blue circle'], ['1f7e1', 'yellow circle'],
  ]),
]

const BY_CHAR = new Map(EMOJI.map(entry => [entry.char, entry]))

export const isEmoji = (char: string): boolean => BY_CHAR.has(char)

/** A stable pick for "Add icon": the same page and moment always give the same emoji. */
export const pickEmoji = (seed: string): string => EMOJI[hash(seed) % EMOJI.length]?.char ?? fromHex('1f4c4')

export const hash = (text: string): number => {
  let value = 2166136261
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619)
  return value >>> 0
}
