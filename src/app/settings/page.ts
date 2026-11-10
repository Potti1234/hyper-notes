import { Effect, Match as M, Schema as S, Stream } from 'effect'
import { Command, Subscription, type Update } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { type Program, region } from '@hyper-effect/core'

import { text } from '@/ui/text'
import { toggle } from '@/ui/toggle'

import { requireMember } from '../auth'
import { Member } from '../domain'
import { Workspace, type WorkspaceState } from '../store'
import { box, pageRoot, swatch } from '../view/design'
import { avatar } from '../view/icons'
import { Nav, navOf, sameNav, sidebar } from '../view/shell'
import { THEME_PRESETS, type ThemePreset, isThemeSlug } from '../view/themes'

/* Settings: the member's profile and the creaseui theme preset their pages
   wear. The choice is stored on the member and applied as `theme-<slug>` on
   every page root they have open, light and dark. */

// MODEL

export const Model = S.Struct({
  me: Member,
  nav: Nav,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedToggleTheme: {},
  ClickedPreset: { slug: S.String },
  GotSettings: { me: Member, nav: Nav },
  CompletedChange: {},
})
export type Message = typeof Message.Type

export const ClientMessage = S.Union([Message.ClickedToggleTheme, Message.ClickedPreset])
export type ClientMessage = typeof ClientMessage.Type

// COMMANDS

export const SetTheme = Command.define('SetTheme', {
  args: { memberId: S.String, isDark: S.Boolean },
  messages: [Message.CompletedChange],
  execute: ({ memberId, isDark }) => Workspace.use(workspace => workspace.setTheme(memberId, isDark)).pipe(Effect.as(Message.CompletedChange())),
})

export const SetPreset = Command.define('SetPreset', {
  args: { memberId: S.String, theme: S.String },
  messages: [Message.CompletedChange],
  execute: ({ memberId, theme }) => Workspace.use(workspace => workspace.setPreset(memberId, theme)).pipe(Effect.as(Message.CompletedChange())),
})

// INIT

export type Flags = Readonly<{ me: Member; nav: Nav }>

export const init = (flags: Flags): Update.Return<Model, Message, Workspace> => ({ model: { ...flags } })

// UPDATE

type UpdateReturn = Update.Return<Model, Message, Workspace>

export const update = (model: Model, message: Message): UpdateReturn =>
  M.value(message).pipe(
    M.withReturnType<UpdateReturn>(),
    M.tagsExhaustive({
      ClickedToggleTheme: () => ({ model, commands: [SetTheme({ memberId: model.me.id, isDark: !model.me.isDark })] }),
      // The slug is posted by the browser: only known presets are stored.
      ClickedPreset: ({ slug }) =>
        slug === model.me.theme || !isThemeSlug(slug) ? { model } : { model, commands: [SetPreset({ memberId: model.me.id, theme: slug })] },
      GotSettings: ({ me, nav }) => ({ model: { ...model, me, nav } }),
      CompletedChange: () => ({ model }),
    }),
  )

// SUBSCRIPTION

type Slice = Readonly<{ me: Member | null; nav: Nav }>

export const sliceOf = (state: WorkspaceState, memberId: string): Slice => ({
  me: state.members.find(member => member.id === memberId) ?? null,
  nav: navOf(state, memberId),
})

const sameSlice = (a: Slice, b: Slice) => a.me === b.me && sameNav(a.nav, b.nav)

export const subscriptions = Subscription.make<Model, Message, Workspace>()(entry => ({
  settings: entry(
    { memberId: S.String },
    {
      modelToDependencies: model => ({ memberId: model.me.id }),
      dependenciesToStream: ({ memberId }) =>
        Stream.unwrap(
          Workspace.use(workspace =>
            Effect.succeed(
              workspace.changes.pipe(
                Stream.map(state => sliceOf(state, memberId)),
                Stream.changesWith(sameSlice),
                Stream.filter((slice): slice is Slice & { me: Member } => slice.me !== null),
                Stream.map(slice => Message.GotSettings(slice)),
              ),
            ),
          ),
        ),
    },
  ),
}))

// VIEW

/** The app's own palette: no preset class on the page root. */
const APP_THEME: ThemePreset = {
  slug: '',
  name: 'hypernotes',
  description: 'The app’s own theme: neutral greys and Inter, after Notion',
  scheme: 'both',
  swatches: ['oklch(0.205 0 0)', 'oklch(0.97 0 0)', 'oklch(0.97 0 0)', 'oklch(1 0 0)'],
}

const presetCard = (preset: ThemePreset, isActive: boolean, h: HtmlBuilder<Message>): Html =>
  toggle(
    {
      isPressed: isActive,
      onToggle: Message.ClickedPreset({ slug: preset.slug }),
      variant: 'outline',
      size: 'card',
      id: preset.slug === '' ? 'preset-default' : `preset-${preset.slug}`,
      ariaLabel: `Use the ${preset.name} theme`,
      children: [
        box({ class: 'flex shrink-0 items-center gap-1', children: preset.swatches.map(color => swatch({ color }, h)) }, h),
        box({ class: 'min-w-0', children: [
          text({ children: [preset.name], type: 'body', weight: 'medium', display: 'block' }, h),
          text({ children: [preset.description], type: 'supporting', color: 'secondary', display: 'block' }, h),
        ] }, h),
      ],
    },
    h,
  )

const profileSection = (me: Member, h: HtmlBuilder<Message>): Html =>
  box({ as: 'section', class: 'flex items-center gap-4 rounded-lg border bg-card p-4 text-card-foreground', attributes: [h.Id('profile'), h.AriaLabel('Profile')], children: [
    avatar(me, h, 'md'),
    box({ class: 'min-w-0', children: [
      text({ children: [me.name], type: 'body', weight: 'semibold', display: 'block' }, h),
      text({ children: [me.email], type: 'supporting', color: 'secondary', display: 'block' }, h),
    ] }, h),
  ] }, h)

const themesSection = (theme: string, h: HtmlBuilder<Message>): Html =>
  box({ as: 'section', class: 'grid gap-2', attributes: [h.Id('themes'), h.AriaLabel('Theme')], children: [
    text({ children: ['Theme'], type: 'body', weight: 'semibold' }, h),
    text({ children: ['A creaseui preset. Every page you open wears it, light and dark.'], type: 'supporting', color: 'secondary' }, h),
    box({ class: 'grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2', children: [APP_THEME, ...THEME_PRESETS].map(preset => presetCard(preset, theme === preset.slug, h)) }, h),
  ] }, h)

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'Settings · hypernotes',
  body: pageRoot({ isDark: model.me.isDark, theme: model.me.theme, children: [
    region(h, {
      id: 'sidebar',
      deps: [model.me, model.nav],
      render: () =>
        sidebar(
          {
            me: model.me,
            active: '/settings',
            activeId: null,
            nav: model.nav,
            isDark: model.me.isDark,
            onToggleTheme: Message.ClickedToggleTheme(),
          },
          h,
        ),
    }),
    box({ as: 'main', class: 'flex min-w-0 flex-1 flex-col overflow-y-auto bg-background', attributes: [h.DataAttribute('keep-scroll', 'settings')], children: [
      box({ as: 'header', class: 'flex h-12 shrink-0 items-center gap-2 border-b px-4', children: [
        text({ children: ['Settings'], type: 'body', weight: 'semibold' }, h),
      ] }, h),
      box({ class: 'mx-auto grid w-full max-w-2xl gap-6 p-4 sm:p-6', children: [
        region(h, { id: 'profile', deps: [model.me.name, model.me.email, model.me.color], render: () => profileSection(model.me, h) }),
        region(h, { id: 'themes', deps: [model.me.theme], render: () => themesSection(model.me.theme, h) }),
      ] }, h),
    ] }, h),
  ] }, h),
})

// PROGRAM

export const program: Program<Model, Message, ClientMessage, Flags, Workspace> = {
  name: 'settings',
  Model,
  ClientMessage,
  flags: request =>
    Effect.gen(function* () {
      const me = yield* requireMember(request)
      const state = yield* Workspace.use(workspace => workspace.current)
      return { me, nav: sliceOf(state, me.id).nav }
    }),
  init,
  update,
  view,
  subscriptions,
  snapshotDeps: () => [],
}
