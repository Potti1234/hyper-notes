import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'

import * as SettingsPage from '@/app/settings/page'
import { DEMO_MEMBERS, demoData } from '@/app/seed'
import { type WorkspaceData, setPreset } from '@/app/workspace'
import { THEME_PRESETS, isThemeSlug } from '@/app/view/themes'

/* Settings: the theme preset is stored on the member, and only known
   presets are accepted from the browser. */

const NOW = Date.UTC(2026, 10, 6, 9)
const avery = DEMO_MEMBERS.find(member => member.id === 'avery')!
const nav = { favorites: [], workspace: [], private: [] }
const model = (theme = ''): SettingsPage.Model => SettingsPage.init({ me: { ...avery, theme }, nav }).model

const apply = (data: WorkspaceData, memberId: string, theme: string): WorkspaceData => {
  const exit = Effect.runSync(Effect.exit(setPreset(memberId, theme)(data, { at: NOW, id: prefix => prefix })))
  if (Exit.isFailure(exit)) throw new Error('setPreset failed')
  return exit.value[1]
}

describe('settings: theme presets', () => {
  it('knows the twelve creaseui presets and the app theme', () => {
    assert.strictEqual(THEME_PRESETS.length, 12)
    assert.isTrue(isThemeSlug(''))
    assert.isTrue(isThemeSlug('nord'))
    assert.isFalse(isThemeSlug('nord evil'))
  })

  it('stores a known preset with a command, ignores unknown or unchanged ones', () => {
    assert.strictEqual(SettingsPage.update(model(), SettingsPage.Message.ClickedPreset({ slug: 'nord' })).commands?.length, 1)
    assert.isUndefined(SettingsPage.update(model(), SettingsPage.Message.ClickedPreset({ slug: '../evil' })).commands)
    assert.isUndefined(SettingsPage.update(model('nord'), SettingsPage.Message.ClickedPreset({ slug: 'nord' })).commands)
    assert.strictEqual(SettingsPage.update(model('nord'), SettingsPage.Message.ClickedPreset({ slug: '' })).commands?.length, 1)
  })

  it('changes only the member it is for, keeping the others as the same objects', () => {
    const data = demoData(NOW)
    const after = apply(data, 'avery', 'ember')
    assert.strictEqual(after.members.find(member => member.id === 'avery')?.theme, 'ember')
    data.members.forEach((member, index) => {
      if (member.id !== 'avery') assert.strictEqual(after.members[index], member)
    })
    assert.strictEqual(after.pages, data.pages)
  })
})
