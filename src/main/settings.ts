// User settings, persisted in the SQLite `settings` table as JSON values.

import { z } from 'zod'
import type { Settings } from '@shared/ipc'
import { config } from './config'
import type { Store } from './store'

const SettingsSchema = z.object({
  mode: z.enum(['block', 'warn']),
  autoDetonate: z.boolean(),
  watchDownloads: z.boolean(),
  panelAutoPop: z.boolean(),
  alertTexts: z.boolean(),
  sandboxDailyBudget: z.number().int().min(0).max(10_000)
})

function defaults(): Settings {
  return {
    mode: config.defaultMode,
    autoDetonate: true,
    watchDownloads: true,
    panelAutoPop: true,
    alertTexts: false,
    sandboxDailyBudget: config.sandboxDailyBudget
  }
}

export function getSettings(store: Store): Settings {
  const raw = store.getSetting('app')
  if (!raw) return defaults()
  const parsed = SettingsSchema.partial().safeParse(JSON.parse(raw))
  return { ...defaults(), ...(parsed.success ? parsed.data : {}) }
}

export function setSettings(store: Store, patch: Partial<Settings>): Settings {
  const next = SettingsSchema.parse({ ...getSettings(store), ...patch })
  store.setSetting('app', JSON.stringify(next))
  return next
}
